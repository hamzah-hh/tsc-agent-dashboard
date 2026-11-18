import { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterStatusResponse } from '../shared/roster';

export class RosterApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Calls a roster endpoint with the signed-in user's token. Errors carry the server's plain-English message. */
export async function rosterApi<T>(getIdToken: () => Promise<string>, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${await getIdToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RosterApiError(res.status, json?.error || `HTTP ${res.status}`, json?.code);
  return json as T;
}

/** A fresh key for one booking request, so a retry after a dropped connection cannot book twice. */
export function newRequestId(): string {
  const c: any = typeof crypto !== 'undefined' ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Whether the Roster tab is shown to this person, and the number on its badge. Re-checked every minute while
 * the page is visible. A failed call simply hides the tab: rostering must never get in the way of the rest.
 */
export function useRosterStatus(getIdToken: () => Promise<string>) {
  const [status, setStatus] = useState<RosterStatusResponse | null>(null);
  // While rostering is off for this person there is nothing to refresh: check once, then stop asking
  const off = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const next = await rosterApi<RosterStatusResponse>(getIdToken, 'GET', '/api/roster/status');
      off.current = !next.enabled;
      setStatus(next);
    } catch (_err) {
      off.current = true;
      setStatus({ enabled: false });
    }
  }, [getIdToken]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!off.current && (typeof document === 'undefined' || document.visibilityState === 'visible')) refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { status, refresh };
}
