import React, { useMemo } from 'react';
import { AgentRecord } from '../shared/types';
import { PRODUCTIVITY_RULES, hms, lowConnects, lowTalk, prodStats } from '../shared/teamOps';
import { formatNumberINR } from '../shared/incentive';
import { csvName, csvStamp } from '../utils/csv';
import { ExportCsvButton } from './ExportCsvButton';
import { SortTh } from './SortTh';
import { CARD, Tile, TILE_GRID, rangeLabel } from './MetricTile';
import { DateRangeFilter, inDateRange, useDateRange } from './DateRangeFilter';
import { useSort } from '../utils/useSort';

interface CallMetricsTabProps {
  agentRecord: AgentRecord | null;
  /** Pre Sales take inbound calls: no Dialer, so no outbound calls or unique connects. */
  isPreSales: boolean;
}

const dash = (n: number | undefined | null, f: (v: number) => string) => (n === undefined || n === null ? '-' : f(n));

/**
 * Call Metrics: every worked day's Total_Outbound_Calls, Total_Unique_Connected_Calls and talk time, with a
 * summary of each at the top. Pre Sales see their inbound calls and talk time per call instead.
 */
export function CallMetricsTab({ agentRecord, isPreSales }: CallMetricsTabProps) {
  const name = agentRecord?.name || 'agent';

  // Newest day first. Dialer agents: days with a Dialer row (day 1 or 0.5). Pre Sales: days with calls.
  const allDays = useMemo(
    () =>
      [...(agentRecord?.daily || [])]
        .filter((x) => (isPreSales ? x.day > 0 || (x.calls ?? 0) > 0 : x.day === 1 || x.day === 0.5))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [agentRecord, isPreSales]
  );
  const firstDay = allDays.length ? allDays[allDays.length - 1].date : '';
  const lastDay = allDays.length ? allDays[0].date : '';
  const { from, to, set: setRange } = useDateRange(firstDay, lastDay);
  const days = useMemo(() => allDays.filter((d) => inDateRange(d.date, from, to)), [allDays, from, to]);

  const sort = useSort(days, {
    date: (d) => d.date,
    day: (d) => d.day,
    outbound: (d) => d.outbound,
    connects: (d) => d.connects,
    calls: (d) => d.calls,
    avgTalk: (d) => d.avgTalkSec,
    talk: (d) => d.talkSeconds,
  });

  const num1 = (n: number | null) => (n === null ? '-' : formatNumberINR(n, 1));
  const totalTalk = days.reduce((s, d) => s + d.talkSeconds, 0);

  let tiles: React.ReactNode;
  if (isPreSales) {
    const calls = days.reduce((s, d) => s + (d.calls ?? 0), 0);
    const worked = days.reduce((s, d) => s + (d.day > 0 ? d.day : (d.calls ?? 0) > 0 ? 1 : 0), 0);
    const weighted = days.reduce((s, d) => s + (d.avgTalkSec ?? 0) * (d.calls ?? 0), 0);
    tiles = (
      <div className={TILE_GRID}>
        <Tile label="Days worked" value={num1(worked)} sub={`${days.length} day${days.length === 1 ? '' : 's'} with calls`} />
        <Tile label="Total inbound calls" value={formatNumberINR(calls, 0)} />
        <Tile label="Avg inbound calls / day" value={worked > 0 ? num1(calls / worked) : '-'} />
        <Tile label="Avg talk time / call" value={calls > 0 ? `${Math.round(weighted / calls)}s` : '-'} sub="Weighted by each day's calls" />
        <Tile label="Total talk time" value={hms(totalTalk)} />
      </div>
    );
  } else {
    const prod = prodStats(days.map((d) => ({ agentEmail: '', date: d.date, day: d.day, connects: d.connects, talkSeconds: d.talkSeconds })));
    const totalConnects = days.reduce((s, d) => s + d.connects, 0);
    const withOutbound = days.filter((d) => d.outbound !== undefined);
    const totalOutbound = withOutbound.reduce((s, d) => s + (d.outbound ?? 0), 0);
    const outboundDays = withOutbound.reduce((s, d) => s + d.day, 0);
    tiles = (
      <div className={TILE_GRID}>
        <Tile label="Days worked" value={num1(prod.agentDays)} sub={`${days.length} day${days.length === 1 ? '' : 's'} with Dialer data`} />
        <Tile label="Total outbound calls" value={withOutbound.length ? formatNumberINR(totalOutbound, 0) : '-'} sub={withOutbound.length && withOutbound.length < days.length ? `${withOutbound.length} of ${days.length} days have it` : undefined} />
        <Tile label="Avg outbound calls / day" value={outboundDays > 0 ? num1(totalOutbound / outboundDays) : '-'} />
        <Tile label="Total unique connects" value={formatNumberINR(totalConnects, 0)} />
        <Tile label="Avg unique connects / day" value={num1(prod.avgConnects)} sub={`Target ${PRODUCTIVITY_RULES.minUniqueConnectsPerDay}`} red={lowConnects(prod.avgConnects)} />
        <Tile label="Total talk time" value={hms(totalTalk)} />
        <Tile label="Avg talk time / day" value={hms(prod.avgTalk)} sub={`Target ${hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)}`} red={lowTalk(prod.avgTalk)} />
        <Tile label="Days below connects target" value={String(prod.daysLowConnects)} sub={`of ${days.length}`} red={prod.daysLowConnects > 0} />
        <Tile label="Days below talk-time target" value={String(prod.daysLowTalk)} sub={`of ${days.length}`} red={prod.daysLowTalk > 0} />
      </div>
    );
  }

  const RED = 'text-red-600 dark:text-red-400 font-semibold';

  return (
    <div className="space-y-6">
      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg">Call Metrics</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isPreSales ? 'Inbound calls and talk time' : 'Outbound calls, unique connects and talk time'} for {rangeLabel(from, to)}. Averages are per worked day.
          </p>
        </div>
        <DateRangeFilter from={from} to={to} min={firstDay} max={lastDay} onChange={setRange} />
      </div>

      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between mb-1 gap-2">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">Day on Day: Call Metrics</span>
          <ExportCsvButton
            filename={csvName('call-metrics', name, csvStamp())}
            disabled={days.length === 0}
            getRows={() =>
              isPreSales
                ? [['Date', 'Day', 'Inbound Calls', 'Avg Talk Time per Call (sec)', 'Talk Time'], ...days.map((d) => [d.date, d.day === 0.5 ? 'Half Day' : 'Full Day', d.calls ?? 0, Math.round(d.avgTalkSec ?? 0), hms(d.talkSeconds)])]
                : [['Date', 'Day', 'Total Outbound Calls', 'Total Unique Connected Calls', 'Talk Time'], ...days.map((d) => [d.date, d.day === 0.5 ? 'Half Day' : 'Full Day', d.outbound ?? '', d.connects, hms(d.talkSeconds)])]
            }
          />
        </div>
        {!isPreSales && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
            Daily target: {PRODUCTIVITY_RULES.minUniqueConnectsPerDay} unique connects and {hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)} talk time (half for a half day). Red means below target. Outbound calls fill in from the next sync.
          </p>
        )}
        {days.length > 0 && tiles}
        {days.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">No call data in this date range</div>
        ) : (
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                <tr>
                  <SortTh sort={sort} k="date" className="py-2 pr-3 font-semibold">Date</SortTh>
                  <SortTh sort={sort} k="day" className="py-2 pr-3 font-semibold">Day</SortTh>
                  {isPreSales ? (
                    <>
                      <SortTh sort={sort} k="calls" right className="py-2 pr-3 font-semibold text-right">Inbound Calls</SortTh>
                      <SortTh sort={sort} k="avgTalk" right className="py-2 pr-3 font-semibold text-right">Avg Talk / Call</SortTh>
                    </>
                  ) : (
                    <>
                      <SortTh sort={sort} k="outbound" right className="py-2 pr-3 font-semibold text-right">Total Outbound Calls</SortTh>
                      <SortTh sort={sort} k="connects" right className="py-2 pr-3 font-semibold text-right">Total Unique Connected Calls</SortTh>
                    </>
                  )}
                  <SortTh sort={sort} k="talk" right className="py-2 font-semibold text-right">Talk Time</SortTh>
                </tr>
              </thead>
              <tbody>
                {sort.sorted.map((d) => {
                  const factor = d.day === 0.5 ? 0.5 : 1;
                  return (
                    <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-3 font-mono">{d.date}</td>
                      <td className="py-1.5 pr-3">{d.day === 0.5 ? 'Half Day' : 'Full Day'}</td>
                      {isPreSales ? (
                        <>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{d.calls ?? 0}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{dash(d.avgTalkSec, (v) => `${Math.round(v)}s`)}</td>
                          <td className="py-1.5 text-right tabular-nums">{hms(d.talkSeconds)}</td>
                        </>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{dash(d.outbound, (v) => formatNumberINR(v, 0))}</td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums ${lowConnects(d.connects, factor) ? RED : ''}`}>{d.connects}</td>
                          <td className={`py-1.5 text-right tabular-nums ${lowTalk(d.talkSeconds, factor) ? RED : ''}`}>{hms(d.talkSeconds)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
