/**
 * Copies the app's Firestore documents into Postgres (Neon) `doc_store`, then checks every copied document.
 *
 *   npx tsx scripts/copy-firestore-to-pg.ts --dry-run   reads Firestore, prints counts, writes nothing
 *   npx tsx scripts/copy-firestore-to-pg.ts             copies, then verifies
 *   npx tsx scripts/copy-firestore-to-pg.ts --verify    verifies only (reads Firestore again)
 *
 * Needs DATABASE_URL (from .env.local) and the server's usual Firestore credentials. It only READS Firestore
 * and re-running it overwrites the Postgres copy with the newer one. It stops by itself past READ_LIMIT reads
 * so a mistake cannot use up the day's free quota. Run it just after the daily quota reset.
 */
process.env.DB_MODE = 'firestore'; // reading side; the Postgres side is built below from DATABASE_URL

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const VERIFY_ONLY = args.has('--verify');
const READ_LIMIT = 6000;
const SYNC_LOGS = 300;
const MAX_BATCH_BYTES = 3_000_000;

type Doc = { path: string; data: any };

function stable(v: any): any {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  }
  return v;
}
const canon = (v: any) => JSON.stringify(stable(JSON.parse(JSON.stringify(v ?? null))));

async function main() {
  const { adminDb } = await import('../server-firebase-admin');
  const { createPgBackend } = await import('../server-pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (it is in .env.local).');
  if (adminDb.kind !== 'firestore') throw new Error(`Expected to read Firestore, got ${adminDb.kind}.`);
  const pg = createPgBackend(url);
  const fs = adminDb.backend();

  let reads = 0;
  const guard = (n: number) => {
    reads += n;
    if (reads > READ_LIMIT) throw new Error(`Stopped: more than ${READ_LIMIT} Firestore reads. Nothing more was read.`);
  };
  const list = async (col: string, query?: Parameters<typeof fs.listDocs>[1]): Promise<Doc[]> => {
    const docs = await fs.listDocs(col, query);
    guard(Math.max(1, docs.length));
    return docs.map((d) => ({ path: d.path, data: d.data }));
  };
  const get = async (path: string): Promise<Doc[]> => {
    const data = await fs.getDoc(path);
    guard(1);
    return data === null ? [] : [{ path, data }];
  };

  // ---- gather
  const groups: Array<{ name: string; docs: Doc[] }> = [];
  const add = (name: string, docs: Doc[]) => groups.push({ name, docs });

  add('config', await get('config/app'));
  const cycles = await list('cycles');
  add('cycles', cycles);
  for (const c of cycles) {
    const id = c.path.split('/').pop()!;
    const base = `cycles/${id}`;
    add(`${base}/agents`, await list(`${base}/agents`));
    add(`${base}/leaderboards`, await list(`${base}/leaderboards`));
    add(`${base}/teamRevenue`, await list(`${base}/teamRevenue`));
    const data = await list(`${base}/data`);
    add(`${base}/data`, data);
    for (const head of ['rawRecords', 'teamOps']) {
      if (data.some((d) => d.path.endsWith(`/${head}`))) add(`${base}/data/${head}/chunks`, await list(`${base}/data/${head}/chunks`));
    }
  }
  add('access', await list('access'));
  add('syncLogs', await list('syncLogs', { orderBy: { field: 'time', dir: 'desc' }, limit: SYNC_LOGS }));
  // Login activity: the current month only (one query a day: only "==" filters exist)
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const login: Doc[] = [];
  for (let d = today.slice(0, 8) + '01'; d <= today; d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    login.push(...(await list('loginActivity', { where: [{ field: 'date', value: d }] })));
  }
  add('loginActivity', login);
  const reports = await list('privateReports');
  add('privateReports', reports);
  for (const r of reports) {
    const name = r.path.split('/').pop()!;
    if (name === 'cohort' || name === 'cohortV2') add(`privateReports/${name}/chunks`, await list(`privateReports/${name}/chunks`));
  }

  const total = groups.reduce((n, g) => n + g.docs.length, 0);
  console.log(`\nRead from Firestore: ${total} documents with ${reads} reads.`);
  for (const g of groups) console.log(`  ${String(g.docs.length).padStart(5)}  ${g.name}`);
  if (DRY) {
    console.log('\nDry run: nothing was written.');
    return;
  }

  // ---- copy
  if (!VERIFY_ONLY) {
    let batch: Doc[] = [];
    let bytes = 0;
    let written = 0;
    const flush = async () => {
      if (!batch.length) return;
      await pg.commit(batch.map((d) => ({ op: 'set' as const, path: d.path, data: d.data })));
      written += batch.length;
      batch = [];
      bytes = 0;
    };
    for (const g of groups) {
      for (const d of g.docs) {
        const size = JSON.stringify(d.data).length;
        if (batch.length >= 200 || (batch.length && bytes + size > MAX_BATCH_BYTES)) await flush();
        batch.push(d);
        bytes += size;
      }
    }
    await flush();
    console.log(`\nWritten to Postgres: ${written} documents.`);
  }

  // ---- verify: every document read back and compared with what Firestore returned
  let bad = 0;
  console.log('\nVerify (Firestore vs Postgres):');
  for (const g of groups) {
    if (!g.docs.length) continue;
    const parent = g.docs[0].path.split('/').slice(0, -1).join('/');
    const back = new Map((await pg.listDocs(parent)).map((d) => [d.path, d.data]));
    let missing = 0;
    let differ = 0;
    for (const d of g.docs) {
      if (!back.has(d.path)) missing++;
      else if (canon(back.get(d.path)) !== canon(d.data)) differ++;
    }
    bad += missing + differ;
    console.log(`  ${missing + differ === 0 ? 'OK  ' : 'FAIL'} ${g.name}: ${g.docs.length} source, ${missing} missing, ${differ} different`);
  }

  // Agent totals as a second, human-readable check
  const agents = groups.filter((g) => /\/agents$/.test(g.name)).flatMap((g) => g.docs);
  if (agents.length) {
    const sum = (f: (a: any) => number) => agents.reduce((n, d) => n + (Number(f(d.data)) || 0), 0);
    console.log(
      `\nAgents: ${agents.length}; totals.sales ${sum((a) => a.totals?.sales)}; totals.orders ${sum((a) => a.totals?.orders)}; ` +
        `result.total ${sum((a) => a.result?.total)}; daily entries ${sum((a) => (a.daily || []).length)}`
    );
  }
  console.log(bad === 0 ? '\nAll copied documents match.' : `\n${bad} document(s) do not match. Do not switch over.`);
  if (bad) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\nFailed:', e?.message || e);
  process.exit(1);
});
