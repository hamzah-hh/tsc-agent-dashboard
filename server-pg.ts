/**
 * Postgres (Neon) document backend: stores each document as one jsonb row in `doc_store`.
 * Used only when DB_MODE=postgres and DATABASE_URL is set; otherwise nothing here is loaded.
 * Uses Neon's HTTP driver: no connection to pool or leak on serverless. commit() is one
 * non-interactive transaction.
 */
import { neon } from '@neondatabase/serverless';
import type { Backend, QueryOpts, StoredDoc, Write } from './server-db';
import { MAX_WRITES_PER_COMMIT } from './server-db';

const clean = (p: string) => p.replace(/^\/+|\/+$/g, '');
const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');

const DDL = [
  `CREATE TABLE IF NOT EXISTS doc_store (
     path text PRIMARY KEY,
     parent text NOT NULL,
     id text NOT NULL,
     data jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS doc_store_parent_idx ON doc_store (parent)`,
];

export class PgDocBackend implements Backend {
  readonly kind = 'postgres' as const;
  private sql: ReturnType<typeof neon>;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      for (const stmt of DDL) await this.sql.query(stmt);
    })().catch((e) => {
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  async getDoc(docPath: string): Promise<any | null> {
    await this.init();
    const rows = (await this.sql.query('SELECT data FROM doc_store WHERE path = $1', [clean(docPath)])) as any[];
    return rows.length ? rows[0].data : null;
  }

  async listDocs(collectionPath: string, query: QueryOpts = {}): Promise<StoredDoc[]> {
    await this.init();
    const col = clean(collectionPath);
    const params: any[] = [col];
    let text = 'SELECT path, id, data FROM doc_store WHERE parent = $1';
    for (const w of query.where || []) {
      params.push(w.field, JSON.stringify(w.value));
      text += ` AND data -> $${params.length - 1} = $${params.length}::jsonb`;
    }
    if (query.orderBy) {
      params.push(query.orderBy.field);
      text += ` ORDER BY data -> $${params.length} ${query.orderBy.dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    if (query.limit !== undefined) {
      params.push(query.limit);
      text += ` LIMIT $${params.length}`;
    }
    const rows = (await this.sql.query(text, params)) as any[];
    return rows.map((r) => ({ id: r.id, path: r.path, data: r.data }));
  }

  async commit(writes: Write[]): Promise<void> {
    if (writes.length > MAX_WRITES_PER_COMMIT) {
      throw new Error(`commit() takes at most ${MAX_WRITES_PER_COMMIT} writes, got ${writes.length}`);
    }
    if (!writes.length) return;
    await this.init();
    const stmts = writes.map((w) => {
      const p = clean(w.path);
      if (w.op === 'delete') return this.sql.query('DELETE FROM doc_store WHERE path = $1', [p]);
      const conflict = w.merge ? 'doc_store.data || EXCLUDED.data' : 'EXCLUDED.data';
      return this.sql.query(
        `INSERT INTO doc_store (path, parent, id, data) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (path) DO UPDATE SET data = ${conflict}, updated_at = now()`,
        [p, parentOf(p), p.split('/').pop(), JSON.stringify(w.data ?? {})]
      );
    });
    await this.sql.transaction(stmts as any);
  }
}

export function createPgBackend(connectionString: string): PgDocBackend {
  return new PgDocBackend(connectionString);
}
