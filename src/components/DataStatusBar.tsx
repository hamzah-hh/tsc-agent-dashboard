import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { daysOld } from './StaleBanner';

export interface DataStatus {
  /** ISO time of the last successful sync. */
  syncedAt: string | null;
  /** Latest data date that sync carried ('YYYY-MM-DD'). */
  lastDataDate: string | null;
  lastFailed?: boolean;
}

const DataStatusContext = createContext<DataStatus | null>(null);

/** The data status of the signed-in session (null until loaded), e.g. for naming an export. */
export function useDataStatus(): DataStatus | null {
  return useContext(DataStatusContext);
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The top section of every page: when the data was last updated (the last successful sync) and the latest
 * date of data in it. Turns amber when the data is more than 2 days old or the last sync failed.
 */
export function DataStatusProvider({
  enabled,
  getIdToken,
  children,
}: {
  enabled: boolean;
  getIdToken: () => Promise<string>;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/data-status', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const stale = Boolean(status?.lastDataDate) && daysOld(status!.lastDataDate) > 2;
  const warn = stale || Boolean(status?.lastFailed);

  return (
    <DataStatusContext.Provider value={status}>
      {enabled && (
        <div
          role="status"
          className={`mb-4 px-4 py-2 rounded-xl border text-xs flex flex-wrap items-center gap-x-4 gap-y-1 shadow-xs ${
            warn
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
          }`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          {status?.syncedAt ? (
            <>
              <span>
                Data last updated: <b>{fmtTime(status.syncedAt)}</b> IST
              </span>
              {status.lastDataDate && (
                <span>
                  Data up to: <b>{fmtDate(status.lastDataDate)}</b>
                  {stale ? ` (${daysOld(status.lastDataDate)} days ago)` : ''}
                </span>
              )}
              {status.lastFailed && <span className="font-semibold">The latest sync failed; this is from the last good one.</span>}
            </>
          ) : failed ? (
            <span>Could not check when the data was last updated.</span>
          ) : status ? (
            <span>No sync yet.</span>
          ) : (
            <span>Checking when the data was last updated...</span>
          )}
          <button onClick={load} disabled={busy} className="ml-auto p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10" title="Check again" aria-label="Check again">
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
      {children}
    </DataStatusContext.Provider>
  );
}
