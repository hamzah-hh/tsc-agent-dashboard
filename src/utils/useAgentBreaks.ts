import { useEffect, useState } from 'react';
import { BreakDay } from '../shared/teamOps';
import { ApiError, cachedGet, hasFlag, setFlag } from './apiCache';

/**
 * The agent's Breaks tab days, newest first. An agent reads their own rows; staff viewing an agent are refused by
 * that route and read that agent's rows from the staff route (a TL only for their own team). The answer is shared
 * by every tab that needs it and reused for a minute.
 */
export function useAgentBreaks(getIdToken: () => Promise<string>, agentEmail: string) {
  const [breaks, setBreaks] = useState<BreakDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const email = (agentEmail || '').toLowerCase();

  useEffect(() => {
    let live = true;
    setBreaks(null);
    setError(null);
    (async () => {
      try {
        const staffRows = async () => (await cachedGet<{ breaks?: BreakDay[] }>(getIdToken, `/api/agent-breaks?agent=${encodeURIComponent(email)}`)).breaks || [];
        let rows: BreakDay[];
        if (hasFlag('staff')) {
          rows = await staffRows();
        } else {
          try {
            rows = (await cachedGet<{ breaks?: BreakDay[] }>(getIdToken, '/api/my-breaks')).breaks || [];
          } catch (err) {
            // Staff viewing an agent are refused by that route: they ask for just that agent's rows instead (and remember it)
            if (!(err instanceof ApiError) || err.status !== 403) throw err;
            setFlag('staff');
            rows = await staffRows();
          }
        }
        if (live) setBreaks([...rows].sort((a, b) => b.date.localeCompare(a.date)));
      } catch (err: any) {
        if (live) setError(err?.message || 'Could not load breaks.');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  return { breaks, error };
}
