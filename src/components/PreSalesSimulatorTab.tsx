import React, { useState } from 'react';
import { PreSalesPlan, PreSalesTier } from '../shared/types';
import { calculatePreSales, formatCurrencyINR } from '../shared/incentive';
import { AnimatedCounter } from './AnimatedCounter';
import { soundFx } from '../utils/audio';
import { Calculator, Lock, RotateCcw, Sparkles, TrendingUp, Unlock } from 'lucide-react';

interface PreSalesSimulatorTabProps {
  plan: PreSalesPlan;
  initialCalls: number;
  initialTalkSeconds: number;
  initialQualityScore: number;
  actualTotalIncentive: number;
}

/** "Tier 1: 101 to 115 = Rs 500 | Tier 2: ... | Tier 3: 131+ = Rs 2,000" */
function tierHint(tiers: PreSalesTier[], unit: string): string {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  return sorted
    .map((t, i) => {
      const next = sorted[i + 1];
      const range = next ? `${t.min} to ${next.min - 1}` : `${t.min}+`;
      return `Tier ${i + 1}: ${range} ${unit} = ${formatCurrencyINR(t.payout)}`;
    })
    .join(' • ');
}

export function PreSalesSimulatorTab({
  plan,
  initialCalls,
  initialTalkSeconds,
  initialQualityScore,
  actualTotalIncentive,
}: PreSalesSimulatorTabProps) {
  const [calls, setCalls] = useState<number>(initialCalls);
  const [talkSeconds, setTalkSeconds] = useState<number>(initialTalkSeconds);
  const [qualityScore, setQualityScore] = useState<number>(initialQualityScore);

  const handleReset = () => {
    soundFx.playPop();
    setCalls(initialCalls);
    setTalkSeconds(initialTalkSeconds);
    setQualityScore(initialQualityScore);
  };

  // Quality 0 means "no audit yet", which never meets the gate
  const result = calculatePreSales(
    {
      avgCalls: Math.max(0, Math.round(calls)),
      avgTalkSeconds: Math.max(0, Math.round(talkSeconds)),
      qualityScore: qualityScore > 0 ? Math.min(100, Math.max(0, Math.round(qualityScore))) : null,
    },
    plan
  );
  const ps = result.preSales;
  const diffFromActual = result.total - actualTotalIncentive;

  const inputClass =
    'w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white font-mono';
  const badgeClass =
    'text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-0.5 rounded font-mono';

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shadow-xs border border-amber-500/30 shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Interactive What-If Incentive Simulator</h3>
              <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded font-mono font-bold">Live Calc</span>
            </div>
            <p className="text-xs text-slate-300">
              Enter the averages you expect at the end of the cycle. Nothing is saved.
            </p>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg shadow-xs transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Inputs */}
        <div className="lg:col-span-7 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h4 className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              Adjust Simulation Parameters
            </h4>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">Drag sliders or type exact values</span>
          </div>

          {/* Calls per day */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">Average Inbound Calls per day</label>
              <span className={badgeClass}>{calls} / day</span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={250}
                value={calls}
                onChange={(e) => {
                  soundFx.playTick();
                  setCalls(Math.max(0, Number(e.target.value) || 0));
                }}
                className="flex-1 accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <input
                type="number"
                min={0}
                max={250}
                value={calls}
                onChange={(e) => {
                  soundFx.playTick();
                  setCalls(Math.min(250, Math.max(0, Number(e.target.value) || 0)));
                }}
                className={inputClass}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{tierHint(plan.calls, 'calls')}</p>
          </div>

          {/* Talk time */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">Average Talk Time (seconds)</label>
              <span className={badgeClass}>{talkSeconds} sec</span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={400}
                value={talkSeconds}
                onChange={(e) => {
                  soundFx.playTick();
                  setTalkSeconds(Math.max(0, Number(e.target.value) || 0));
                }}
                className="flex-1 accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <input
                type="number"
                min={0}
                max={400}
                value={talkSeconds}
                onChange={(e) => {
                  soundFx.playTick();
                  setTalkSeconds(Math.min(400, Math.max(0, Number(e.target.value) || 0)));
                }}
                className={inputClass}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{tierHint(plan.talkSeconds, 'sec')}</p>
          </div>

          {/* Quality */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">Average Quality Audit Score (%)</label>
              <span className={badgeClass}>{qualityScore}%</span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={100}
                value={qualityScore}
                onChange={(e) => {
                  soundFx.playTick();
                  setQualityScore(Math.max(0, Number(e.target.value) || 0));
                }}
                className="flex-1 accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={qualityScore}
                onChange={(e) => {
                  soundFx.playTick();
                  setQualityScore(Math.min(100, Math.max(0, Number(e.target.value) || 0)));
                }}
                className={inputClass}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              You need {plan.qualityGate}% or more to receive BOTH incentives. Below {plan.qualityGate}% both are ₹0.
            </p>
          </div>
        </div>

        {/* Result */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-3xl p-6 sm:p-7 border border-amber-500/30 shadow-[0_15px_45px_rgba(0,0,0,0.4)] space-y-5 sticky top-20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-bl from-amber-400/20 via-amber-500/5 to-transparent rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider font-extrabold text-amber-400 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-subtle-sparkle" />
                Simulated Total Incentive
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full ${
                  ps?.eligible
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-400/15 text-amber-300 border border-amber-400/30'
                }`}
              >
                {ps?.eligible ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {ps?.eligible ? 'Unlocked' : 'Locked'}
              </span>
            </div>

            <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 tracking-tight font-mono mt-2">
              <AnimatedCounter value={result.total} />
            </div>

            <div className="mt-3 text-xs font-semibold font-mono">
              {diffFromActual >= 0 ? (
                <span className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />+
                  <AnimatedCounter value={diffFromActual} /> more than today
                </span>
              ) : (
                <span className="text-rose-300 bg-rose-950/50 border border-rose-800/60 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
                  -<AnimatedCounter value={Math.abs(diffFromActual)} /> less than today
                </span>
              )}
            </div>
          </div>

          <div className="relative z-10 border-t border-white/10 pt-4 space-y-2.5 text-xs">
            <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-widest font-mono">Simulated Breakdown</h5>

            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div>
                <span className="font-semibold text-slate-300">Quality gate</span>
                <span className="text-[11px] text-slate-400 ml-1.5 font-mono">
                  ({ps?.qualityScore === null || ps?.qualityScore === undefined ? 'no score' : `${ps.qualityScore}%`} vs {plan.qualityGate}%)
                </span>
              </div>
              <span className={`font-bold font-mono ${ps?.eligible ? 'text-emerald-300' : 'text-amber-300'}`}>
                {ps?.eligible ? 'Met' : 'Not met'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div>
                <span className="font-semibold text-slate-300">Calls per day</span>
                <span className="text-[11px] text-slate-400 ml-1.5 font-mono">
                  ({ps && ps.calls.tier > 0 ? `Tier ${ps.calls.tier}` : 'no tier'})
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={ps?.calls.amount ?? 0} />
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-semibold text-slate-300">Talk time</span>
                <span className="text-[11px] text-slate-400 ml-1.5 font-mono">
                  ({ps && ps.talk.tier > 0 ? `Tier ${ps.talk.tier}` : 'no tier'})
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={ps?.talk.amount ?? 0} />
              </span>
            </div>

            {ps && !ps.eligible && ps.potentialTotal > 0 && (
              <p className="text-[11px] text-amber-300 pt-1">
                {formatCurrencyINR(ps.potentialTotal)} is locked until the Quality Score reaches {plan.qualityGate}%.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
