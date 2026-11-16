import React, { useEffect, useMemo, useState } from 'react';
import { AgentRecord } from '../shared/types';
import {
  AGENT_BREAK_COLUMNS as BREAK_COLUMNS,
  BreakDay,
  PRODUCTIVITY_RULES,
  breakAverages,
  hms,
  lowConnects,
  lowTalk,
  overLimit,
  prodStats,
} from '../shared/teamOps';
import { formatNumberINR } from '../shared/incentive';
import { csvName, csvStamp } from '../utils/csv';
import { ExportCsvButton } from './ExportCsvButton';
import { AgentBreaksSection } from './AgentBreaksSection';
import { SortTh } from './SortTh';
import { DateRangeFilter, inDateRange, useDateRange } from './DateRangeFilter';
import { useSort } from '../utils/useSort';

interface CallMetricsTabProps {
  agentRecord: AgentRecord | null;
  getIdToken: () => Promise<string>;
  /** Pre Sales have no Dialer, so only their breaks are shown. */
  showCallMetrics: boolean;
}

const CARD = 'bg-white/95 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs';

// Short names for the break tiles (the table keeps the full column names)
const BREAK_TILE_LABEL: Record<string, string> = {
  bio: 'Bio / Misc Break',
  first: 'First Break',
  lunch: 'Lunch',
  last: 'Last Break',
  total: 'Total Daily Break',
  acw: 'After Call Work',
  idle: 'Idle Time',
  idleAcw: 'Idle Time + ACW',
  staffed: 'Staffed Duration',
  idleAcwPct: 'Idle + ACW %',
};

const monthDay = (d: string) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

