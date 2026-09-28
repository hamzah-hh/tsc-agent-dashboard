import { Backend, createDb, createFirestoreBackend, createLocalBackend, MAX_WRITES_PER_COMMIT } from '../server-db';
import { check, section } from './harness';
import { startFakeFirestore } from './fake-firestore';

/** The behaviour every backend must have (the real REST one and the local one). */
async function backendSuite(label: string, backend: Backend) {
  const db = createDb(() => backend);

  section(`${label}: documents`);
  await db.collection('cycles').doc('c1').collection('agents').doc('a@x.com').set({
    name: 'Asha',
    total: 12345,
    ratio: 0.15,
    ok: true,
    nothing: null,
    list: [1, 2.5, 'x'],
    nested: { amounts: { NQ: [1000, 800] }, empty: {} },
    skipped: undefined,
  });
  const snap = await db.collection('cycles').doc('c1').collection('agents').doc('a@x.com').get();
  const d = snap.data();
  check(`${label}: set then get gives the same data back`, snap.exists && d.name === 'Asha' && d.total === 12345 && d.ratio === 0.15 && d.ok === true && d.nothing === null && JSON.stringify(d.list) === '[1,2.5,"x"]' && d.nested.amounts.NQ[1] === 800, JSON.stringify(d));
  check(`${label}: an undefined field is not stored`, !('skipped' in d));

  await db.collection('cfg').doc('app').set({ a: 1, b: 2, arr: ['x'] });
  await db.collection('cfg').doc('app').set({ b: 20, c: 3 }, { merge: true });
  const merged = (await db.collection('cfg').doc('app').get()).data();
  check(`${label}: merge changes only the given fields`, merged.a === 1 && merged.b === 20 && merged.c === 3 && merged.arr[0] === 'x', JSON.stringify(merged));
  await db.collection('cfg').doc('app').set({ z: 1 });
  const replaced = (await db.collection('cfg').doc('app').get()).data();
  check(`${label}: set without merge replaces the whole document`, Object.keys(replaced).join() === 'z', JSON.stringify(replaced));

  await db.collection('cfg').doc('empty').set({});
  const empty = await db.collection('cfg').doc('empty').get();
  check(`${label}: an empty document exists and reads as {}`, empty.exists && JSON.stringify(empty.data()) === '{}');

  const missing = await db.collection('cfg').doc('nope').get();
  check(`${label}: a missing document reads as not existing`, missing.exists === false && missing.data() === undefined);

  await db.collection('cfg').doc('empty').delete();
  check(`${label}: delete removes it, and deleting a missing document is fine`, (await db.collection('cfg').doc('empty').get()).exists === false && (await db.collection('cfg').doc('empty').delete()) === undefined);

  await db.collection('access').doc('odd name+tag@gmail.com #1').set({ role: 'agent' });
  check(`${label}: an id with spaces, "+", "@" and "#" (an unusual email) is stored and read back`, (await db.collection('access').doc('odd name+tag@gmail.com #1').get()).data()?.role === 'agent');
  await db.collection('access').doc('odd name+tag@gmail.com #1').delete();

  section(`${label}: queries`);
  const logs = db.collection('syncLogs');
  await logs.doc('l1').set({ time: '2026-10-01T10:00:00Z', source: 'test', n: 1 });
  await logs.doc('l2').set({ time: '2026-10-03T10:00:00Z', source: 'apps-script', n: 2 });
  await logs.doc('l3').set({ time: '2026-10-02T10:00:00Z', source: 'test', n: 3 });
  const all = await logs.get();
  check(`${label}: list returns the collection's documents`, all.size === 3 && !all.empty);
  const tests = await logs.where('source', '==', 'test').get();
  check(`${label}: where == filters`, tests.size === 2 && tests.docs.every((x) => x.data().source === 'test'));
  const latest = await logs.orderBy('time', 'desc').limit(2).get();
  check(`${label}: orderBy desc + limit`, latest.docs.map((x) => x.id).join() === 'l2,l3', latest.docs.map((x) => x.id).join());
  const noSubdocs = await db.collection('cycles').doc('c1').collection('agents').get();
  check(`${label}: a subcollection lists only its own documents`, noSubdocs.size === 1 && noSubdocs.docs[0].id === 'a@x.com');
  const none = await logs.where('source', '==', 'nobody').get();
  check(`${label}: an empty result is empty`, none.empty && none.size === 0);
  const rootOnly = await db.collection('cycles').get();
  check(`${label}: a collection does not list documents of other collections`, rootOnly.size === 0, String(rootOnly.size));

  section(`${label}: batch`);
  const batch = db.batch();
  const col = db.collection('bulk');
  const n = MAX_WRITES_PER_COMMIT * 2 + 150;
  for (let i = 0; i < n; i++) batch.set(col.doc(`d${i}`), { i });
  await batch.commit();
  const bulk = await col.get();
  check(`${label}: a batch bigger than one commit is saved completely (${n} documents)`, bulk.size === n, String(bulk.size));
  const del = db.batch();
  bulk.forEach((x) => del.delete(x.ref));
  await del.commit();
  check(`${label}: a batch of deletes empties the collection`, (await col.get()).empty);

  await db.healthCheck();
  check(`${label}: health check writes and reads back`, true);
}

