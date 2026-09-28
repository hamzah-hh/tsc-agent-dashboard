import React, { useState } from 'react';
import {
  Award,
  CheckCircle2,
  Sparkles,
  Building,
  Store,
  ArrowUpRight,
  PhoneCall,
  Clock,
  Layers,
  ChevronRight,
  Target,
} from 'lucide-react';
import { AgentRecord, Plan } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import { minSalesForClass } from '../shared/planning';
import { soundFx } from '../utils/audio';

interface TierSlabSectionProps {
  agentRecord: AgentRecord;
  plan: Plan;
  onNavigateToSimulator?: (presetSales?: number) => void;
}

export const TierSlabSection: React.FC<TierSlabSectionProps> = ({
  agentRecord,
  plan,
  onNavigateToSimulator,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'revenue' | 'bonuses' | 'rider'>('all');

  const { result, totals, agentType, location } = agentRecord;
  const isHO = agentType === 'HO';
  const tierDisplayName = isHO ? 'Head Office Tier (HO)' : 'Retail Store Tier (STORE)';

  const currentClass = result.className || 'NQ';
  const currentRiderTier = result.rider?.tier || 0;

  // Ordered list of classes for display
  const displayClasses = plan.classes || [];
  // The first limit above 0 (90 in the standard plan), for the "not qualified" row
  const firstQualifyingPct = displayClasses.find((c) => c.abovePct > 0)?.abovePct ?? 0;

  return (
    <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs space-y-6 relative overflow-hidden transition-colors duration-200">
      {/* Ambient background decoration */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/5 dark:bg-amber-400/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-60 h-60 bg-indigo-500/5 dark:bg-indigo-400/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header with Tier Title & Summary Chips */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 pb-5 relative z-10">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 dark:bg-amber-400/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-xs">
              {isHO ? <Building className="w-4 h-4" /> : <Store className="w-4 h-4" />}
            </div>
            <h3 className="text-base sm:text-lg font-extrabold text-slate-950 dark:text-white tracking-tight flex items-center gap-2">
              <span>{tierDisplayName} Compensation Slabs</span>
            </h3>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-xs">
              Target: {formatCurrencyINR(plan.target)}
            </span>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-700 dark:text-amber-300 border border-amber-400/30">
              Active Slab: Class {currentClass}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Official payout rules and bonus matrices for callers in{' '}
            <strong className="text-slate-800 dark:text-slate-200">{location || 'Assigned Location'}</strong>.
            Your current status is highlighted across all slabs.
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs shrink-0 overflow-x-auto shadow-inner">
          <button
            onClick={() => {
              soundFx.playTick();
              setActiveTab('all');
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            All Slabs
          </button>
          <button
            onClick={() => {
              soundFx.playTick();
              setActiveTab('revenue');
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'revenue'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Revenue Slabs
          </button>
          <button
            onClick={() => {
              soundFx.playTick();
              setActiveTab('bonuses');
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'bonuses'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            KPI Bonuses
          </button>
          <button
            onClick={() => {
              soundFx.playTick();
              setActiveTab('rider');
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              activeTab === 'rider'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Store Visits Rider
          </button>
        </div>
      </div>

      {/* 1. Revenue & Commission Slabs Table */}
      {(activeTab === 'all' || activeTab === 'revenue') && (
        <div className="space-y-3 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <h4 className="text-xs uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
                1. Revenue Class Slabs & Commission Rates
              </h4>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono hidden sm:inline">
              Base Target: {formatCurrencyINR(plan.target)}
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-950/60 shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase font-mono text-[10px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-4 font-bold">Class</th>
                  <th className="py-3.5 px-4 font-bold">Achievement Threshold</th>
                  <th className="py-3.5 px-4 text-right font-bold">Min Sales Required</th>
                  <th className="py-3.5 px-4 text-center font-bold">Commission Rate</th>
                  <th className="py-3.5 px-4 text-right font-bold">Min Gross Incentive</th>
                  <th className="py-3.5 px-4 text-center font-bold">Your Status</th>
                  <th className="py-3.5 px-4 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {displayClasses.map((cls) => {
                  const minSales = minSalesForClass(plan, cls.name);
                  const isCurrent = currentClass === cls.name;
                  const isAchieved = totals.sales >= minSales;
                  const minIncentive = Math.floor(minSales * cls.rate);

                  return (
                    <tr
                      key={cls.name}
                      className={`transition-colors duration-150 ${
                        isCurrent
                          ? 'bg-amber-500/10 dark:bg-amber-950/40 border-l-4 border-amber-500 font-semibold'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-black font-mono shrink-0 ${
                              cls.name === 'NQ'
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                : isCurrent
                                ? 'bg-amber-400 text-slate-950 shadow-xs'
                                : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60'
                            }`}
                          >
                            {cls.name}
                          </span>
                          <span>Class {cls.name}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {cls.abovePct === 0
                          ? `Up to ${firstQualifyingPct}% (Not Qualified)`
                          : `>${cls.abovePct}% Target`}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                        {cls.abovePct === 0 ? '₹0' : formatCurrencyINR(minSales)}
                      </td>

                      <td className="py-3.5 px-4 text-center font-mono font-bold">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            cls.rate > 0
                              ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {(cls.rate * 100).toFixed(2)}%
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 dark:text-slate-200 tabular-nums">
                        {cls.rate > 0 ? formatCurrencyINR(minIncentive) : '₹0'}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black font-mono bg-amber-400 text-slate-950 shadow-[0_0_12px_rgba(251,191,36,0.6)]">
                            <Sparkles className="w-3 h-3" />
                            CURRENT SLAB
                          </span>
                        ) : isAchieved ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" /> Achieved
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                            Upcoming
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        {onNavigateToSimulator && cls.abovePct > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              soundFx.playPop();
                              onNavigateToSimulator(minSales);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-mono transition"
                          >
                            <span>Simulate</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. KPI Bonus Slabs Matrix */}
      {(activeTab === 'all' || activeTab === 'bonuses') && (
        <div className="space-y-3 pt-2 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h4 className="text-xs uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
                2. Quality, Connects & Talk Time Bonus Slabs
              </h4>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              Payouts scale with your active Revenue Class ({currentClass})
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Quality Score Bonus */}
            <div className="bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                      <Award className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">Quality Audit Score</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                    result.quality.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60' :
                    result.quality.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                  }`}>
                    {result.quality.band} Band (+{formatCurrencyINR(result.quality.amount)})
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">High Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">≥{plan.bonuses.quality.high}% Audit Score</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.quality.amounts[currentClass]?.[0] || 0)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-amber-600 dark:text-amber-400">Mid Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">{plan.bonuses.quality.mid}% to {plan.bonuses.quality.high - 1}%</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.quality.amounts[currentClass]?.[1] || 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono">
                <span>Your Score: <strong className="text-slate-800 dark:text-slate-200">{agentRecord.quality?.score ? `${agentRecord.quality.score}%` : 'N/A'}</strong></span>
                <span>{agentRecord.quality?.audits || 0} Audits</span>
              </div>
            </div>

            {/* Card 2: Unique Connects Bonus */}
            <div className="bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                      <PhoneCall className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">Unique Connects</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                    result.connects.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60' :
                    result.connects.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                  }`}>
                    {result.connects.band} Band (+{formatCurrencyINR(result.connects.amount)})
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">High Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">≥{plan.bonuses.connects.high} connects / day</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.connects.amounts[currentClass]?.[0] || 0)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-amber-600 dark:text-amber-400">Mid Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">{plan.bonuses.connects.mid} to {plan.bonuses.connects.high - 1} / day</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.connects.amounts[currentClass]?.[1] || 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono">
                <span>Your Avg: <strong className="text-slate-800 dark:text-slate-200">{totals.activeDays ? Math.round(totals.connects / totals.activeDays) : 0} / day</strong></span>
                <span>{totals.connects} Total</span>
              </div>
            </div>

            {/* Card 3: Talk Time Bonus */}
            <div className="bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 dark:bg-amber-400/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                      <Clock className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">Talk Time</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                    result.talk.band === 'High' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60' :
                    result.talk.band === 'Mid' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                  }`}>
                    {result.talk.band} Band (+{formatCurrencyINR(result.talk.amount)})
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">High Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">≥{plan.bonuses.talkMinutes.high} min / day</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.talkMinutes.amounts[currentClass]?.[0] || 0)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                    <div>
                      <span className="font-bold text-amber-600 dark:text-amber-400">Mid Band</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block">{plan.bonuses.talkMinutes.mid} to {plan.bonuses.talkMinutes.high - 1}m / day</span>
                    </div>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatCurrencyINR(plan.bonuses.talkMinutes.amounts[currentClass]?.[1] || 0)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono">
                <span>Your Avg: <strong className="text-slate-800 dark:text-slate-200">{totals.activeDays ? Math.round(totals.talkSeconds / 60 / totals.activeDays) : 0} min/day</strong></span>
                <span>{Math.round(totals.talkSeconds / 60)} Total Min</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Store Visits Rider Slabs */}
      {(activeTab === 'all' || activeTab === 'rider') && (
        <div className="space-y-3 pt-2 relative z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <h4 className="text-xs uppercase tracking-wider font-extrabold text-slate-900 dark:text-white font-mono flex items-center gap-1.5">
                3. Store Visits Rider Slabs ({tierDisplayName})
              </h4>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              Current Attributed Visits: <strong className="text-slate-900 dark:text-white font-bold">{totals.visitsAttributed}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {plan.visitTiers.map((vt) => {
              const isAchieved = totals.visitsAttributed >= vt.min;
              const isCurrentRiderTier = currentRiderTier === vt.tier;
              const gap = Math.max(0, vt.min - totals.visitsAttributed);

              return (
                <div
                  key={vt.tier}
                  className={`p-4 rounded-2xl border transition-all duration-200 ${
                    isCurrentRiderTier
                      ? 'bg-amber-500/10 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.2)]'
                      : isAchieved
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/70'
                      : 'bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                        isCurrentRiderTier
                          ? 'bg-amber-400 text-slate-950'
                          : isAchieved
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}>
                        {vt.tier}
                      </span>
                      Tier {vt.tier}
                    </span>

                    {isCurrentRiderTier ? (
                      <span className="text-[9px] font-black font-mono px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-xs">
                        CURRENT RIDER
                      </span>
                    ) : isAchieved ? (
                      <span className="text-[10px] font-bold font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Met
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        Need +{gap}
                      </span>
                    )}
                  </div>

                  <div className="text-lg font-black text-slate-900 dark:text-white font-mono mb-1">
                    {formatCurrencyINR(vt.payout)}
                  </div>

                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    Threshold: ≥{vt.min} visits
                  </div>

                  <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isAchieved ? 'bg-emerald-500' : 'bg-amber-400'
                      }`}
                      style={{ width: `${Math.min(100, (totals.visitsAttributed / vt.min) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
