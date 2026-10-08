import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { AgentRecord, Cycle, PreSalesPlan, PreSalesTier, Suggestion } from '../shared/types';
import {
  calculatePreSales,
  formatCurrencyINR,
  formatNumberINR,
  preSalesMetricsFromTotals,
} from '../shared/incentive';
import { calculateRemainingWorkingDays } from '../shared/planning';
import { buildPreSalesSuggestions } from '../shared/suggestions';
import { aiTextIsCurrent } from '../shared/aiText';
import { AnimatedCounter } from './AnimatedCounter';
import { fireMilestoneBurst } from '../utils/confetti';
import { soundFx } from '../utils/audio';
import {
  AlertTriangle,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Info,
  Lock,
  PhoneIncoming,
  ShieldCheck,
  Sparkles,
  Target,
  Unlock,
  Zap,
} from 'lucide-react';

interface PreSalesActualTabProps {
  agentRecord: AgentRecord | null;
  plan: PreSalesPlan;
  cycle: Cycle;
  onNavigateToSimulator?: () => void;
}

type ShownSuggestion = Suggestion & { isAiText: boolean };

interface LadderRow {
  key: string;
  label: string;
  payout: number;
  tier: number; // 0 = below the first tier
}

/** "0-100 = none, 101-115 = Rs 500, ..., 131+ = Rs 2,000" from the plan's tiers. */
function buildLadder(tiers: PreSalesTier[], unit: string): LadderRow[] {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  if (sorted.length === 0) return [];
  const rows: LadderRow[] = [
    { key: 'base', label: `0 - ${sorted[0].min - 1} ${unit}`, payout: 0, tier: 0 },
  ];
  sorted.forEach((t, i) => {
    const next = sorted[i + 1];
    rows.push({
      key: `t${i + 1}`,
      label: next ? `${t.min} - ${next.min - 1} ${unit}` : `${t.min}+ ${unit}`,
      payout: t.payout,
      tier: i + 1,
    });
  });
  return rows;
}

interface TierCardProps {
  title: string;
  icon: React.ReactNode;
  valueText: string;
  unitText: string;
  subText: string;
  ladder: LadderRow[];
  currentTier: number;
  eligible: boolean;
  nextText: string | null;
}

