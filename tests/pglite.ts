/** An in-memory Postgres (PGlite) with the roster migrations applied, for the server tests. devDependency only. */
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, Queryable } from '../server-roster-db';

export async function createTestRosterDb(): Promise<Queryable> {
  const pg = new PGlite();
  const db: Queryable = {
    async query(text, params) {
      return (await pg.query(text, params ?? [])).rows as any[];
    },
    async batch(stmts) {
      return await pg.transaction(async (tx) => {
        const out: any[][] = [];
        for (const s of stmts) out.push((await tx.query(s.text, s.params ?? [])).rows as any[]);
        return out;
      });
    },
  };
  await applyMigrations(db);
  return db;
}
