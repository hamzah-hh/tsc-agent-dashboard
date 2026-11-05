import React, { useEffect, useState } from 'react';
import { ExportCsvButton } from './ExportCsvButton';
import { csvName, csvStamp } from '../utils/csv';
import { BREAK_COLUMNS, BreakDay, hms, idleAcwPct } from '../shared/teamOps';

interface AgentBreaksSectionProps {
  getIdToken: () => Promise<string>;
  agentName: string;
}

const RED = 'text-red-600 dark:text-red-400 font-semibold';

/** The agent's own Breaks tab days, newest first; a value past its daily limit is red. */
export function AgentBreaksSection({ getIdToken, agentName }: AgentBreaksSectionProps) {
  const [days, setDays] = useState<BreakDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/my-breaks', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 403 ? 'Breaks are shown to the agent only.' : json.error || `HTTP ${res.status}`);
        if (live) setDays([...(json.breaks || [])].sort((a: BreakDay, b: BreakDay) => b.date.localeCompare(a.date)));
      } catch (err: any) {
        if (live) setError(err?.message || 'Could not load breaks.');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valueOf = (d: BreakDay, key: (typeof BREAK_COLUMNS)[number]['key']): number | null =>
    key === 'idleAcwPct' ? idleAcwPct(d.idleAcw, d.staffed) : d[key];
  const show = (key: (typeof BREAK_COLUMNS)[number]['key'], v: number | null) =>
    v === null ? '-' : key === 'idleAcwPct' ? `${v.toFixed(1)}%` : hms(v);
  const isRed = (col: (typeof BREAK_COLUMNS)[number], v: number | null) =>
    v !== null && ((col.limitSec !== undefined && Math.round(v) > col.limitSec) || (col.limitPct !== undefined && v > col.limitPct));

  return (
    <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
          12. Day on Day: Breaks
        </span>
        <ExportCsvButton
          filename={csvName('breaks', agentName, csvStamp())}
          disabled={!days || days.length === 0}
          getRows={() => [
            ['Date', 'Day', ...BREAK_COLUMNS.map((c) => c.label)],
            ...(days || []).map((d) => [
              d.date,
              d.dayType === 0.5 ? 'Half Day' : 'Full Day',
              ...BREAK_COLUMNS.map((c) => show(c.key, valueOf(d, c.key))),
            ]),
          ]}
        />
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
        Red means over the daily limit: Bio 20m, First 15m, Lunch 30m, Last 15m, Total break 1h 20m, Idle + ACW 30.6% of staffed time.
      </p>
      {error ? (
        <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">{error}</div>
      ) : days === null ? (
        <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">Loading...</div>
      ) : days.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">No break data recorded yet</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Day</th>
                {BREAK_COLUMNS.map((c) => (
                  <th key={c.key} className="py-2 pr-3 font-semibold text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3 font-mono">{d.date}</td>
                  <td className="py-1.5 pr-3">{d.dayType === 0.5 ? 'Half Day' : 'Full Day'}</td>
                  {BREAK_COLUMNS.map((c) => {
                    const v = valueOf(d, c.key);
                    return (
                      <td key={c.key} className={`py-1.5 pr-3 text-right tabular-nums ${isRed(c, v) ? RED : ''}`}>
                        {show(c.key, v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