function TierCard({
  title,
  icon,
  valueText,
  unitText,
  subText,
  ladder,
  currentTier,
  eligible,
  nextText,
}: TierCardProps) {
  return (
    <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
            {icon}
            {title}
          </span>
          <span
            className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full border ${
              currentTier > 0
                ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
            }`}
          >
            {currentTier > 0 ? `Tier ${currentTier}` : 'Below Tier 1'}
          </span>
        </div>

        <div className="text-3xl font-black text-slate-950 dark:text-white font-mono tabular-nums">
          {valueText}
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> {unitText}</span>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{subText}</p>

        <div className="mt-4 space-y-1.5">
          {ladder.map((row) => {
            const isCurrent = row.tier === currentTier;
            const reached = row.tier <= currentTier;
            return (
              <div
                key={row.key}
                className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-mono ${
                  isCurrent
                    ? 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-400 dark:border-amber-400 text-slate-900 dark:text-white font-bold'
                    : reached
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/60 text-slate-800 dark:text-slate-200'
                    : 'bg-slate-50/80 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                <span>{row.label}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{row.payout > 0 ? formatCurrencyINR(row.payout) : '-'}</span>
                  {isCurrent && (
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
                      {eligible || row.payout === 0 ? 'YOU' : 'LOCKED'}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        {nextText ?? 'Top tier reached'}
      </div>
    </div>
  );
}

export function PreSalesActualTab({ agentRecord, plan, cycle, onNavigateToSimulator }: PreSalesActualTabProps) {
  // Hooks stay above every early return
  const [completedItems, setCompletedItems] = useState<Record<string, boolean>>({});

  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays === 0) {
    return (
      <div className="bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto my-8 shadow-xs">
        <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center text-amber-500 mx-auto mb-4">
          <Calendar className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">No data yet</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
          No data yet. The first update comes after 1:30 PM on the day after the cycle starts.
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          You can use the <strong>Simulator</strong> tab right now to explore your incentives.
        </p>
      </div>
    );
  }

  const { totals, quality, daily, lastDataDate } = agentRecord;
  const metrics = preSalesMetricsFromTotals(totals, quality, plan);
  const calc = calculatePreSales(metrics, plan);
  const ps = calc.preSales;
  if (!ps) return null;

  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );

  const callsTiers = [...plan.calls].sort((a, b) => a.min - b.min);
  const talkTiers = [...plan.talkSeconds].sort((a, b) => a.min - b.min);
  const nextCalls = callsTiers.find((t) => t.min > metrics.avgCalls);
  const nextTalk = talkTiers.find((t) => t.min > metrics.avgTalkSeconds);

  const toggleItem = (id: string) => {
    soundFx.playPop();
    setCompletedItems((prev) => {
      const next = !prev[id];
      if (next) fireMilestoneBurst(0.5, 0.7);
      return { ...prev, [id]: next };
    });
  };

  // Suggestions (rule text, or the verified AI text when it matches the latest data)
  const rawSuggestions = buildPreSalesSuggestions(agentRecord, plan, cycle);
  const aiMatches = aiTextIsCurrent(agentRecord);
  const suggestions: ShownSuggestion[] = rawSuggestions.map((s) => {
    if (s.type === 'headline' && aiMatches && agentRecord.aiSuggestions?.headline) {
      return { ...s, defaultText: agentRecord.aiSuggestions.headline, isAiText: true };
    }
    if (aiMatches && agentRecord.aiSuggestions?.items) {
      const match = agentRecord.aiSuggestions.items.find((item) => item.id === s.id);
      if (match) return { ...s, defaultText: match.text, isAiText: true };
    }
    return { ...s, isAiText: false };
  });
  const headline = suggestions.find((s) => s.type === 'headline');
  const actionSuggestions = suggestions.filter((s) => s.type !== 'headline');

  const chartData = (daily || [])
    .filter((d) => d.day > 0)
    .map((d) => ({
      date: d.date.split('-').slice(1).join('/'),
      calls: Math.round(d.calls ?? 0),
    }));

  const score = ps.qualityScore;
  const gate = ps.qualityGate;
  const gatePoints = score === null ? gate : Math.max(0, gate - score);

  return (
    <div className="space-y-6">
      {/* Headline */}
      {headline && (
        <div className="bg-slate-950 border border-slate-800 text-white p-4.5 rounded-xl shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-amber-300 shrink-0">
              {headline.isAiText ? (
                <Sparkles className="w-4 h-4 text-amber-300 animate-subtle-sparkle" />
              ) : (
                <Zap className="w-4 h-4 fill-amber-300" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block font-mono">
                  {headline.isAiText ? 'AI Coaching Advice' : 'Performance Pulse'}
                </span>
                {headline.isAiText && (
                  <span className="text-[10px] text-amber-300 font-bold font-mono">· Verified Gemini</span>
                )}
              </div>
              <p className="text-sm font-semibold text-white tracking-tight">{headline.defaultText}</p>
            </div>
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <span className="text-xs font-mono font-semibold text-slate-300">
              {formatNumberINR(remainingWorkingDays, 1)} days left
            </span>
          </div>
        </div>
      )}

      {/* Total incentive + quality gate */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <div className="md:col-span-5 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-3xl p-6 sm:p-7 border border-amber-500/30 shadow-[0_12px_40px_-10px_rgba(245,158,11,0.25)] flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-bl from-amber-400/20 via-amber-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider font-extrabold text-amber-400 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-subtle-sparkle" />
                Incentive Earned
              </span>
              <span
                className={`text-xs font-bold font-mono px-2.5 py-0.5 rounded-full border ${
                  ps.eligible
                    ? 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30'
                    : 'bg-amber-400/15 text-amber-300 border-amber-400/30'
                }`}
              >
                Pre Sales · {ps.eligible ? 'Unlocked' : 'Locked'}
              </span>
            </div>

            <div className="text-4xl lg:text-[42px] font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 tracking-tight font-mono mt-3">
              <AnimatedCounter value={calc.total} />
            </div>
            <p className="text-[11px] text-slate-300 mt-2 font-medium">
              {ps.eligible
                ? 'Earned so far, based on your current averages'
                : ps.potentialTotal > 0
                ? `${formatCurrencyINR(ps.potentialTotal)} is waiting for you. Reach ${gate}% Quality to unlock it.`
                : `Reach ${gate}% Quality and your first tier to start earning`}
            </p>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4 space-y-2 text-xs">
            {[
              { label: `Calls per day (${ps.calls.tier > 0 ? `Tier ${ps.calls.tier}` : 'no tier'})`, line: ps.calls },
              { label: `Talk time (${ps.talk.tier > 0 ? `Tier ${ps.talk.tier}` : 'no tier'})`, line: ps.talk },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-slate-300">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      row.line.amount > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'
                    }`}
                  />
                  {row.label}:
                </span>
                <span className="font-mono font-bold text-white tabular-nums">
                  {ps.eligible || row.line.payout === 0 ? (
                    formatCurrencyINR(row.line.amount)
                  ) : (
                    <span className="text-amber-300">
                      {formatCurrencyINR(row.line.payout)} <span className="text-[10px] font-normal">locked</span>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-7 bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <span className="text-xs uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Quality Score Gate
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold font-mono px-2.5 py-0.5 rounded-full border ${
                  ps.eligible
                    ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    : 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                }`}
              >
                {ps.eligible ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {ps.eligible ? 'Both incentives unlocked' : `Need ${gate}% or more`}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-slate-950 dark:text-white font-mono">
                {score !== null ? `${score}%` : 'N/A'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {quality.audits} audit{quality.audits === 1 ? '' : 's'} completed · minimum {gate}% for both incentives
              </span>
            </div>

            <div className="mt-8 mb-6">
              <div className="relative w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    ps.eligible ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, score ?? 0)}%` }}
                />
                <div className="absolute top-0 -ml-[1px] z-10" style={{ left: `${gate}%` }}>
                  <div className="w-0.5 h-4.5 -mt-0.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                  <span className="absolute -top-5 -translate-x-1/2 text-[9px] font-mono font-bold whitespace-nowrap px-1.5 rounded bg-slate-900 text-emerald-300 dark:bg-black border border-emerald-500/60">
                    Gate {gate}%
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs font-mono text-slate-600 dark:text-slate-300">
              {ps.eligible ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Gate met. Your Calls and Talk Time incentives are paid.
                </span>
              ) : score === null ? (
                <span className="text-amber-700 dark:text-amber-400 font-bold">
                  Waiting for your first Quality audit. Both incentives are locked until then.
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400 font-bold">
                  Need +{gatePoints} point{gatePoints === 1 ? '' : 's'} to unlock{' '}
                  {ps.potentialTotal > 0 ? formatCurrencyINR(ps.potentialTotal) : 'your incentives'}.
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 mt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">Active Days</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">{totals.activeDays}</strong>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">Total Calls</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">
                {formatNumberINR(totals.calls ?? 0)}
              </strong>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">Days Left</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">
                {formatNumberINR(remainingWorkingDays, 1)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Calls per day + Talk time */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <TierCard
          title="Calls per day"
          icon={<PhoneIncoming className="w-3.5 h-3.5 text-indigo-500" />}
          valueText={formatNumberINR(metrics.avgCalls)}
          unitText="calls / day"
          subText={`${formatNumberINR(totals.calls ?? 0)} inbound calls over ${totals.activeDays} active days`}
          ladder={buildLadder(plan.calls, 'calls')}
          currentTier={ps.calls.tier}
          eligible={ps.eligible}
          nextText={
            nextCalls
              ? `Need +${nextCalls.min - metrics.avgCalls} calls/day for ${formatCurrencyINR(nextCalls.payout)}`
              : null
          }
        />
        <TierCard
          title="Talk time"
          icon={<Clock className="w-3.5 h-3.5 text-amber-500" />}
          valueText={formatNumberINR(metrics.avgTalkSeconds)}
          unitText="seconds / call"
          subText={
            plan.talkMethod === 'weighted'
              ? 'Average talk time, weighted by your daily calls'
              : 'Average of your daily talk time'
          }
          ladder={buildLadder(plan.talkSeconds, 'sec')}
          currentTier={ps.talk.tier}
          eligible={ps.eligible}
          nextText={
            nextTalk
              ? `Need +${nextTalk.min - metrics.avgTalkSeconds} seconds for ${formatCurrencyINR(nextTalk.payout)}`
              : null
          }
        />
      </div>

      {/* Suggestions */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              Daily Coaching Checklist & Action Plan
            </h4>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Click any recommendation to mark it as actioned today
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
            {Object.values(completedItems).filter(Boolean).length} / {actionSuggestions.length} Completed
          </span>
        </div>

        <div className="space-y-3">
          {actionSuggestions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">No recommendations at this time.</p>
          ) : (
            actionSuggestions.map((item) => {
              const isDone = Boolean(completedItems[item.id]);
              return (
                <div
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition cursor-pointer select-none ${
                    isDone
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200 shadow-xs'
                      : item.type === 'warning'
                      ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200'
                      : item.type === 'streak'
                      ? 'bg-orange-50/70 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/60 text-orange-950 dark:text-orange-200'
                      : item.difficult
                      ? 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 hover:border-amber-400 dark:hover:border-amber-500/50'
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    ) : item.type === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    ) : item.type === 'streak' ? (
                      <Flame className="w-5 h-5 text-orange-500 dark:text-orange-400" />
                    ) : item.difficult ? (
                      <Info className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                    ) : (
                      <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </span>
                  <div className="flex-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-semibold leading-relaxed flex items-center gap-1.5 flex-wrap ${
                          isDone ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {item.defaultText}
                        {item.isAiText && (
                          <span title="AI Powered Coaching" className="inline-flex items-center text-amber-500 dark:text-amber-400 shrink-0">
                            <Sparkles className="w-3.5 h-3.5 animate-subtle-sparkle" />
                          </span>
                        )}
                      </span>
                      {isDone ? (
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-bold font-mono shrink-0">
                          ✓ Done Today
                        </span>
                      ) : item.difficult ? (
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold shrink-0">
                          Difficult to reach
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {onNavigateToSimulator && (
          <button
            onClick={() => {
              soundFx.playPop();
              onNavigateToSimulator();
            }}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-500/30 text-xs font-bold font-mono transition"
          >
            <Calculator className="w-3.5 h-3.5" />
            Try it in the Simulator
          </button>
        )}
      </div>

      {/* Daily calls */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
            Daily Inbound Calls
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Total active days: <strong className="text-slate-800 dark:text-slate-200">{totals.activeDays}</strong>
          </span>
        </div>

        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">
            No daily data recorded yet
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.25} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }}
                  formatter={(val: any) => [formatNumberINR(Number(val)), 'Calls']}
                  labelFormatter={(lbl) => `Date: ${lbl}`}
                />
                <Bar dataKey="calls" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
