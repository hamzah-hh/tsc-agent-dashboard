import fs from 'fs';
import path from 'path';

/**
 * Server-side database layer.
 *
 * The rest of the server talks to a small Firestore-like API (collection / doc / get / set / delete /
 * where / orderBy / limit / batch). Two backends sit behind it:
 *
 *  - FirestoreRestBackend: the real database, through the Firestore REST API. STRICT: every failed
 *    read or write throws, so a sync never reports "ok" for data that was not saved, and /api/health
 *    tells the truth. There is deliberately no silent fallback to a local file.
 *  - LocalBackend: an in-memory store (optionally kept in a JSON file). Only for local development and
 *    automated tests (DB_MODE=local). Never use it for the live app: nothing is shared with the browser.
 */

// ---------------------------------------------------------------------------
// Value conversion: JS <-> Firestore REST "Value" objects
// ---------------------------------------------------------------------------

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { nullValue: null };
    if (Number.isInteger(val) && Math.abs(val) <= Number.MAX_SAFE_INTEGER) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('referenceValue' in val) return val.referenceValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in val) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFirestoreValue(v);
    return out;
  }
  return null;
}

/** A REST document ({ name, fields }) as a plain object. A document with no fields is {}. */
export function fromFirestoreDoc(doc: any): any {
  if (!doc) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

// ---------------------------------------------------------------------------
// Backend contract
// ---------------------------------------------------------------------------

export type Write =
  | { op: 'set'; path: string; data: any; merge?: boolean }
  | { op: 'delete'; path: string };

export interface QueryOpts {
  where?: Array<{ field: string; value: any }>;
  orderBy?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
}

export interface StoredDoc {
  id: string;
  path: string;
  data: any;
}

export interface Backend {
  readonly kind: 'firestore' | 'local';
  /** The document's data, or null when it does not exist. Throws when the database cannot be read. */
  getDoc(path: string): Promise<any | null>;
  listDocs(collectionPath: string, query?: QueryOpts): Promise<StoredDoc[]>;
  /** Applies the writes as one unit (at most MAX_WRITES_PER_COMMIT). Throws when they were not saved. */
  commit(writes: Write[]): Promise<void>;
}

export const MAX_WRITES_PER_COMMIT = 400;

function cleanPath(p: string): string {
  return p.replace(/^\/+|\/+$/g, '');
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Firestore REST backend (strict)
// ---------------------------------------------------------------------------

export class FirestoreError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'FirestoreError';
    this.status = status;
  }
}

export interface FirestoreBackendOptions {
  projectId: string;
  databaseId?: string;
  apiKey?: string;
  /** Returns an OAuth access token for the server's service account, or null when there is none. */
  tokenProvider?: () => Promise<string | null>;
  /** host:port of the Firestore emulator (FIRESTORE_EMULATOR_HOST). No credentials are needed there. */
  emulatorHost?: string;
  /** Full REST base URL override, for tests (e.g. http://127.0.0.1:9000/v1). */
  restBase?: string;
  timeoutMs?: number;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A document path as it goes into a URL: each segment encoded (an "@" in an email id stays readable). */
function urlPath(p: string): string {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/%40/g, '@'))
    .join('/');
}

