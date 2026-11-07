// Live smoke test of the Postgres backend against DATABASE_URL (Neon). Not part of run-all.
// Run: DB_MODE=postgres npx tsx tests/pg-smoke.ts
process.env.DB_MODE = 'postgres';
import { adminDb } from '../server-firebase-admin';

let fails = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); if (!ok) fails++; };

async function main() {
  const root = `smoke-${Date.now()}`;
  check('kind is postgres', adminDb.kind === 'postgres');
  await adminDb.healthCheck();
  check('healthCheck write+read', true);
  const col = adminDb.collection(`${root}/items`);
  await col.doc('a').set({ n: 1, t: 'x', keep: true });
  await col.doc('b').set({ n: 2, t: 'y' });
  await col.doc('c').set({ n: 3, t: 'x' });
  await col.doc('a').set({ n: 10, extra: 1 }, { merge: true });
  const a = (await col.doc('a').get()).data();
  check('set/get + merge', a.n === 10 && a.t === 'x' && a.extra === 1);
  check('missing doc', !(await col.doc('zzz').get()).exists);
  const w = await col.where('t', '==', 'x').get();
  check('where', w.size === 2);
  const o = await col.orderBy('n', 'desc').limit(2).get();
  check('orderBy desc + limit', o.docs.map((d) => d.id).join() === 'a,c');
  const batch = adminDb.batch();
  batch.set(col.doc('d'), { n: 4 });
  batch.delete(col.doc('b'));
  await batch.commit();
  check('batch', (await col.get()).size === 3 && !(await col.doc('b').get()).exists);
  check('nested path not listed', (await adminDb.collection(root).get()).size === 0);
  for (const id of ['a', 'c', 'd']) await col.doc(id).delete();
  check('cleanup', (await col.get()).size === 0);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', String(e?.message || e).replace(/postgres(ql)?:\/\/\S+/g, '[redacted]')); process.exit(1); });
