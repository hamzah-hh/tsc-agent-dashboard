/**
 * A small cache for read-only API calls, so moving between tabs does not download the same data again.
 * An answer is reused for a minute (or until a refresh button asks for a fresh one), calls that are already on
 * their way are shared, and the whole cache is emptied whenever someone signs in or out, so one person's data
 * is never shown to the next.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Entry {
  at: number;
  data: unknown;
}

const answers = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
// Things learned about the signed-in person (for example "staff, not an agent"), forgotten with the cache
const flags = new Set<string>();

export const hasFlag = (name: string) => flags.has(name);
export const setFlag = (name: string) => void flags.add(name);

export function clearApiCache(): void {
  answers.clear();
  inFlight.clear();
  flags.clear();
}

/** GET a JSON endpoint with the user's token, reusing a recent answer (default 60 s) unless `force` is set. */
export async function cachedGet<T = any>(getIdToken: () => Promise<string>, url: string, opts: { ttlMs?: number; force?: boolean } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? 60000;
  if (!opts.force) {
    const hit = answers.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.data as T;
    const running = inFlight.get(url);
    if (running) return running as Promise<T>;
  }
  const request = (async () => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, json?.error || `HTTP ${res.status}`);
    answers.set(url, { at: Date.now(), data: json });
    return json as T;
  })().finally(() => {
    if (inFlight.get(url) === request) inFlight.delete(url);
  });
  inFlight.set(url, request);
  return request;
}
