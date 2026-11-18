/**
 * Applies the SQL files in db/migrations that have not been applied yet.
 *   npm run db:migrate
 * Uses DATABASE_URL_UNPOOLED, else DATABASE_URL (the owner connection: the app's own role should have no DDL rights).
 * Never prints the connection string.
 */
import { loadEnv } from '../server-env';
import { applyMigrations, neonQueryable } from '../server-roster-db';

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL_UNPOOLED or DATABASE_URL first.');
    process.exit(1);
  }
  const applied = await applyMigrations(neonQueryable(url));
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply: the database is up to date.');
}

main().catch((err) => {
  console.error('Migration failed:', String(err?.message || err).replace(/postgres(ql)?:\/\/\S+/g, '[redacted]'));
  process.exit(1);
});
