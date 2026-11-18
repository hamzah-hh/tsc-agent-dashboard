import { useEffect, useState } from 'react';
import { BreakDay } from '../shared/teamOps';

/**
 * The agent's Breaks tab days, newest first. An agent reads their own rows; staff viewing an agent are refused
 * by that route, so theirs come from the Team Summary, which is already limited to the teams they may see.
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
        const headers = { Authorization: `Bearer ${await getIdToken()}` };
        let res = await fetch('/api/my-breaks', { headers });
        let json: any = await res.json().catch(() => ({}));
        let rows: BreakDay[] = json.breaks || [];
        if (res.status === 403) {
          res = await fetch('/api/team-summary', { headers });
          json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          rows = ((json.breaks || []) as BreakDay[]).filter((b) => (b.agentEmail || '').toLowerCase() === email);
        } else if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
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
