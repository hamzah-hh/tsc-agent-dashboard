/**
 * The relational database used by rostering (and, later, the other relational features). It reads
 * DATABASE_URL directly and does not depend on DB_MODE, so it works whether the rest of the app is on the
 * document store or not. Neon's HTTP driver is used: no connection to pool or leak on serverless, and a
 * batch() is one non-interactive transaction, so every "check, then write" must happen inside the SQL itself.
 */
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

export interface Stmt {
  text: string;
  params?: any[];
}

export interface Queryable {
  /** One statement, its rows. */
  query(text: string, params?: any[]): Promise<any[]>;
  /** Several statements in one transaction; the rows of each, in order. */
  batch(stmts: Stmt[]): Promise<any[][]>;
}

export function neonQueryable(connectionString: string): Queryable {
  const sql = neon(connectionString);
  return {
    async query(text, params) {
      return (await sql.query(text, params ?? [])) as any[];
    },
    async batch(stmts) {
      if (!stmts.length) return [];
      return (await sql.transaction(stmts.map((s) => sql.query(s.text, s.params ?? [])) as any)) as any[][];
    },
  };
}

let override: Queryable | null = null;
let cached: { url: string; db: Queryable } | null = null;

/** Tests hand in an in-memory database (PGlite); pass null to go back to DATABASE_URL. */
export function setRosterDbForTests(db: Queryable | null): void {
  override = db;
}

/** The roster database, or null when DATABASE_URL is not set (the routes then answer 503). */
export function getRosterDb(): Queryable | null {
  if (override) return override;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!cached || cached.url !== url) cached = { url, db: neonQueryable(url) };
  return cached.db;
}

/** Statements of a migration file: separated by a line that holds only "--;;"; blank pieces dropped. */
export function splitSql(script: string): string[] {
  return script
    .split(/^--;;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0);
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');

/** Applies every db/migrations/*.sql that is not recorded yet, each in its own transaction. Returns the names applied. */
export async function applyMigrations(db: Queryable, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).map((r) => String(r.name)));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const stmts = splitSql(fs.readFileSync(path.join(dir, file), 'utf8')).map((text) => ({ text }));
    stmts.push({ text: 'INSERT INTO schema_migrations (name) VALUES ($1)', params: [file] } as Stmt);
    await db.batch(stmts);
    applied.push(file);
  }
  return applied;
}