function fieldPathToken(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : '`' + key.replace(/[\\`]/g, '\\$&') + '`';
}

export class FirestoreRestBackend implements Backend {
  readonly kind = 'firestore' as const;
  private opts: FirestoreBackendOptions;

  constructor(opts: FirestoreBackendOptions) {
    this.opts = opts;
  }

  private get base(): string {
    if (this.opts.restBase) return this.opts.restBase.replace(/\/+$/, '');
    if (this.opts.emulatorHost) return `http://${this.opts.emulatorHost}/v1`;
    return 'https://firestore.googleapis.com/v1';
  }

  private get root(): string {
    if (!this.opts.projectId) {
      throw new FirestoreError(
        'The Firebase project id is empty. Put the live project\'s settings in firebase-applet-config.json (see firebase-config.example.json).'
      );
    }
    return `projects/${this.opts.projectId}/databases/${this.opts.databaseId || '(default)'}/documents`;
  }

  private async prepare(url: string): Promise<{ url: string; headers: Record<string, string>; authed: boolean }> {
    const headers: Record<string, string> = {};
    if (this.opts.emulatorHost) {
      headers.Authorization = 'Bearer owner';
      return { url, headers, authed: true };
    }
    let token: string | null = null;
    try {
      token = this.opts.tokenProvider ? await this.opts.tokenProvider() : null;
    } catch (_e) {
      token = null;
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      return { url, headers, authed: true };
    }
    // No service-account credentials: the request is anonymous, so the API key only identifies the project
    // and the security rules apply (they deny the server). The hint in explain() says so.
    if (this.opts.apiKey) url += (url.includes('?') ? '&' : '?') + `key=${encodeURIComponent(this.opts.apiKey)}`;
    return { url, headers, authed: false };
  }

  private explain(status: number, payload: any, what: string, authed: boolean): string {
    const err = Array.isArray(payload) ? payload[0]?.error : payload?.error;
    const code = err?.status ? ` ${err.status}` : '';
    const detail = err?.message ? `: ${err.message}` : '';
    let hint = '';
    if (status === 401 || status === 403) {
      hint = authed
        ? ' The server\'s service account may lack access: give it the "Cloud Datastore User" role on the Firebase project, and check that the project id in firebase-applet-config.json is the live project.'
        : ' The server has no Google credentials, so it called Firestore anonymously and the security rules refused it. On Cloud Run this is automatic (service account); on a PC set GOOGLE_APPLICATION_CREDENTIALS.';
    } else if (status === 404) {
      hint = ' The Firestore database was not found: create it in the Firebase console (Build > Firestore Database > Create database) and check firestoreDatabaseId in firebase-applet-config.json.';
    }
    return `Firestore ${what} failed: HTTP ${status}${code}${detail}.${hint}`;
  }

  /** One JSON request with a timeout and up to 3 tries on network errors / 5xx / 429. All calls are idempotent. */
  private async call(
    method: 'GET' | 'POST',
    urlPath: string,
    body: any,
    what: string,
    allow404 = false
  ): Promise<{ status: number; json: any }> {
    const prepared = await this.prepare(`${this.base}/${urlPath}`);
    let lastNetworkError: any = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(prepared.url, {
          method,
          headers: body !== undefined ? { ...prepared.headers, 'Content-Type': 'application/json' } : prepared.headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000),
        });
        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_e) {
          json = null;
        }
        if (res.ok) return { status: res.status, json };
        if (res.status === 404 && allow404) return { status: 404, json };
        if (RETRYABLE.has(res.status) && attempt < 2) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw new FirestoreError(this.explain(res.status, json, what, prepared.authed), res.status);
      } catch (err: any) {
        if (err instanceof FirestoreError) throw err;
        lastNetworkError = err;
        if (attempt < 2) await sleep(300 * (attempt + 1));
      }
    }
    throw new FirestoreError(
      `Firestore ${what} failed: cannot reach the database (${lastNetworkError?.message || 'network error'}).`
    );
  }

  async getDoc(docPath: string): Promise<any | null> {
    const p = cleanPath(docPath);
    const { status, json } = await this.call('GET', `${this.root}/${urlPath(p)}`, undefined, `read of ${p}`, true);
    if (status === 404) return null;
    return fromFirestoreDoc(json);
  }

  async listDocs(collectionPath: string, query: QueryOpts = {}): Promise<StoredDoc[]> {
    const p = cleanPath(collectionPath);
    const parts = p.split('/');
    const collectionId = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join('/');

    const structuredQuery: any = { from: [{ collectionId }] };
    const filters = (query.where || []).map((w) => ({
      fieldFilter: { field: { fieldPath: fieldPathToken(w.field) }, op: 'EQUAL', value: toFirestoreValue(w.value) },
    }));
    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    if (query.orderBy) {
      structuredQuery.orderBy = [
        {
          field: { fieldPath: fieldPathToken(query.orderBy.field) },
          direction: query.orderBy.dir === 'desc' ? 'DESCENDING' : 'ASCENDING',
        },
      ];
    }
    if (query.limit !== undefined) structuredQuery.limit = query.limit;

    const { json } = await this.call(
      'POST',
      `${this.root}${parent ? '/' + urlPath(parent) : ''}:runQuery`,
      { structuredQuery },
      `query of ${p}`
    );

    const docs: StoredDoc[] = [];
    for (const item of Array.isArray(json) ? json : []) {
      if (!item?.document) continue; // the last item of an empty result only carries readTime
      const docPath = String(item.document.name).split('/documents/')[1];
      docs.push({ id: docPath.split('/').pop() || '', path: docPath, data: fromFirestoreDoc(item.document) });
    }
    return docs;
  }

  async commit(writes: Write[]): Promise<void> {
    if (writes.length === 0) return;
    if (writes.length > MAX_WRITES_PER_COMMIT) {
      throw new Error(`commit() takes at most ${MAX_WRITES_PER_COMMIT} writes, got ${writes.length}`);
    }
    const root = this.root;
    const body = {
      writes: writes.map((w) => {
        const p = cleanPath(w.path);
        if (w.op === 'delete') return { delete: `${root}/${p}` };
        const fields: Record<string, any> = {};
        for (const [k, v] of Object.entries(w.data || {})) if (v !== undefined) fields[k] = toFirestoreValue(v);
        return {
          update: { name: `${root}/${p}`, fields },
          // merge = only the listed top-level fields change; without a mask the document is replaced
          ...(w.merge ? { updateMask: { fieldPaths: Object.keys(fields).map(fieldPathToken) } } : {}),
        };
      }),
    };
    await this.call('POST', `${root}:commit`, body, `write of ${writes.length} document(s) (${writes[0].path}${writes.length > 1 ? ', ...' : ''})`);
  }
}

