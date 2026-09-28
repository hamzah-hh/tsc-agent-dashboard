import dotenv from 'dotenv';

let loaded = false;

/**
 * Loads .env.local and .env for local runs. Variables that the host already set (for example the
 * AI Studio secrets on the published app) always win. Safe to call many times.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  dotenv.config({ path: ['.env.local', '.env'], quiet: true });
}
