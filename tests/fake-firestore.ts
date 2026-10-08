import http from 'http';
import type { AddressInfo } from 'net';

/**
 * A small stand-in for the Firestore REST API (get, commit, runQuery) so the real
 * FirestoreRestBackend can be tested without a network or a Google account. It can also be told to
 * fail, to prove that a failed save is never reported as success.
 */
export interface FakeFirestore {
  url: string; // http://127.0.0.1:PORT/v1
  docs: Map<string, Record<string, any>>; // "cycles/c1/agents/a" -> REST fields
  requests: Array<{ method: string; path: string; query: string; auth: string | null; body: any }>;
  /** Answer the next `times` requests with this HTTP status instead of working. */
  failNext: { status: number; message?: string; state?: string; times: number } | null;
  close(): Promise<void>;
}

function decode(v: any): any {
  if (!v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  return null;
}

export async function startFakeFirestore(): Promise<FakeFirestore> {
  const docs = new Map<string, Record<string, any>>();
  const requests: FakeFirestore['requests'] = [];
  const fake = { docs, requests, failNext: null } as unknown as FakeFirestore;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : null;
    const u = new URL(req.url || '/', 'http://fake');
    const pathname = decodeURIComponent(u.pathname);
    requests.push({
      method: req.method || 'GET',
      path: pathname,
      query: u.search,
      auth: (req.headers.authorization as string) || null,
      body,
    });

    const send = (status: number, payload: any) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };

    if (fake.failNext && fake.failNext.times > 0) {
      fake.failNext.times--;
      const f = fake.failNext;
      return send(f.status, {
        error: { code: f.status, message: f.message || 'Injected failure', status: f.state || 'PERMISSION_DENIED' },
      });
    }

    const m = /^\/v1\/projects\/([^/]+)\/databases\/([^/]+)\/documents(.*)$/.exec(pathname);
    if (!m) return send(404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
    const rest = m[3];
    const prefix = `projects/${m[1]}/databases/${m[2]}/documents/`;

    if (req.method === 'POST' && rest === ':commit') {
      for (const w of body.writes || []) {
        if (w.delete) {
          docs.delete(String(w.delete).slice(prefix.length));
        } else if (w.update) {
          const p = String(w.update.name).slice(prefix.length);
          if (w.updateMask) {
            const cur = { ...(docs.get(p) || {}) };
            for (const fp of w.updateMask.fieldPaths as string[]) {
              const key = fp.replace(/^`|`$/g, '');
              if (key in (w.update.fields || {})) cur[key] = w.update.fields[key];
              else delete cur[key];
            }
            docs.set(p, cur);
          } else {
            docs.set(p, w.update.fields || {});
          }
        }
      }
      return send(200, { writeResults: (body.writes || []).map(() => ({})), commitTime: new Date().toISOString() });
    }

    if (req.method === 'POST' && rest.endsWith(':runQuery')) {
      const parent = rest.slice(1, rest.length - ':runQuery'.length); // '' or 'cycles/c1'
      const q = body.structuredQuery;
      const collectionId = q.from[0].collectionId;
      const base = parent ? `${parent}/${collectionId}/` : `${collectionId}/`;
      let found = [...docs.entries()].filter(([k]) => k.startsWith(base) && !k.slice(base.length).includes('/'));

      const filters: any[] = q.where
        ? q.where.compositeFilter
          ? q.where.compositeFilter.filters
          : [q.where]
        : [];
      for (const f of filters) {
        const field = f.fieldFilter.field.fieldPath;
        const want = JSON.stringify(f.fieldFilter.value);
        found = found.filter(([, fields]) => JSON.stringify(fields[field]) === want);
      }
      if (q.orderBy) {
        const field = q.orderBy[0].field.fieldPath;
        const dir = q.orderBy[0].direction === 'DESCENDING' ? -1 : 1;
        found.sort(([, a], [, b]) => {
          const va = decode(a[field]);
          const vb = decode(b[field]);
          return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
        });
      }
      if (q.limit !== undefined) found = found.slice(0, q.limit);

      const out: any[] = found.map(([k, fields]) => ({
        document: { name: prefix + k, fields, createTime: 'x', updateTime: 'x' },
        readTime: new Date().toISOString(),
      }));
      if (out.length === 0) out.push({ readTime: new Date().toISOString() });
      return send(200, out);
    }

    if (req.method === 'GET' && rest.startsWith('/')) {
      const p = rest.slice(1);
      const fields = docs.get(p);
      if (!fields) return send(404, { error: { code: 404, message: 'Document not found', status: 'NOT_FOUND' } });
      return send(200, { name: prefix + p, fields, createTime: 'x', updateTime: 'x' });
    }

    return send(400, { error: { code: 400, message: 'unsupported in fake', status: 'INVALID_ARGUMENT' } });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  fake.url = `http://127.0.0.1:${port}/v1`;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}
