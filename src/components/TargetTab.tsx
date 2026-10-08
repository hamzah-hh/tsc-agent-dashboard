import React, { useState } from 'react';
import {
  Target,
  TrendingUp,
  Award,
  CheckCircle2,
  AlertTriangle,
  Clock,
  PhoneCall,
  Sparkles,
  Zap,
  ArrowRight,
  Calculator,
  Compass,
  Flame,
  Check,
  Building,
  Store,
  Calendar,
} from 'lucide-react';
import { AgentRecord, Cycle, Plan } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  calculateRemainingWorkingDays,
  minSalesForClass,
  requiredPerDay,
} from '../shared/planning';
import { classSteps, scaleMaxPct } from '../shared/classes';
import { soundFx } from '../utils/audio';
import { fireGoldenCelebration, fireMilestoneBurst } from '../utils/confetti';

interface TargetTabProps {
  agentRecord: AgentRecord | null;
  plan: Plan;
  cycle: Cycle;
  onNavigateToSimulator?: (presetSales?: number) => void;
  onNavigateToActual?: () => void;
}

export const TargetTab: React.FC<TargetTabProps> = ({
  agentRecord,
  plan,
  cycle,
  onNavigateToSimulator,
  onNavigateToActual,
}) => {
  // Hooks stay above every early return (a record that arrives later must not change the hook order).
  // null = the agent has not touched the slider yet, so it follows the live numbers.
  const [chosenDailyTarget, setCustomDailyTarget] = useState<number | null>(null);

  if (!agentRecord || !agentRecord.totals) {
    return (
      <div className="bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto my-8 shadow-xs">
        <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center text-amber-500 mx-auto mb-4">
          <Target className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">No Target Data Found</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Target parameters will appear once caller data is loaded.
        </p>
      </div>
    );
  }

  const { totals, quality, absentDays, lastDataDate, result, agentType } = agentRecord;
  const isHO = agentType === 'HO';
  const tierDisplayName = isHO ? 'Head Office Tier (HO)' : 'Retail Store Tier (STORE)';

  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    cycle.startDate,
    cycle.endDate,
    cycle.workingDaysPerWeek
  );

  const targetSales = plan.target;
  const salesAchieved = totals.sales || 0;
  const targetGap = Math.max(0, targetSales - salesAchieved);
  const targetAchievedPct = result.achievementPct || (salesAchieved / targetSales) * 100;
  const isTargetMet = salesAchieved >= targetSales;

  // Daily Run Rates
  const currentDailyAvg = totals.activeDays > 0 ? salesAchieved / totals.activeDays : 0;
  const reqDailyFor100 = requiredPerDay(targetSales, salesAchieved, remainingWorkingDays);

  const isPacingAhead = currentDailyAvg >= reqDailyFor100;

  // Next class calculation
  const currentClassIdx = plan.classes.findIndex((c) => c.name === result.className);
  const nextClass =
    currentClassIdx >= 0 && currentClassIdx < plan.classes.length - 1
      ? plan.classes[currentClassIdx + 1]
      : null;

  // Interactive Target Pace Calculator
  const customDailyTarget =
    chosenDailyTarget ?? Math.round(reqDailyFor100 > 0 ? reqDailyFor100 : currentDailyAvg);

  // Class limits, rates and scale come from the cycle's plan, never from fixed numbers
  const steps = classSteps(plan);
  const scaleMax = scaleMaxPct(plan);
  const visitTiers = [...plan.visitTiers].sort((a, b) => a.min - b.min);
  const topVisitTier = visitTiers[visitTiers.length - 1];

  const simulatedAdditionalSales = Math.max(0, customDailyTarget * remainingWorkingDays);
  const simulatedTotalSales = salesAchieved + simulatedAdditionalSales;
  const simulatedAchievementPct = (simulatedTotalSales / targetSales) * 100;

  return (
    <div className="space-y-6">
      {/* 1. Master Target Overview Banner (Executive Fintech Finish) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 border border-amber-500/30 shadow-[0_15px_45px_rgba(0,0,0,0.35)] relative overflow-hidden">
        {/* Ambient Corner Lighting */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-amber-400/20 via-amber-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs uppercase font-extrabold tracking-wider text-amber-400 font-mono flex items-center gap-1.5">
                <Target className="w-4 h-4" />
                Cycle Target Console · {activeCycleTitle(cycle.name)}
              </span>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-white/10 text-slate-200 border border-white/15">
                {tierDisplayName}
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white flex items-baseline gap-3 flex-wrap">
              <span>Target:</span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 font-mono filter drop-shadow-[0_2px_10px_rgba(245,158,11,0.3)]">
                {formatCurrencyINR(targetSales)}
              </span>
            </h2>

            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Assigned sales target for the <strong>{cycle.name}</strong> cycle. Beat{' '}
              {steps
                .map((s) => `${s.abovePct}% of it for Class ${s.name} (${s.ratePct}% commission)`)
                .join(', ')}
              .
            </p>
          </div>

          {/* Quick Metrics Badge in Header */}
          <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-white/10">
            <div className="text-left lg:text-right">
              <span className="text-[11px] font-mono text-slate-400 block uppercase">Pacing Status</span>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black font-mono mt-1 ${
                isPacingAhead
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
              }`}>
                {isPacingAhead ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Flame className="w-3.5 h-3.5" />}
                {isPacingAhead ? 'AHEAD OF TARGET PACE' : 'ACCELERATION NEEDED'}
              </span>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-mono text-slate-400 block">Remaining Days</span>
              <span className="text-sm font-black font-mono text-white">
                {formatNumberINR(remainingWorkingDays, 1)} working days
              </span>
            </div>
          </div>
        </div>

        {/* Target Progress Bar & High-Level Breakdown */}
        <div className="mt-8 pt-6 border-t border-white/10 space-y-4 relative z-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs font-mono">
            <div>
              <span className="text-slate-400">Current Sales Achieved: </span>
              <strong className="text-xl sm:text-2xl font-black text-white ml-1">
                {formatCurrencyINR(salesAchieved)}
              </strong>
              <span className={`ml-2 font-bold px-2 py-0.5 rounded text-[11px] ${
                targetAchievedPct >= 100
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                  : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
              }`}>
                {formatNumberINR(targetAchievedPct, 1)}% Target Met
              </span>
            </div>

            <div className="text-right">
              {isTargetMet ? (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> 100% Target Delivered! Excess: +{formatCurrencyINR(salesAchieved - targetSales)}
                </span>
              ) : (
                <span className="text-slate-300">
                  Target Balance Gap: <strong className="text-amber-300 font-bold">{formatCurrencyINR(targetGap)}</strong>
                </span>
              )}
            </div>
          </div>

          {/* Connected Target Progress Bar with alternating non-overlapping milestone flags */}
          <div className="relative pt-6 pb-7">
            <div className="w-full h-3.5 bg-slate-800/90 rounded-full overflow-visible p-0.5 border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-700 shadow-[0_0_12px_rgba(251,191,36,0.5)]"
                style={{ width: `${Math.min(100, (targetAchievedPct / scaleMax) * 100)}%` }}
              />

              {/* Threshold Indicators (one for each class limit): alternating top & bottom to prevent any collision */}
              {steps
                .map((s, i) => ({ pct: s.abovePct, label: `${s.abovePct}% Class ${s.name}`, isTop: i % 2 === 0 }))
                .map((m) => {
                const posPct = (m.pct / scaleMax) * 100;
                const isMet = targetAchievedPct >= m.pct;

                return (
                  <div
                    key={m.pct}
                    className="absolute top-0 -ml-[1px]"
                    style={{ left: `${posPct}%` }}
                  >
                    <div className={`w-0.5 h-4.5 -mt-0.5 ${isMet ? 'bg-amber-400' : 'bg-slate-600'}`} />
                    <div
                      className={`absolute -translate-x-1/2 text-center whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shadow-xs ${
                        m.isTop
                          ? '-top-6 bg-slate-900/95 border border-white/10'
                          : 'top-5 bg-slate-900/95 border border-white/10'
                      } ${isMet ? 'text-amber-300 border-amber-400/40' : 'text-slate-400'}`}
                    >
                      <span>{m.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Quick Trajectory Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
            <span className="text-[11px] font-mono text-slate-400 block mb-1">Current Daily Average</span>
            <div className="text-lg font-black font-mono text-white">
              {formatCurrencyINR(Math.round(currentDailyAvg))}
              <span className="text-xs font-normal text-slate-400 font-sans"> / active day</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              Over {totals.activeDays} active days recorded
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
            <span className="text-[11px] font-mono text-slate-400 block mb-1">Required for 100% Target</span>
            <div className="text-lg font-black font-mono text-amber-300">
              {isTargetMet ? (
                <span className="text-emerald-400 inline-flex items-center gap-1 text-sm font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Target Met!
                </span>
              ) : (
                <>
                  {formatCurrencyINR(Math.round(reqDailyFor100))}
                  <span className="text-xs font-normal text-slate-400 font-sans"> / remaining day</span>
                </>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              {isTargetMet ? 'Maintain current pace' : `Need ${formatCurrencyINR(targetGap)} over ${formatNumberINR(remainingWorkingDays, 1)} days`}
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
            <span className="text-[11px] font-mono text-slate-400 block mb-1">
              Required for {nextClass ? `Class ${nextClass.name} Target` : 'the top class'}
            </span>
            <div className="text-lg font-black font-mono text-white">
              {nextClass ? (
                <>
                  {formatCurrencyINR(Math.round(requiredPerDay(minSalesForClass(plan, nextClass.name), salesAchieved, remainingWorkingDays)))}
                  <span className="text-xs font-normal text-slate-400 font-sans"> / remaining day</span>
                </>
              ) : (
                <span className="text-indigo-300 inline-flex items-center gap-1 text-sm font-bold">
                  <Award className="w-4 h-4" /> Top Class Achieved!
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              {nextClass ? `Next milestone threshold: ${nextClass.abovePct}%` : 'You hold the highest class'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Target Slabs Matrix: Class-by-Class Milestones */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h3 className="text-base font-extrabold text-slate-950 dark:text-white tracking-tight font-mono">
                Class Target Breakdown & Earnings Unlocks
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Specific sales hurdles to unlock each commission bracket. Base target is {formatCurrencyINR(plan.target)}.
            </p>
          </div>

          {onNavigateToSimulator && (
            <button
              onClick={() => {
                soundFx.playPop();
                onNavigateToSimulator(plan.target);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-500/30 text-xs font-bold font-mono transition"
            >
              <Calculator className="w-3.5 h-3.5" />
              Open Target Simulator
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plan.classes
            .filter((c) => c.abovePct > 0)
            .map((cls) => {
              const minSales = minSalesForClass(plan, cls.name);
              const isCurrent = result.className === cls.name;
              const isAchieved = salesAchieved >= minSales;
              const gap = Math.max(0, minSales - salesAchieved);
              const reqDaily = requiredPerDay(minSales, salesAchieved, remainingWorkingDays);
              const estIncentive = Math.floor(minSales * cls.rate);

              return (
                <div
                  key={cls.name}
                  className={`rounded-2xl p-5 border flex flex-col justify-between transition-all duration-200 relative overflow-hidden ${
                    isCurrent
                      ? 'bg-amber-500/10 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                      : isAchieved
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/70'
                      : 'bg-slate-50/80 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black font-mono ${
                          isCurrent
                            ? 'bg-amber-400 text-slate-950 shadow-xs'
                            : isAchieved
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}>
                          {cls.name}
                        </span>
                        <div>
                          <span className="font-extrabold text-sm text-slate-950 dark:text-white block leading-tight">
                            Class {cls.name}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            {cls.abovePct}% Target Hurdle
                          </span>
                        </div>
                      </div>

                      {isCurrent ? (
                        <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-xs">
                          CURRENT
                        </span>
                      ) : isAchieved ? (
                        <span className="text-[10px] font-bold font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Met
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          Upcoming
                        </span>
                      )}
                    </div>

                    <div className="space-y-2 py-2 border-y border-slate-200/60 dark:border-slate-800 text-xs font-mono">
                      <div className="flex justify-between items-baseline">
                        <span className="text-slate-500 dark:text-slate-400">Target Revenue:</span>
                        <strong className="text-sm font-extrabold text-slate-900 dark:text-white">
                          {formatCurrencyINR(minSales)}
                        </strong>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 dark:text-slate-400">Commission Rate:</span>
                        <span className="px-1.5 py-0.5 rounded font-bold text-[11px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                          {(cls.rate * 100).toFixed(2)}%
                        </span>
                      </div>

                      <div className="flex justify-between items-baseline">
                        <span className="text-slate-500 dark:text-slate-400">Min Base Payout:</span>
                        <strong className="font-bold text-slate-800 dark:text-slate-200">
                          {formatCurrencyINR(estIncentive)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-2">
                    <div className="text-[11px] font-mono mb-3">
                      {isAchieved ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Target Achieved! (+{formatCurrencyINR(salesAchieved - minSales)})
                        </span>
                      ) : (
                        <div>
                          <div className="text-slate-500 dark:text-slate-400 flex justify-between">
                            <span>Gap to Target:</span>
                            <strong className="text-amber-600 dark:text-amber-400">{formatCurrencyINR(gap)}</strong>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 flex justify-between mt-0.5">
                            <span>Run-rate needed:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{formatCurrencyINR(Math.round(reqDaily))}/day</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {onNavigateToSimulator && (
                      <button
                        type="button"
                        onClick={() => {
                          soundFx.playPop();
                          onNavigateToSimulator(minSales);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-100 hover:bg-amber-400 hover:text-slate-950 dark:bg-slate-800 dark:hover:bg-amber-400 dark:hover:text-slate-950 text-slate-700 dark:text-slate-300 font-mono text-xs font-bold transition shadow-xs"
                      >
                        <span>Simulate Target</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* 3. Operational & KPI Targets Matrix */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs space-y-5">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <h3 className="text-base font-extrabold text-slate-950 dark:text-white tracking-tight font-mono">
              Operational KPI Targets & Daily Benchmarks
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Non-revenue targets to maximize bonus amounts and ensure zero deduction penalties.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* KPI 1: Quality Target */}
          <div className="bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Award className="w-4 h-4 text-emerald-500" />
                Quality Audit Target
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                ≥{plan.bonuses.quality.high}%
              </span>
            </div>

            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {quality.score ? `${quality.score}%` : 'N/A'}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              High: ≥{plan.bonuses.quality.high}% · Mid: ≥{plan.bonuses.quality.mid}%
            </p>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono flex justify-between">
              <span className="text-slate-400">Current Band:</span>
              <strong className="text-slate-900 dark:text-white">{result.quality.band} (+{formatCurrencyINR(result.quality.amount)})</strong>
            </div>
          </div>

          {/* KPI 2: Connects Target */}
          <div className="bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <PhoneCall className="w-4 h-4 text-indigo-500" />
                Connects / Day Target
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                ≥{plan.bonuses.connects.high}/day
              </span>
            </div>

            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {totals.activeDays ? Math.round(totals.connects / totals.activeDays) : 0}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> / day</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              High: ≥{plan.bonuses.connects.high} · Mid: {plan.bonuses.connects.mid}-{plan.bonuses.connects.high - 1}
            </p>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono flex justify-between">
              <span className="text-slate-400">Current Band:</span>
              <strong className="text-slate-900 dark:text-white">{result.connects.band} (+{formatCurrencyINR(result.connects.amount)})</strong>
            </div>
          </div>

          {/* KPI 3: Talk Time Target */}
          <div className="bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500" />
                Talk Time / Day Target
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60">
                ≥{plan.bonuses.talkMinutes.high}m/day
              </span>
            </div>

            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {totals.activeDays ? Math.round(totals.talkSeconds / 60 / totals.activeDays) : 0}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> min/day</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              High: ≥{plan.bonuses.talkMinutes.high}m · Mid: {plan.bonuses.talkMinutes.mid}-{plan.bonuses.talkMinutes.high - 1}m
            </p>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono flex justify-between">
              <span className="text-slate-400">Current Band:</span>
              <strong className="text-slate-900 dark:text-white">{result.talk.band} (+{formatCurrencyINR(result.talk.amount)})</strong>
            </div>
          </div>

          {/* KPI 4: Store Visits Rider Target */}
          <div className="bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Store className="w-4 h-4 text-blue-500" />
                Visits Rider Target
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">
                Tier {topVisitTier?.tier ?? '-'} (≥{topVisitTier?.min ?? '-'})
              </span>
            </div>

            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white">
              {totals.visitsAttributed}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400 font-sans"> visits</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              {visitTiers.slice(0, -1).map((t) => `T${t.tier}: ${t.min}`).join(' · ')}
            </p>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono flex justify-between">
              <span className="text-slate-400">Current Rider:</span>
              <strong className="text-slate-900 dark:text-white">
                {result.rider.tier > 0 ? `Tier ${result.rider.tier} (+${formatCurrencyINR(result.rider.amount)})` : 'None'}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Interactive Target Scenario Calculator */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h3 className="text-base font-extrabold text-slate-950 dark:text-white tracking-tight font-mono">
              Daily Target Run-Rate Scenario Calculator
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400 hidden sm:inline">
            Simulate your target achievement based on daily sales
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5 text-xs font-mono">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  Target Daily Sales for next {formatNumberINR(remainingWorkingDays, 1)} days:
                </span>
                <span className="font-extrabold text-amber-600 dark:text-amber-400 text-sm">
                  {formatCurrencyINR(customDailyTarget)} / day
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(100000, targetSales / 5)}
                step={1000}
                value={customDailyTarget}
                onChange={(e) => setCustomDailyTarget(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-1">
                <span>₹0/day</span>
                <span>Req for 100%: {formatCurrencyINR(Math.round(reqDailyFor100))}</span>
                <span>{formatCurrencyINR(Math.max(100000, targetSales / 5))}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => setCustomDailyTarget(Math.round(currentDailyAvg))}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-semibold"
              >
                Current Pace ({formatCurrencyINR(Math.round(currentDailyAvg))})
              </button>
              <button
                type="button"
                onClick={() => setCustomDailyTarget(Math.round(reqDailyFor100))}
                className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 font-semibold border border-amber-200 dark:border-amber-800"
              >
                100% Target Pace ({formatCurrencyINR(Math.round(reqDailyFor100))})
              </button>
              {nextClass && (
                <button
                  type="button"
                  onClick={() =>
                    setCustomDailyTarget(
                      Math.round(
                        requiredPerDay(
                          minSalesForClass(plan, nextClass.name),
                          salesAchieved,
                          remainingWorkingDays
                        )
                      )
                    )
                  }
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-semibold border border-indigo-200 dark:border-indigo-800"
                >
                  Class {nextClass.name} Pace
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold block">
              Projected Outcome at this pace
            </span>
            <div className="flex justify-between items-baseline text-xs font-mono">
              <span className="text-slate-500 dark:text-slate-400">Total Projected Sales:</span>
              <strong className="text-lg font-black text-slate-900 dark:text-white">
                {formatCurrencyINR(Math.round(simulatedTotalSales))}
              </strong>
            </div>

            <div className="flex justify-between items-baseline text-xs font-mono">
              <span className="text-slate-500 dark:text-slate-400">Target Achievement:</span>
              <strong className={`font-black ${
                simulatedAchievementPct >= 100
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}>
                {formatNumberINR(simulatedAchievementPct, 1)}% of Target
              </strong>
            </div>

            {onNavigateToSimulator && (
              <button
                type="button"
                onClick={() => {
                  soundFx.playPop();
                  onNavigateToSimulator(Math.round(simulatedTotalSales));
                }}
                className="w-full mt-2 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs shadow-xs transition"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Simulate Full Payout for {formatCurrencyINR(Math.round(simulatedTotalSales))}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function activeCycleTitle(cycleName?: string) {
  return cycleName || 'Active Cycle';
}
