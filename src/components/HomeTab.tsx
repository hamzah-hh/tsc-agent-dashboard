import React, { useMemo } from 'react';
import { AgentRecord, Plan } from '../shared/types';
import { PRODUCTIVITY_RULES, breakAverages, hms, lowConnects, lowTalk, overLimit, prodStats } from '../shared/teamOps';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import { useAgentBreaks } from '../utils/useAgentBreaks';
import { CARD, Tile, TileGroup, rangeLabel } from './MetricTile';
import { DateRangeFilter, inDateRange, useDateRange } from './DateRangeFilter';
import { adherencePct } from './BreaksAdherenceTab';
import { AnimatedCounter } from './AnimatedCounter';
import { Sparkles } from 'lucide-react';

interface HomeTabProps {
  agentRecord: AgentRecord | null;
  /** The revenue plan (HO / Store agents); Pre Sales have none. */
  plan: Plan | null;
  isPreSales: boolean;
  getIdToken: () => Promise<string>;
}

/**
 * Home: one page with every metric for the agent, not only the ones that feed the incentive. Day-by-day
 * figures follow the date range (month to date by default); quality, class and incentive are for the cycle.
 */
export function HomeTab({ agentRecord, plan, isPreSales, getIdToken }: HomeTabProps) {
  const { breaks: allBreaks, error: breaksError } = useAgentBreaks(getIdToken, agentRecord?.officialEmail || '');

  const allDaily = useMemo(() => [...(agentRecord?.daily || [])].sort((a, b) => b.date.localeCompare(a.date)), [agentRecord]);
  const dates = [...allDaily.filter((d) => d.day > 0 || d.sales > 0 || (d.calls ?? 0) > 0).map((d) => d.date), ...(allBreaks || []).map((b) => b.date)];
  const firstDay = dates.reduce((m, d) => (!m || d < m ? d : m), '');
  const lastDay = dates.reduce((m, d) => (d > m ? d : m), '');
  const { from, to, set: setRange } = useDateRange(firstDay, lastDay);

  const daily = useMemo(() => allDaily.filter((d) => inDateRange(d.date, from, to)), [allDaily, from, to]);
  const breakDays = useMemo(() => (allBreaks ? allBreaks.filter((b) => inDateRange(b.date, from, to)) : null), [allBreaks, from, to]);

  if (!agentRecord) {
    return <div className={`${CARD} text-center text-xs text-slate-500 dark:text-slate-400`}>No data yet for this agent.</div>;
  }

  const num1 = (n: number | null) => (n === null ? '-' : formatNumberINR(n, 1));
  const result = agentRecord.result;

  // Revenue and visits, over the range
  const sales = daily.reduce((s, d) => s + d.sales, 0);
  const orders = daily.reduce((s, d) => s + d.orders, 0);
  const salesDays = daily.filter((d) => d.sales > 0 || d.orders > 0).length;
  const visits = daily.reduce((s, d) => s + d.visitsAttributed, 0);
  const worked = daily.reduce((s, d) => s + (d.day > 0 ? d.day : isPreSales && (d.calls ?? 0) > 0 ? 1 : 0), 0);

  // Calls, over the range
  const dialerDays = daily.filter((d) => d.day === 1 || d.day === 0.5);
  const prod = prodStats(dialerDays.map((d) => ({ agentEmail: '', date: d.date, day: d.day, connects: d.connects, talkSeconds: d.talkSeconds })));
  const totalConnects = dialerDays.reduce((s, d) => s + d.connects, 0);
  const totalTalk = daily.reduce((s, d) => s + d.talkSeconds, 0);
  const withOutbound = dialerDays.filter((d) => d.outbound !== undefined);
  const totalOutbound = withOutbound.reduce((s, d) => s + (d.outbound ?? 0), 0);
  const outboundDays = withOutbound.reduce((s, d) => s + d.day, 0);
  const inbound = daily.reduce((s, d) => s + (d.calls ?? 0), 0);
  const weighted = daily.reduce((s, d) => s + (d.avgTalkSec ?? 0) * (d.calls ?? 0), 0);

  // Breaks, over the range
  const brk = breakAverages(breakDays || []);
  const adherence = adherencePct(brk.days, brk.daysOver);
  const haveBreaks = Boolean(breakDays && breakDays.length > 0);
  const breakVal = (key: 'staffed' | 'total' | 'idle' | 'acw') => (haveBreaks ? hms(brk[key]) : '-');

  const quality = agentRecord.quality;
  const gate = 85;

  return (
    <div className="space-y-6">
      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg">Home</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Every metric for {agentRecord.name || 'this agent'}. Daily figures cover {rangeLabel(from, to)}; targets, class, quality and incentive are for the whole cycle.
          </p>
        </div>
        <DateRangeFilter from={from} to={to} min={firstDay} max={lastDay} onChange={setRange} />
      </div>

      {/* Incentive Earned: the cycle's payout so far, with what it is made of */}
      <div className="bg-brand-900 dark:bg-raised text-white rounded-3xl p-6 sm:p-7 border border-amber-500/30 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-44 h-44 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 md:items-center">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider font-bold text-amber-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Incentive Earned
              </span>
              {!isPreSales && result && (
                <span className="text-xs font-bold font-mono px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  Class {result.className} · {formatNumberINR(result.achievementPct, 1)}%
                </span>
              )}
            </div>
            <div className="text-4xl lg:text-[42px] font-black text-amber-300 tracking-tight font-mono mt-3">
              <AnimatedCounter value={result?.total ?? 0} />
            </div>
            <p className="text-[11px] text-slate-300 mt-2 font-medium">Whole cycle so far, at your current run-rate</p>
          </div>
          {!isPreSales && result && (
            <div className="space-y-2 text-xs md:border-l md:border-white/10 md:pl-6">
              {[
                ['Base revenue incentive', result.revenueIncentiveNet],
                [`Quality bonus (${result.quality.band})`, result.quality.amount],
                [`Connects bonus (${result.connects.band})`, result.connects.amount],
                [`Talk time bonus (${result.talk.band})`, result.talk.amount],
                [`Store visits rider (Tier ${result.rider.tier})`, result.rider.amount],
              ].map(([label, amount]) => (
                <div key={label as string} className="flex items-center justify-between text-slate-300">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className={`w-2 h-2 rounded-full ${(amount as number) > 0 ? 'bg-amber-400' : 'bg-slate-600'}`} />
                    {label}
                  </span>
                  <span className="font-mono font-bold text-white tabular-nums">{formatCurrencyINR(amount as number)}</span>
                </div>
              ))}
              {result.deductions && result.deductions.length > 0 && (
                <div className="flex justify-between text-rose-400 pt-1.5 border-t border-white/10 font-mono">
                  <span>Deductions</span>
                  <span className="font-bold">-{formatCurrencyINR(result.deductions.reduce((acc, d) => acc + d.amount, 0))}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isPreSales && (
        <TileGroup title="Revenue & orders">
          <Tile label="Revenue" value={formatCurrencyINR(sales)} sub={`${rangeLabel(from, to)}`} />
          <Tile label="Orders" value={formatNumberINR(orders, 0)} />
          <Tile label="Average order value" value={orders > 0 ? formatCurrencyINR(Math.round(sales / orders)) : '-'} />
          <Tile label="Avg revenue / selling day" value={salesDays > 0 ? formatCurrencyINR(Math.round(sales / salesDays)) : '-'} sub={`${salesDays} selling day${salesDays === 1 ? '' : 's'}`} />
          <Tile label="Days worked" value={num1(worked)} />
        </TileGroup>
      )}

      <TileGroup title={isPreSales ? 'Incentive (whole cycle)' : 'Target & incentive (whole cycle)'}>
        {!isPreSales && plan && (
          <>
            <Tile label="Assigned target" value={formatCurrencyINR(plan.target)} />
            <Tile label="Achieved" value={`${formatNumberINR(result?.achievementPct ?? 0, 1)}%`} sub={formatCurrencyINR(agentRecord.totals?.sales ?? 0)} />
            <Tile label="Gap to target" value={formatCurrencyINR(Math.max(0, plan.target - (agentRecord.totals?.sales ?? 0)))} />
            <Tile label="Class" value={result?.className ?? '-'} />
          </>
        )}
        <Tile label="Projected incentive" value={formatCurrencyINR(result?.total ?? 0)} sub="From the cycle's run-rate" />
      </TileGroup>

      <TileGroup title={isPreSales ? 'Calls & talk time' : 'Calls & talk time'}>
        {isPreSales ? (
          <>
            <Tile label="Inbound calls" value={formatNumberINR(inbound, 0)} />
            <Tile label="Avg inbound calls / day" value={worked > 0 ? num1(inbound / worked) : '-'} />
            <Tile label="Avg talk time / call" value={inbound > 0 ? `${Math.round(weighted / inbound)}s` : '-'} />
            <Tile label="Total talk time" value={hms(totalTalk)} />
          </>
        ) : (
          <>
            <Tile label="Outbound calls" value={withOutbound.length ? formatNumberINR(totalOutbound, 0) : '-'} sub={outboundDays > 0 ? `${num1(totalOutbound / outboundDays)} / day` : 'Fills in from the next sync'} />
            <Tile label="Unique connects" value={formatNumberINR(totalConnects, 0)} sub={`${num1(prod.avgConnects)} / day (target ${PRODUCTIVITY_RULES.minUniqueConnectsPerDay})`} red={lowConnects(prod.avgConnects)} />
            <Tile label="Talk time" value={hms(totalTalk)} sub={`${hms(prod.avgTalk)} / day (target ${hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)})`} red={lowTalk(prod.avgTalk)} />
            <Tile label="Days below targets" value={`${prod.daysLowConnects} / ${prod.daysLowTalk}`} sub="Connects / talk time" red={prod.daysLowConnects + prod.daysLowTalk > 0} />
          </>
        )}
      </TileGroup>

      {!isPreSales && (
        <TileGroup title="Store visits">
          <Tile label="Visits attributed" value={formatNumberINR(visits, 0)} sub={`${rangeLabel(from, to)}`} />
          <Tile label="Visits / day" value={worked > 0 ? num1(visits / worked) : '-'} />
        </TileGroup>
      )}

      <TileGroup title="Quality (whole cycle)">
        <Tile
          label="Quality score"
          value={quality && quality.audits > 0 ? `${(Math.round(quality.score * 100) / 100).toFixed(2)}%` : '-'}
          sub={quality && quality.audits > 0 ? `${quality.audits} audit${quality.audits === 1 ? '' : 's'}` : 'No audits yet'}
          red={Boolean(quality && quality.audits > 0 && quality.score < gate)}
        />
      </TileGroup>

      <TileGroup title="Breaks & adherence">
        {breaksError ? (
          <div className="col-span-full text-xs text-slate-400 dark:text-slate-500">{breaksError}</div>
        ) : (
          <>
            <Tile label="Adherence" value={adherence === null ? '-' : `${adherence.toFixed(1)}%`} sub={haveBreaks ? `${brk.days - brk.daysOver} of ${brk.days} days within every limit` : 'No break data in range'} />
            <Tile label="Avg staffed duration" value={breakVal('staffed')} />
            <Tile label="Avg total break" value={breakVal('total')} sub="Limit 01:20:00" red={haveBreaks && overLimit('total', brk.total)} />
            <Tile label="Avg idle time" value={breakVal('idle')} />
            <Tile label="Avg after call work" value={breakVal('acw')} />
            <Tile label="Idle + ACW %" value={haveBreaks && brk.idleAcwPct !== null ? `${brk.idleAcwPct.toFixed(1)}%` : '-'} sub="Limit 30.6%" red={haveBreaks && overLimit('idleAcwPct', brk.idleAcwPct)} />
            <Tile label="Days over a limit" value={haveBreaks ? String(brk.daysOver) : '-'} red={haveBreaks && brk.daysOver > 0} />
          </>
        )}
      </TileGroup>
    </div>
  );
}
