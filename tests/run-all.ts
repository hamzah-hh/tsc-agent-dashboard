import { summary } from './harness';
import { runDbTests } from './db.test';
import { runApiTests } from './api.test';

/**
 * Server tests: the database layer (against a fake Firestore that can fail on purpose) and the whole
 * HTTP API (against an in-memory database). No network, no Google account.
 *   npm run test:server
 */
async function main() {
  await runDbTests();
  await runApiTests();
  const failed = summary();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Server tests crashed:', err);
  process.exit(2);
});