// ---------------------------------------------------------------------------
// Local backend (development and tests only)
// ---------------------------------------------------------------------------

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private docs = new Map<string, any>();
  private file: string | null;

  constructor(file: string | null) {
    this.file = file ? path.resolve(process.cwd(), file) : null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(data)) this.docs.set(k, v);
      } catch (_e) {
        // a damaged local file is ignored: this store is only a development convenience
      }
    }
  }

  private persist() {
    if (!this.file) return;
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.docs), null, 2), 'utf8');
  }

  async getDoc(docPath: string): Promise<any | null> {
    const v = this.docs.get(cleanPath(docPath));
    return v === undefined ? null : clone(v);
  }

  async listDocs(collectionPath: string, query: QueryOpts = {}): Promise<StoredDoc[]> {
    const prefix = cleanPath(collectionPath) + '/';
    let out: StoredDoc[] = [];
    for (const [k, v] of this.docs.entries()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (rest.includes('/')) continue;
      out.push({ id: rest, path: k, data: clone(v) });
    }
    for (const w of query.where || []) out = out.filter((d) => d.data && d.data[w.field] === w.value);
    if (query.orderBy) {
      const { field, dir } = query.orderBy;
      out.sort((a, b) => {
        const va = a.data?.[field];
        const vb = b.data?.[field];
        const c = va > vb ? 1 : va < vb ? -1 : 0;
        return dir === 'desc' ? -c : c;
      });
    }
    if (query.limit !== undefined) out = out.slice(0, query.limit);
    return out;
  }

  async commit(writes: Write[]): Promise<void> {
    for (const w of writes) {
      const p = cleanPath(w.path);
      if (w.op === 'delete') {
        this.docs.delete(p);
      } else if (w.merge) {
        this.docs.set(p, { ...(this.docs.get(p) || {}), ...clone(w.data) });
      } else {
        this.docs.set(p, clone(w.data));
      }
    }
    this.persist();
  }
}

// ---------------------------------------------------------------------------
// Firestore-like facade used by the server code
// ---------------------------------------------------------------------------

export interface DocSnap {
  id: string;
  exists: boolean;
  data: () => any;
  ref: DocRef;
}

export interface QuerySnap {
  docs: DocSnap[];
  empty: boolean;
  size: number;
  forEach: (fn: (doc: DocSnap) => void) => void;
}