/** One headline number, red when it misses its target or limit. */
function Tile({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        red
          ? 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10'
          : 'border-slate-200 bg-slate-50/70 dark:border-line dark:bg-raised'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
      <p className={`mt-1 text-2xl font-black font-mono tabular-nums ${red ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-fg'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

const TILE_GRID = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-5';

/** The agent's Day on Day unique connects and talk time, and their Breaks, with a summary of each metric. */
export function CallMetricsTab({ agentRecord, getIdToken, showCallMetrics }: CallMetricsTabProps) {
  const name = agentRecord?.name || 'agent';

  // Newest day first; days with no Dialer row (day null/0) are not worked days
  const allDays = useMemo(
    () => [...(agentRecord?.daily || [])].filter((x) => x.day === 1 || x.day === 0.5).sort((a, b) => b.date.localeCompare(a.date)),
    [agentRecord]
  );

  // The agent's own Breaks tab days (the server only returns them to the agent)
  const [allBreaks, setAllBreaks] = useState<BreakDay[] | null>(null);
  const [breaksError, setBreaksError] = useState<string | null>(null);
  const agentEmail = (agentRecord?.officialEmail || '').toLowerCase();
  useEffect(() => {
    let live = true;
    setAllBreaks(null);
    setBreaksError(null);
    (async () => {
      try {
        const headers = { Authorization: `Bearer ${await getIdToken()}` };
        let res = await fetch('/api/my-breaks', { headers });
        let json: any = await res.json().catch(() => ({}));
        let rows: BreakDay[] = json.breaks || [];
        if (res.status === 403) {
          // Staff viewing an agent: the agent-only route refuses them, so read the agent's rows from the
          // Team Summary, which is already limited to the teams they may see.
          res = await fetch('/api/team-summary', { headers });
          json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          rows = ((json.breaks || []) as BreakDay[]).filter((b) => (b.agentEmail || '').toLowerCase() === agentEmail);
        } else if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        if (live) setAllBreaks([...rows].sort((a, b) => b.date.localeCompare(a.date)));
      } catch (err: any) {
        if (live) setBreaksError(err?.message || 'Could not load breaks.');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentEmail]);

  // One range for the whole page: month to date until another one is picked
  const dates = [...allDays.map((d) => d.date), ...(allBreaks || []).map((b) => b.date)];
  const firstDay = dates.reduce((m, d) => (!m || d < m ? d : m), '');
  const lastDay = dates.reduce((m, d) => (d > m ? d : m), '');
  const { from, to, set: setRange } = useDateRange(firstDay, lastDay);

  const dodDays = useMemo(() => allDays.filter((d) => inDateRange(d.date, from, to)), [allDays, from, to]);
  const breakDays = useMemo(() => (allBreaks ? allBreaks.filter((b) => inDateRange(b.date, from, to)) : null), [allBreaks, from, to]);

  const sort = useSort(dodDays, {
    date: (d) => d.date,
    day: (d) => d.day,
    connects: (d) => d.connects,
    talk: (d) => d.talkSeconds,
  });

  const prod = prodStats(dodDays.map((d) => ({ agentEmail: '', date: d.date, day: d.day, connects: d.connects, talkSeconds: d.talkSeconds })));
  const totalConnects = dodDays.reduce((s, d) => s + d.connects, 0);
  const totalTalk = dodDays.reduce((s, d) => s + d.talkSeconds, 0);
  const brk = breakAverages(breakDays || []);
  const num1 = (n: number | null) => (n === null ? '-' : formatNumberINR(n, 1));

  const rangeText = from && to ? `${monthDay(from)} to ${monthDay(to)}` : 'all days';

  const callSummary = (
    <div className={TILE_GRID}>
      <Tile label="Days worked" value={num1(prod.agentDays)} sub={`${dodDays.length} day${dodDays.length === 1 ? '' : 's'} with Dialer data`} />
      <Tile
        label="Avg unique connects / day"
        value={num1(prod.avgConnects)}
        sub={`Target ${PRODUCTIVITY_RULES.minUniqueConnectsPerDay}`}
        red={lowConnects(prod.avgConnects)}
      />
      <Tile label="Total unique connects" value={formatNumberINR(totalConnects, 0)} />
      <Tile
        label="Avg talk time / day"
        value={hms(prod.avgTalk)}
        sub={`Target ${hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)}`}
        red={lowTalk(prod.avgTalk)}
      />
      <Tile label="Total talk time" value={hms(totalTalk)} />
      <Tile
        label="Days below connects target"
        value={String(prod.daysLowConnects)}
        sub={`of ${dodDays.length}`}
        red={prod.daysLowConnects > 0}
      />
      <Tile
        label="Days below talk-time target"
        value={String(prod.daysLowTalk)}
        sub={`of ${dodDays.length}`}
        red={prod.daysLowTalk > 0}
      />
    </div>
  );

  const breaksSummary =
    breakDays && breakDays.length > 0 ? (
      <div className={TILE_GRID}>
        {BREAK_COLUMNS.map((c) => {
          const v = brk[c.key];
          const limit = c.limitSec !== undefined ? `Limit ${hms(c.limitSec)}` : c.limitPct !== undefined ? `Limit ${c.limitPct.toFixed(1)}%` : 'Daily average';
          return (
            <Tile
              key={c.key}
              label={`Avg ${BREAK_TILE_LABEL[c.key]}`}
              value={v === null ? '-' : c.key === 'idleAcwPct' ? `${v.toFixed(1)}%` : hms(v)}
              sub={limit}
              red={overLimit(c.key, v)}
            />
          );
        })}
        <Tile label="Days over a limit" value={String(brk.daysOver)} sub={`of ${brk.days} day${brk.days === 1 ? '' : 's'}`} red={brk.daysOver > 0} />
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg">Connects, Talk Time &amp; Breaks</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Summary and daily detail for {rangeText}. Averages are per worked day.
          </p>
        </div>
        <DateRangeFilter from={from} to={to} min={firstDay} max={lastDay} onChange={setRange} />
      </div>

      {showCallMetrics && (
        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between mb-1 gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              Day on Day: Connects & Talk Time
            </span>
            <ExportCsvButton
              filename={csvName('call-metrics', name, csvStamp())}
              disabled={dodDays.length === 0}
              getRows={() => [
                ['Date', 'Day', 'Unique Connects', 'Talk Time'],
                ...dodDays.map((d) => [d.date, d.day === 0.5 ? 'Half Day' : 'Full Day', d.connects, hms(d.talkSeconds)]),
              ]}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
            Daily target: {PRODUCTIVITY_RULES.minUniqueConnectsPerDay} unique connects and {hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)} talk time (half for a half day). Red means below target.
          </p>
          {dodDays.length > 0 && callSummary}
          {dodDays.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">No daily data in this date range</div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                  <tr>
                    <SortTh sort={sort} k="date" className="py-2 pr-3 font-semibold">Date</SortTh>
                    <SortTh sort={sort} k="day" className="py-2 pr-3 font-semibold">Day</SortTh>
                    <SortTh sort={sort} k="connects" right className="py-2 pr-3 font-semibold text-right">Unique Connects</SortTh>
                    <SortTh sort={sort} k="talk" right className="py-2 font-semibold text-right">Talk Time</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sort.sorted.map((d) => {
                    const factor = d.day === 0.5 ? 0.5 : 1;
                    const lowC = lowConnects(d.connects, factor);
                    const lowT = lowTalk(d.talkSeconds, factor);
                    return (
                      <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-3 font-mono">{d.date}</td>
                        <td className="py-1.5 pr-3">{d.day === 1 ? 'Full Day' : 'Half Day'}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${lowC ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{d.connects}</td>
                        <td className={`py-1.5 text-right tabular-nums ${lowT ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{hms(d.talkSeconds)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <AgentBreaksSection days={breakDays} error={breaksError} agentName={name} summary={breaksSummary} />
    </div>
  );
}
