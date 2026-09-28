import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { AgentRecord, Cycle, Plan } from '../shared/types';
import { formatCurrencyINR, formatNumberINR, metricsFromTotals } from '../shared/incentive';
import {
  calculateRemainingWorkingDays,
  minSalesForClass,
  requiredPerDay,
} from '../shared/planning';
import { buildSuggestions } from '../shared/suggestions';
import { classSteps, scaleMaxPct } from '../shared/classes';
import { aiTextIsCurrent } from '../shared/aiText';
import {
  TrendingUp,
  Award,
  Zap,
  Target,
  Clock,
  PhoneCall,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  Flame,
  Info,
  Sparkles,
  Store,
} from 'lucide-react';
import { MilestoneLadder } from './MilestoneLadder';
import { AnimatedCounter } from './AnimatedCounter';
import { TierSlabSection } from './TierSlabSection';
import { fireGoldenCelebration, fireMilestoneBurst } from '../utils/confetti';
import { soundFx } from '../utils/audio';

interface ActualTabProps {
  agentRecord: AgentRecord | null;
  plan: Plan;
  cycle: Cycle;
  onNavigateToSimulator?: (presetSales?: number) => void;
  onNavigateToTarget?: () => void;
}

export function ActualTab({ agentRecord, plan, cycle, onNavigateToSimulator, onNavigateToTarget }: ActualTabProps) {
  // Hooks stay above every early return: when the first sync arrives and the agent taps Refresh, this
  // component goes from "No data yet" to the full screen, and a hook after the return would crash it.
  const [completedItems, setCompletedItems] = React.useState<Record<string, boolean>>({});

  if (!agentRecord || !agentRecord.totals || agentRecord.totals.activeDays === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center max-w-xl mx-auto my-8 shadow-sm">
        <div className="w-12 h-12 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center text-amber-600 mx-auto mb-4">
          <Calendar className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 mb-2">No data yet</h3>
        <p className="text-xs text-slate-600 leading-relaxed mb-6">
          No data yet. The first update comes after 1:30 PM on the day after the cycle starts.
        </p>
        <p className="text-[11px] text-slate-400">
          You can use the <strong>Simulator</strong> tab right now to explore potential earnings with different targets.
        </p>
      </div>
    );
  }

  const { totals, quality, absentDays, daily, lastDataDate, result } = agentRecord;
  const metrics = metricsFromTotals(totals, quality, absentDays);
  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );

  const currentDailyAvgSales =
    totals.activeDays > 0 ? totals.sales / totals.activeDays : 0;

  // Class limits, rates and scale come from the cycle's plan, never from fixed numbers
  const steps = classSteps(plan);
  const firstStep = steps[0];
  const topStep = steps[steps.length - 1];
  const scaleMax = scaleMaxPct(plan);

  const toggleItem = (id: string) => {
    soundFx.playPop();
    setCompletedItems((prev) => {
      const next = !prev[id];
      if (next) {
        fireMilestoneBurst(0.5, 0.7);
      }
      return { ...prev, [id]: next };
    });
  };

  // Next class calculation
  const currentClassIdx = plan.classes.findIndex((c) => c.name === result.className);
  const nextClass =
    currentClassIdx >= 0 && currentClassIdx < plan.classes.length - 1
      ? plan.classes[currentClassIdx + 1]
      : null;

  const targetMinSales = plan.target; // 100% target
  const reqPerDay100 = requiredPerDay(targetMinSales, totals.sales, remainingWorkingDays);

  const nextClassMinSales = nextClass ? minSalesForClass(plan, nextClass.name) : null;
  const reqPerDayNextClass = nextClassMinSales
    ? requiredPerDay(nextClassMinSales, totals.sales, remainingWorkingDays)
    : 0;

  // AOV
  const aov = totals.orders > 0 ? Math.round(totals.sales / totals.orders) : 0;

  // Suggestions
  const rawSuggestions = buildSuggestions(agentRecord, plan, cycle);
  // Use the AI text only when it was written for these exact numbers
  const aiMatches = aiTextIsCurrent(agentRecord);

  const suggestions = rawSuggestions.map((s) => {
    if (s.type === 'headline' && aiMatches && agentRecord.aiSuggestions?.headline) {
      return { ...s, defaultText: agentRecord.aiSuggestions.headline, isAiText: true };
    }
    if (aiMatches && agentRecord.aiSuggestions?.items) {
      const match = agentRecord.aiSuggestions.items.find((item) => item.id === s.id);
      if (match) {
        return { ...s, defaultText: match.text, isAiText: true };
      }
    }
    return { ...s, isAiText: false };
  });

  const headline = suggestions.find((s) => s.type === 'headline');
  const actionSuggestions = suggestions.filter((s) => s.type !== 'headline');

  // Chart data
  const chartData = (daily || [])
    .filter((d) => d.day > 0)
    .map((d) => ({
      date: d.date.split('-').slice(1).join('/'),
      sales: Math.round(d.sales),
    }));

  return (
    <div className="space-y-6">
      {/* 8. Suggestions Headline (top banner) */}
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
                  <span className="text-[10px] text-amber-300 font-bold font-mono">
                    · Verified Gemini
                  </span>
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

      {/* Interactive Class Milestone Roadmap */}
      <MilestoneLadder
        currentClass={result.className as any}
        achievementPct={result.achievementPct}
        sales={totals.sales}
        plan={plan}
        onSimulateTarget={(targetSales) => {
          if (onNavigateToSimulator) {
            onNavigateToSimulator(targetSales);
          }
        }}
      />

      {/* Prominent Target Quick Overview Bar */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-slate-900/10 dark:from-amber-500/15 dark:via-slate-900/40 dark:to-slate-900/20 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0 border border-amber-500/30 shadow-xs">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs uppercase font-extrabold font-mono text-amber-600 dark:text-amber-400 tracking-wider">
                Assigned Sales Target
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-800 dark:text-amber-200">
                {formatCurrencyINR(plan.target)}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-mono mt-0.5">
              Achieved: <strong className="text-slate-900 dark:text-white font-bold">{formatCurrencyINR(totals.sales)}</strong> ({formatNumberINR(result.achievementPct, 1)}%) · {totals.sales >= plan.target ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">100% Target Met!</span> : <span>Gap: <strong className="text-amber-600 dark:text-amber-400">{formatCurrencyINR(plan.target - totals.sales)}</strong></span>}
            </p>
          </div>
        </div>

        {onNavigateToTarget && (
          <button
            onClick={() => {
              soundFx.playPop();
              onNavigateToTarget();
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-amber-400 dark:hover:bg-amber-300 text-white dark:text-slate-950 text-xs font-bold font-mono transition shadow-xs shrink-0 active:scale-95"
          >
            <Target className="w-3.5 h-3.5" />
            <span>Open Target & Goals Console →</span>
          </button>
        )}
      </div>

      {/* Grid: Card 1 (Total Incentive) & Card 2 (Revenue Progress) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Card 1: Total Incentive - Executive Gold Luxury Card */}
        <div className="md:col-span-5 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-3xl p-6 sm:p-7 border border-amber-500/30 shadow-[0_12px_40px_-10px_rgba(245,158,11,0.25)] flex flex-col justify-between relative overflow-hidden group">
          {/* Ambient Corner Flare */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-bl from-amber-400/20 via-amber-500/5 to-transparent rounded-full blur-2xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-extrabold text-amber-400 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-subtle-sparkle" />
                1. Projected Incentive Payout
              </span>
              <span className="text-xs font-bold font-mono px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-xs">
                Class {result.className} · {formatNumberINR(result.achievementPct, 1)}% Pacing
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 mt-3">
              <div className="text-3xl sm:text-4xl lg:text-[42px] font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 tracking-tight font-mono filter drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)]">
                <AnimatedCounter value={result.total} />
              </div>
              <button
                onClick={() => {
                  soundFx.playLevelUp();
                  fireGoldenCelebration();
                }}
                className="group/btn relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 text-xs font-black shadow-[0_0_18px_rgba(245,158,11,0.4)] transition active:scale-95 shrink-0 overflow-hidden"
              >
                <div className="absolute inset-0 w-1/2 h-full bg-white/40 transform -skew-x-12 -translate-x-full group-hover/btn:translate-x-[300%] transition-transform duration-700" />
                <Sparkles className="w-3.5 h-3.5 text-slate-950 animate-subtle-sparkle" />
                Celebrate
              </button>
            </div>
            <p className="text-[11px] text-slate-300 mt-2 font-medium">
              {result.total > 0
                ? 'Accumulated earnings to date based on current run-rate'
                : firstStep
                ? `Reach ${firstStep.abovePct}% target (Class ${firstStep.name}) to unlock payout`
                : 'Keep going to unlock payout'}
            </p>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${result.revenueIncentiveNet > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'}`} />
                Base Revenue Incentive:
              </span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrencyINR(result.revenueIncentiveNet)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${result.quality.amount > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'}`} />
                Quality Bonus ({result.quality.band}):
              </span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrencyINR(result.quality.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${result.connects.amount > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'}`} />
                Connects Bonus ({result.connects.band}):
              </span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrencyINR(result.connects.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${result.talk.amount > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'}`} />
                Talk Time Bonus ({result.talk.band}):
              </span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrencyINR(result.talk.amount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${result.rider.amount > 0 ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]' : 'bg-slate-700'}`} />
                Store Visits Rider (Tier {result.rider.tier}):
              </span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatCurrencyINR(result.rider.amount)}
              </span>
            </div>
            {result.deductions && result.deductions.length > 0 && (
              <div className="flex justify-between text-rose-400 pt-1.5 border-t border-white/10 font-mono">
                <span>Deductions:</span>
                <span className="font-bold">
                  -{formatCurrencyINR(
                    result.deductions.reduce((acc, d) => acc + d.amount, 0)
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Target & Revenue Delivery */}
        <div className="md:col-span-7 bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 dark:bg-amber-400/5 rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-amber-500" />
                2. Target Achievement & Sales Delivery
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono">
                  Rate: {(result.rate * 100).toFixed(2)}%
                </span>
                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Target: {formatCurrencyINR(plan.target)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-baseline gap-2 mt-2">
              <span className="text-3xl font-extrabold text-slate-950 dark:text-white font-mono">
                {formatCurrencyINR(totals.sales)}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                achieved of <strong className="text-slate-800 dark:text-slate-200">{formatCurrencyINR(plan.target)}</strong> target (
                <strong className={`font-bold ${result.achievementPct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {formatNumberINR(result.achievementPct, 1)}%
                </strong>)
              </span>
            </div>

            {/* Dynamic Target & Next Class Status Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs font-mono">
              {/* Target Threshold Status Card */}
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                    <Target className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Assigned Target</span>
                    <span className="font-bold text-slate-900 dark:text-white">{formatCurrencyINR(plan.target)} (100%)</span>
                  </div>
                </div>
                <div className="text-right">
                  {totals.sales >= plan.target ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-[11px] block">
                      ✓ Target Met!
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px] block">
                      Gap: {formatCurrencyINR(plan.target - totals.sales)}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 block">
                    {totals.sales >= plan.target
                      ? `+${formatCurrencyINR(totals.sales - plan.target)} excess`
                      : `${formatCurrencyINR(Math.round(reqPerDay100))}/day`}
                  </span>
                </div>
              </div>

              {/* Next Class Requirement Status Card */}
              <div className="p-2.5 rounded-xl bg-amber-500/10 dark:bg-amber-950/30 border border-amber-400/40 dark:border-amber-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xs shrink-0 shadow-xs">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-amber-700 dark:text-amber-300 uppercase font-bold block">
                      {nextClass ? `Next Milestone: Class ${nextClass.name}` : 'Highest Class'}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {nextClass
                        ? `${formatCurrencyINR(nextClassMinSales || 0)} (${nextClass.abovePct}%)`
                        : topStep
                        ? `Class ${topStep.name} (${topStep.abovePct}%+)`
                        : 'Highest class'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  {nextClass ? (
                    <>
                      <span className="text-amber-700 dark:text-amber-300 font-black text-[11px] block">
                        Need +{formatCurrencyINR(Math.max(0, (nextClassMinSales || 0) - totals.sales))}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                        {formatCurrencyINR(Math.round(reqPerDayNextClass))}/day
                      </span>
                    </>
                  ) : (
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold text-[11px] block">
                      Pinnacle Unlocked
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Custom Multi-marker Progress Bar with Dynamic Target & Next Class Indicators */}
            <div className="mt-8 mb-4">
              <div className="relative w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80 shadow-inner">
                {/* Progress fill */}
                <div
                  className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-700 shadow-[0_0_14px_rgba(251,191,36,0.5)]"
                  style={{
                    width: `${Math.min(100, (result.achievementPct / scaleMax) * 100)}%`,
                  }}
                />

                {/* 1. Dynamic 'Target' Threshold Marker (100% of the target) */}
                {(() => {
                  const targetPosPct = (100 / scaleMax) * 100;
                  const isMet = result.achievementPct >= 100;

                  return (
                    <div
                      className="absolute top-0 -ml-[1px] z-20 group"
                      style={{ left: `${targetPosPct}%` }}
                    >
                      {/* Vertical Benchmark Pin */}
                      <div
                        className={`w-1 h-6 -mt-1 rounded-full ${
                          isMet ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-emerald-600 dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                        }`}
                      />
                      {/* Target Flag Callout (Top) */}
                      <div className="absolute -top-7 -translate-x-1/2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black font-mono shadow-md bg-slate-900 text-emerald-300 dark:bg-black dark:text-emerald-300 border-2 border-emerald-500 dark:border-emerald-400">
                          <Target className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                          <span>Target: 100%</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* 2. Dynamic 'Next Class' Requirement Marker */}
                {(() => {
                  const nextPct = nextClass ? nextClass.abovePct : topStep?.abovePct ?? 100;
                  const nextPosPct = (nextPct / scaleMax) * 100;
                  const isMet = result.achievementPct >= nextPct;

                  return (
                    <div
                      className="absolute top-0 -ml-[1px] z-20 group"
                      style={{ left: `${nextPosPct}%` }}
                    >
                      {/* Vertical Pulsing Next Class Pin */}
                      <div className="w-1 h-6 -mt-1 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)] animate-pulse" />
                      {/* Next Class Flag Callout (Top) */}
                      <div className="absolute -top-7 -translate-x-1/2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black font-mono shadow-md bg-amber-500 text-slate-950 dark:bg-amber-400 dark:text-slate-950 border-2 border-amber-300">
                          <Sparkles className="w-2.5 h-2.5 shrink-0" />
                          <span>{nextClass ? `Next: Class ${nextClass.name}` : `Pinnacle: Class ${topStep?.name ?? ''}`}</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Milestone reference ticks: one for each class limit of the plan */}
                {steps
                  .map((s) => ({ pct: s.abovePct, label: `${s.abovePct}% (Class ${s.name})` }))
                  .map((m) => {
                  const posPct = (m.pct / scaleMax) * 100;
                  const isReached = result.achievementPct >= m.pct;

                  return (
                    <div
                      key={m.pct}
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${posPct}%` }}
                    >
                      <div
                        className={`w-0.5 h-5 -mt-0.5 rounded-full ${
                          isReached ? 'bg-amber-500 dark:bg-amber-400' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      />
                      <span
                        className={`absolute top-5 -translate-x-1/2 text-[9px] font-mono font-bold whitespace-nowrap px-1.5 py-0.5 rounded ${
                          isReached
                            ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-slate-900 border border-amber-200 dark:border-amber-500/40'
                            : 'text-slate-500 dark:text-slate-400 bg-slate-100/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        {m.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Clean 4-card Milestone Breakdown Grid underneath */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-8 pt-1">
                {steps
                  .map((s) => ({
                    code: s.name,
                    name: `Class ${s.name}`,
                    pct: s.abovePct,
                    rate: `${s.ratePct}%`,
                    minSales: s.minSales, // the class needs MORE than the limit, so this is 1 rupee above it
                  }))
                  .map((m) => {
                  const isReached = result.achievementPct >= m.pct;
                  const isCurrent = result.className === m.code;

                  return (
                    <div
                      key={m.code}
                      className={`p-2.5 rounded-xl border text-xs font-mono transition-all duration-200 ${
                        isCurrent
                          ? 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-400 dark:border-amber-400 text-slate-900 dark:text-white ring-1 ring-amber-400/30 shadow-xs'
                          : isReached
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/60 text-slate-800 dark:text-slate-200'
                          : 'bg-slate-50/80 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-extrabold">{m.name}</span>
                        {isCurrent ? (
                          <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-400 text-slate-950">ACTIVE</span>
                        ) : isReached ? (
                          <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">✓ MET</span>
                        ) : (
                          <span className="text-[9px] text-slate-400">{m.pct}%</span>
                        )}
                      </div>
                      <div className="font-bold text-[11px] text-slate-900 dark:text-white tabular-nums">
                        {formatCurrencyINR(m.minSales)}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {m.rate} Rate
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">Orders</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">
                {formatNumberINR(totals.orders)}
              </strong>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">AOV</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">
                {formatCurrencyINR(aov)}
              </strong>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block font-medium font-mono">Active Days</span>
              <strong className="text-slate-800 dark:text-slate-200 text-sm font-bold font-mono">
                {totals.activeDays}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Card 3: Run Rate */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
            3. Run Rate & Trajectory
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium font-mono">
            Remaining Working Days: <strong className="text-slate-800 dark:text-slate-200">{formatNumberINR(remainingWorkingDays, 1)}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-slate-50 dark:bg-slate-950/60 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Current Daily Average</span>
            <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
              {formatCurrencyINR(Math.round(currentDailyAvgSales))}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> / active day</span>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950/60 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Needed for 100% Target</span>
            <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
              {totals.sales >= plan.target ? (
                <span className="text-emerald-600 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Target reached
                </span>
              ) : (
                <>
                  {formatCurrencyINR(Math.round(reqPerDay100))}
                  <span className="text-xs font-normal text-slate-500"> / remaining day</span>
                </>
              )}
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950/60 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">
              Needed for {nextClass ? `Class ${nextClass.name}` : 'Highest Class'}
            </span>
            <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
              {nextClass ? (
                <>
                  {formatCurrencyINR(Math.round(reqPerDayNextClass))}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400"> / remaining day</span>
                </>
              ) : (
                <span className="text-indigo-600 dark:text-indigo-400 font-bold inline-flex items-center gap-1">
                  <Award className="w-4 h-4" /> Top Class Achieved!
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cards 4, 5, 6, 7: Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 4. Quality Score */}
        {(() => {
          const score = metrics.qualityScore !== null ? metrics.qualityScore : 0;
          const targetQuality = plan.bonuses.quality.high;
          const midQuality = plan.bonuses.quality.mid;
          const isTargetMet = score >= targetQuality;
          const isMidMet = score >= midQuality;
          const gap = isTargetMet ? 0 : isMidMet ? (targetQuality - score).toFixed(1) : (midQuality - score).toFixed(1);
          const nextLabel = isTargetMet ? 'Target Met!' : isMidMet ? `High Target (≥${targetQuality}%)` : `Mid Band (≥${midQuality}%)`;

          return (
            <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-emerald-500" />
                    4. Quality Score
                  </span>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                    result.quality.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' :
                    result.quality.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {result.quality.band === 'None' ? 'Below Min' : `${result.quality.band} Band`}
                  </span>
                </div>

                <div className="text-2xl font-black text-slate-950 dark:text-white font-mono tabular-nums">
                  {metrics.qualityScore !== null ? `${metrics.qualityScore}%` : 'N/A'}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{quality.audits} audits completed</p>

                {/* Progress Bar with Dynamic Target & Next Requirement Markers */}
                <div className="mt-3.5 mb-1.5">
                  <div className="relative w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80">
                    {/* Fill */}
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTargetMet ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : isMidMet ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      style={{ width: `${Math.min(100, score)}%` }}
                    />

                    {/* Target Pin at targetQuality (e.g. 90%) */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${targetQuality}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isTargetMet ? 'bg-emerald-500' : 'bg-emerald-600 dark:bg-emerald-400'}`} />
                      <span className="absolute -top-4.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-900 text-emerald-300 dark:bg-black dark:text-emerald-300 border border-emerald-500/60 shadow-xs">
                        🎯 {targetQuality}%
                      </span>
                    </div>

                    {/* Mid Hurdle Pin at midQuality (e.g. 85%) */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${midQuality}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isMidMet ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="absolute top-3.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Mid {midQuality}%
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Summary Strip */}
                  <div className="mt-5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">
                      🎯 Target: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">≥{targetQuality}%</strong>
                    </span>
                    <span className={isTargetMet ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
                      {isTargetMet ? '✓ Target Met' : `⭐ Need +${gap}% for ${isMidMet ? 'High' : 'Mid'}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 dark:text-slate-400">Bonus Payout:</span>
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">{formatCurrencyINR(result.quality.amount)}</span>
              </div>
            </div>
          );
        })()}

        {/* 5. Unique Connects */}
        {(() => {
          const connects = metrics.avgConnects;
          const targetConnects = plan.bonuses.connects.high;
          const midConnects = plan.bonuses.connects.mid;
          const maxConnects = Math.max(160, Math.round(targetConnects * 1.15));
          const isTargetMet = connects >= targetConnects;
          const isMidMet = connects >= midConnects;
          const gap = isTargetMet ? 0 : isMidMet ? targetConnects - connects : midConnects - connects;
          const targetPosPct = (targetConnects / maxConnects) * 100;
          const midPosPct = (midConnects / maxConnects) * 100;

          return (
            <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1">
                    <PhoneCall className="w-3.5 h-3.5 text-indigo-500" />
                    5. Connects
                  </span>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                    result.connects.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' :
                    result.connects.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {result.connects.band === 'None' ? 'Below Min' : `${result.connects.band} Band`}
                  </span>
                </div>

                <div className="text-2xl font-black text-slate-950 dark:text-white font-mono tabular-nums">
                  {connects}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> / day</span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{formatNumberINR(totals.connects)} total connects</p>

                {/* Progress Bar with Dynamic Target & Next Requirement Markers */}
                <div className="mt-3.5 mb-1.5">
                  <div className="relative w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80">
                    {/* Fill */}
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTargetMet ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : isMidMet ? 'bg-indigo-500' : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      style={{ width: `${Math.min(100, (connects / maxConnects) * 100)}%` }}
                    />

                    {/* Target Pin at targetConnects */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${targetPosPct}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isTargetMet ? 'bg-emerald-500' : 'bg-emerald-600 dark:bg-emerald-400'}`} />
                      <span className="absolute -top-4.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-900 text-emerald-300 dark:bg-black dark:text-emerald-300 border border-emerald-500/60 shadow-xs">
                        🎯 {targetConnects}/d
                      </span>
                    </div>

                    {/* Mid Hurdle Pin at midConnects */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${midPosPct}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isMidMet ? 'bg-indigo-400' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="absolute top-3.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Mid {midConnects}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Summary Strip */}
                  <div className="mt-5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">
                      🎯 Target: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">≥{targetConnects}/day</strong>
                    </span>
                    <span className={isTargetMet ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-indigo-600 dark:text-indigo-400 font-bold'}>
                      {isTargetMet ? '✓ Target Met' : `⭐ Need +${gap}/d for ${isMidMet ? 'High' : 'Mid'}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 dark:text-slate-400">Bonus Payout:</span>
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">{formatCurrencyINR(result.connects.amount)}</span>
              </div>
            </div>
          );
        })()}

        {/* 6. Talk Time */}
        {(() => {
          const talk = metrics.avgTalkMinutes;
          const targetTalk = plan.bonuses.talkMinutes.high;
          const midTalk = plan.bonuses.talkMinutes.mid;
          const maxTalk = Math.max(200, Math.round(targetTalk * 1.15));
          const isTargetMet = talk >= targetTalk;
          const isMidMet = talk >= midTalk;
          const gap = isTargetMet ? 0 : isMidMet ? targetTalk - talk : midTalk - talk;
          const targetPosPct = (targetTalk / maxTalk) * 100;
          const midPosPct = (midTalk / maxTalk) * 100;

          return (
            <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                    6. Talk Time
                  </span>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                    result.talk.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' :
                    result.talk.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {result.talk.band === 'None' ? 'Below Min' : `${result.talk.band} Band`}
                  </span>
                </div>

                <div className="text-2xl font-black text-slate-950 dark:text-white font-mono tabular-nums">
                  {talk}
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> min/day</span>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{formatNumberINR(Math.round(totals.talkSeconds / 60))} total min</p>

                {/* Progress Bar with Dynamic Target & Next Requirement Markers */}
                <div className="mt-3.5 mb-1.5">
                  <div className="relative w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80">
                    {/* Fill */}
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTargetMet ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : isMidMet ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      style={{ width: `${Math.min(100, (talk / maxTalk) * 100)}%` }}
                    />

                    {/* Target Pin at targetTalk */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${targetPosPct}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isTargetMet ? 'bg-emerald-500' : 'bg-emerald-600 dark:bg-emerald-400'}`} />
                      <span className="absolute -top-4.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-900 text-emerald-300 dark:bg-black dark:text-emerald-300 border border-emerald-500/60 shadow-xs">
                        🎯 {targetTalk}m/d
                      </span>
                    </div>

                    {/* Mid Hurdle Pin at midTalk */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${midPosPct}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isMidMet ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="absolute top-3.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        Mid {midTalk}m
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Summary Strip */}
                  <div className="mt-5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">
                      🎯 Target: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">≥{targetTalk}m/day</strong>
                    </span>
                    <span className={isTargetMet ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
                      {isTargetMet ? '✓ Target Met' : `⭐ Need +${gap}m for ${isMidMet ? 'High' : 'Mid'}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 dark:text-slate-400">Bonus Payout:</span>
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">{formatCurrencyINR(result.talk.amount)}</span>
              </div>
            </div>
          );
        })()}

        {/* 7. Store Visits Rider */}
        {(() => {
          const visits = totals.visitsAttributed;
          const targetVisits = plan.visitTiers[plan.visitTiers.length - 1]?.min || 420;
          const nextTier = plan.visitTiers.find((vt) => vt.min > visits);
          const maxVisits = Math.max(targetVisits * 1.15, 450);
          const isTargetMet = visits >= targetVisits;
          const targetPosPct = (targetVisits / maxVisits) * 100;
          const nextPosPct = nextTier ? (nextTier.min / maxVisits) * 100 : targetPosPct;
          const gap = nextTier ? nextTier.min - visits : 0;

          return (
            <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4.5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1">
                    <Store className="w-3.5 h-3.5 text-blue-500" />
                    7. Store Visits
                  </span>
                  <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
                    result.rider.tier > 0 ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                  }`}>
                    {result.rider.tier > 0 ? `Tier ${result.rider.tier}` : 'No Tier'}
                  </span>
                </div>

                <div className="text-2xl font-black text-slate-950 dark:text-white font-mono tabular-nums">
                  {formatNumberINR(visits)}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {agentRecord.agentType === 'HO'
                    ? `${totals.visitsBooked} booked · ${totals.visitsAttributed} attributed`
                    : 'Attributed Visits'}
                </p>

                {/* Progress Bar with Dynamic Target & Next Requirement Markers */}
                <div className="mt-3.5 mb-1.5">
                  <div className="relative w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible border border-slate-200/90 dark:border-slate-700/80">
                    {/* Fill */}
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isTargetMet ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : result.rider.tier > 0 ? 'bg-blue-500' : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      style={{ width: `${Math.min(100, (visits / maxVisits) * 100)}%` }}
                    />

                    {/* Target Pin at Tier 4 */}
                    <div
                      className="absolute top-0 -ml-[1px] z-10"
                      style={{ left: `${targetPosPct}%` }}
                    >
                      <div className={`w-0.5 h-4.5 -mt-0.5 rounded-full ${isTargetMet ? 'bg-emerald-500' : 'bg-blue-600 dark:bg-blue-400'}`} />
                      <span className="absolute -top-4.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-900 text-emerald-300 dark:bg-black dark:text-emerald-300 border border-emerald-500/60 shadow-xs">
                        🎯 T4: {targetVisits}
                      </span>
                    </div>

                    {/* Next Tier Pin */}
                    {nextTier && nextTier.tier < 4 && (
                      <div
                        className="absolute top-0 -ml-[1px] z-10"
                        style={{ left: `${nextPosPct}%` }}
                      >
                        <div className="w-0.5 h-4.5 -mt-0.5 rounded-full bg-amber-400" />
                        <span className="absolute top-3.5 -translate-x-1/2 text-[8px] font-mono font-bold whitespace-nowrap px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          T{nextTier.tier}: {nextTier.min}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Dynamic Summary Strip */}
                  <div className="mt-5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 dark:text-slate-400">
                      🎯 Target: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">≥{targetVisits} visits</strong>
                    </span>
                    <span className={isTargetMet ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-blue-600 dark:text-blue-400 font-bold'}>
                      {isTargetMet ? '✓ Target Met' : `⭐ Need +${gap} for Tier ${nextTier?.tier || 4}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 dark:text-slate-400">Rider Payout:</span>
                <span className="font-bold text-slate-900 dark:text-white tabular-nums">{formatCurrencyINR(result.rider.amount)}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 8. Full Compensation Slab for Agent's Tier */}
      <TierSlabSection
        agentRecord={agentRecord}
        plan={plan}
        onNavigateToSimulator={onNavigateToSimulator}
      />

      {/* 9. Suggestions List */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              9. Daily Coaching Checklist & Action Plan
            </h4>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Click any coaching recommendation to mark as actioned today</p>
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
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 transition"
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 fill-emerald-100 dark:fill-emerald-950" />
                    ) : item.type === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    ) : item.type === 'streak' ? (
                      <Flame className="w-5 h-5 text-orange-500 dark:text-orange-400" />
                    ) : item.difficult ? (
                      <Info className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                    ) : (
                      <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    )}
                  </button>

                  <div className="flex-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className={`font-semibold leading-relaxed flex items-center gap-1.5 flex-wrap ${
                        isDone ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'
                      }`}>
                        {item.defaultText}
                        {item.isAiText && (
                          <span
                            title="AI Powered Coaching"
                            className="inline-flex items-center text-amber-500 dark:text-amber-400 shrink-0"
                          >
                            <Sparkles className="w-3.5 h-3.5 fill-amber-400 text-amber-500 animate-subtle-sparkle" />
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
      </div>

      {/* 10. Daily Trend Chart */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
            10. Daily Revenue Trend
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
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickFormatter={(val) => `₹${(val / 100000).toFixed(1)}L`}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }}
                  formatter={(val: any) => [formatCurrencyINR(Number(val)), 'Sales']}
                  labelFormatter={(lbl) => `Date: ${lbl}`}
                />
                <Bar dataKey="sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