function querySnap(docs: DocSnap[]): QuerySnap {
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

export class DocRef {
  path: string;
  constructor(private db: Db, docPath: string) {
    this.path = cleanPath(docPath);
  }

  get id(): string {
    return this.path.split('/').pop() || '';
  }

  collection(sub: string): CollectionRef {
    return new CollectionRef(this.db, `${this.path}/${cleanPath(sub)}`);
  }

  async get(): Promise<DocSnap> {
    const data = await this.db.backend().getDoc(this.path);
    return { id: this.id, exists: data !== null, data: () => (data === null ? undefined : data), ref: this };
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    await this.db.backend().commit([{ op: 'set', path: this.path, data, merge: options?.merge }]);
  }

  async delete(): Promise<void> {
    await this.db.backend().commit([{ op: 'delete', path: this.path }]);
  }
}

export class Query {
  constructor(protected db: Db, protected collectionPath: string, protected opts: QueryOpts = {}) {}

  where(field: string, op: string, value: any): Query {
    if (op !== '==') throw new Error(`Only "==" filters are supported (got "${op}")`);
    return new Query(this.db, this.collectionPath, {
      ...this.opts,
      where: [...(this.opts.where || []), { field, value }],
    });
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Query {
    return new Query(this.db, this.collectionPath, { ...this.opts, orderBy: { field, dir } });
  }

  limit(count: number): Query {
    return new Query(this.db, this.collectionPath, { ...this.opts, limit: count });
  }

  async get(): Promise<QuerySnap> {
    const found = await this.db.backend().listDocs(this.collectionPath, this.opts);
    return querySnap(
      found.map((d) => ({
        id: d.id,
        exists: true,
        data: () => d.data,
        ref: new DocRef(this.db, d.path),
      }))
    );
  }
}

export class CollectionRef extends Query {
  constructor(db: Db, collectionPath: string) {
    super(db, cleanPath(collectionPath));
  }

  get path(): string {
    return this.collectionPath;
  }

  doc(id?: string): DocRef {
    const docId = id || Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    return new DocRef(this.db, `${this.collectionPath}/${docId}`);
  }

  async add(data: any): Promise<DocRef> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

export class Batch {
  private writes: Write[] = [];
  constructor(private db: Db) {}

  set(ref: DocRef, data: any, options?: { merge?: boolean }): Batch {
    this.writes.push({ op: 'set', path: ref.path, data, merge: options?.merge });
    return this;
  }

  delete(ref: DocRef): Batch {
    this.writes.push({ op: 'delete', path: ref.path });
    return this;
  }

  get size(): number {
    return this.writes.length;
  }

  /** Saves everything, in commits of at most 400 writes. Throws on the first failed commit. */
  async commit(): Promise<void> {
    for (let i = 0; i < this.writes.length; i += MAX_WRITES_PER_COMMIT) {
      await this.db.backend().commit(this.writes.slice(i, i + MAX_WRITES_PER_COMMIT));
    }
    this.writes = [];
  }
}

export class Db {
  constructor(private getBackend: () => Backend) {}

  backend(): Backend {
    return this.getBackend();
  }

  get kind(): 'firestore' | 'local' {
    return this.getBackend().kind;
  }

  collection(collectionPath: string): CollectionRef {
    return new CollectionRef(this, collectionPath);
  }

  batch(): Batch {
    return new Batch(this);
  }

  /** Writes health/ping and reads it back. Throws with the reason when the database is not usable. */
  async healthCheck(): Promise<void> {
    const time = new Date().toISOString();
    await this.backend().commit([{ op: 'set', path: 'health/ping', data: { time } }]);
    const back = await this.backend().getDoc('health/ping');
    if (!back || back.time !== time) {
      throw new Error('Health ping verify failed: the value read back does not match the value written.');
    }
  }
}

/** `getBackend` runs on first use, so environment variables are read after they are loaded. */
export function createDb(getBackend: () => Backend): Db {
  return new Db(getBackend);
}

export function createFirestoreBackend(opts: FirestoreBackendOptions): FirestoreRestBackend {
  return new FirestoreRestBackend(opts);
}

export function createLocalBackend(file: string | null): LocalBackend {
  return new LocalBackend(file);
}