export async function runDbTests() {
  const fake = await startFakeFirestore();
  try {
    const rest = createFirestoreBackend({
      projectId: 'demo-project',
      databaseId: '(default)',
      restBase: fake.url,
      apiKey: 'AIza-test-key',
      timeoutMs: 5000,
    });

    await backendSuite('firestore-rest', rest);
    await backendSuite('local', createLocalBackend(null));

    section('firestore-rest: what is sent');
    const commits = fake.requests.filter((r) => r.path.endsWith(':commit'));
    const sizes = commits.map((r) => r.body.writes.length);
    check('a 950-document batch is sent as commits of at most 400 writes', Math.max(...sizes) <= MAX_WRITES_PER_COMMIT && sizes.filter((s) => s === 400).length >= 2, JSON.stringify(sizes.slice(-8)));
    const mergeCommit = commits.find((r) => r.body.writes[0]?.updateMask);
    check('a merge is sent with an update mask (only the listed fields change)', Boolean(mergeCommit) && mergeCommit!.body.writes[0].updateMask.fieldPaths.sort().join() === 'b,c', JSON.stringify(mergeCommit?.body.writes[0].updateMask));
    check('without credentials every request is anonymous and carries only the API key', fake.requests.every((r) => r.auth === null && r.query.includes('key=AIza-test-key')), JSON.stringify(fake.requests.find((r) => r.auth !== null || !r.query.includes('key='))));

    section('firestore-rest: credentials');
    fake.requests.length = 0;
    const withToken = createDb(() =>
      createFirestoreBackend({ projectId: 'demo-project', restBase: fake.url, apiKey: 'AIza-test-key', tokenProvider: async () => 'tok123' })
    );
    await withToken.collection('cfg').doc('x').set({ a: 1 });
    check('with a service-account token the request carries "Authorization: Bearer <token>" and no API key', fake.requests[0].auth === 'Bearer tok123' && !fake.requests[0].query.includes('key='), JSON.stringify(fake.requests[0]));
    fake.requests.length = 0;
    const anon = createDb(() => createFirestoreBackend({ projectId: 'demo-project', restBase: fake.url, apiKey: 'AIza-test-key', tokenProvider: async () => null }));
    await anon.collection('cfg').doc('x').get();
    check('without a token the request is anonymous and carries the API key', fake.requests[0].auth === null && fake.requests[0].query.includes('key=AIza-test-key'), JSON.stringify(fake.requests[0]));

    section('firestore-rest: failures are never swallowed');
    const db = createDb(() => rest);

    fake.failNext = { status: 403, message: 'Missing or insufficient permissions.', state: 'PERMISSION_DENIED', times: 5 };
    let err: any = null;
    await db.collection('agents').doc('a').set({ x: 1 }).catch((e) => (err = e));
    check('a refused write (403) makes set() throw', err !== null && /HTTP 403/.test(err.message), String(err?.message));
    check('the error says what to do (Cloud Datastore User role)', /Cloud Datastore User|no Google credentials/.test(err?.message || ''), String(err?.message));
    fake.failNext = null;
    check('and nothing was stored', (await db.collection('agents').doc('a').get()).exists === false);

    fake.failNext = { status: 403, times: 5 };
    err = null;
    await db.collection('agents').doc('a').get().catch((e) => (err = e));
    check('a refused read (403) makes get() throw instead of returning "not found"', err !== null && /HTTP 403/.test(err.message), String(err?.message));
    fake.failNext = { status: 403, times: 5 };
    err = null;
    await db.collection('agents').get().catch((e) => (err = e));
    check('a refused query makes get() throw instead of returning an empty list', err !== null && /HTTP 403/.test(err.message), String(err?.message));

    fake.failNext = { status: 403, times: 5 };
    err = null;
    const b = db.batch();
    b.set(db.collection('agents').doc('b'), { x: 1 });
    await b.commit().catch((e) => (err = e));
    check('a refused batch makes commit() throw', err !== null);

    fake.failNext = { status: 404, message: 'The database does not exist', state: 'NOT_FOUND', times: 5 };
    err = null;
    await db.collection('agents').doc('a').set({ x: 1 }).catch((e) => (err = e));
    check('a write to a missing database throws (a 404 on a write is an error, not "no document")', err !== null && /Firestore Database/.test(err.message), String(err?.message));
    fake.failNext = null;

    fake.failNext = { status: 503, message: 'unavailable', state: 'UNAVAILABLE', times: 1 };
    await db.collection('agents').doc('r').set({ ok: true });
    check('a short outage (one 503) is retried and the write still lands', (await db.collection('agents').doc('r').get()).data()?.ok === true);

    fake.failNext = { status: 500, message: 'backend error', state: 'INTERNAL', times: 10 };
    err = null;
    await db.collection('agents').doc('r').set({ ok: false }).catch((e) => (err = e));
    fake.failNext = null;
    check('a long outage gives up with an error after 3 tries', err !== null && /HTTP 500/.test(err.message), String(err?.message));
    check('and the stored value is unchanged', (await db.collection('agents').doc('r').get()).data()?.ok === true);

    fake.failNext = { status: 403, times: 5 };
    err = null;
    await db.healthCheck().catch((e) => (err = e));
    fake.failNext = null;
    check('the health check fails when Firestore refuses the server (it used to report "ok" regardless)', err !== null);

    const dead = createDb(() => createFirestoreBackend({ projectId: 'demo-project', restBase: 'http://127.0.0.1:1/v1', timeoutMs: 500 }));
    err = null;
    await dead.collection('agents').doc('r').get().catch((e) => (err = e));
    check('an unreachable database throws "cannot reach the database"', err !== null && /cannot reach/.test(err.message), String(err?.message));

    const noProject = createDb(() => createFirestoreBackend({ projectId: '', restBase: fake.url }));
    err = null;
    await noProject.collection('agents').doc('r').get().catch((e) => (err = e));
    check('a blank project id throws a clear message', err !== null && /project id is empty/.test(err.message), String(err?.message));
  } finally {
    await fake.close();
  }
}
