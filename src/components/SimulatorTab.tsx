import React, { useState, useEffect, useRef } from 'react';
import { Plan, ProcessedMetrics } from '../shared/types';
import { calculateFromMetrics, formatCurrencyINR, formatNumberINR, roundHalfUp } from '../shared/incentive';
import { classRank, classSteps } from '../shared/classes';
import { Calculator, RotateCcw, TrendingUp, Award, Sparkles, Flame, CheckCircle, Zap } from 'lucide-react';
import { AnimatedCounter } from './AnimatedCounter';
import { soundFx } from '../utils/audio';
import { fireMilestoneBurst } from '../utils/confetti';

interface SimulatorTabProps {
  plan: Plan;
  agentType: 'HO' | 'STORE';
  initialSales: number;
  initialAvgConnects: number;
  initialAvgTalkMinutes: number;
  initialQualityScore: number;
  initialVisits: number;
  actualTotalIncentive: number;
  presetSales?: number;
}

export function SimulatorTab({
  plan,
  agentType,
  initialSales,
  initialAvgConnects,
  initialAvgTalkMinutes,
  initialQualityScore,
  initialVisits,
  actualTotalIncentive,
  presetSales,
}: SimulatorTabProps) {
  // Input states
  const [sales, setSales] = useState<number>(presetSales ?? initialSales);
  const [avgConnects, setAvgConnects] = useState<number>(initialAvgConnects);
  const [avgTalkMinutes, setAvgTalkMinutes] = useState<number>(initialAvgTalkMinutes);
  const [qualityScore, setQualityScore] = useState<number>(initialQualityScore);
  const [visitsAttributed, setVisitsAttributed] = useState<number>(initialVisits);

  const prevClassRef = useRef<string>('NQ');

  useEffect(() => {
    if (presetSales && presetSales > 0) {
      setSales(presetSales);
    }
  }, [presetSales]);

  const handleReset = () => {
    soundFx.playPop();
    setSales(initialSales);
    setAvgConnects(initialAvgConnects);
    setAvgTalkMinutes(initialAvgTalkMinutes);
    setQualityScore(initialQualityScore);
    setVisitsAttributed(initialVisits);
  };

  // Immediate recalculation. The real calculation rounds connects, talk minutes and the quality score to
  // whole numbers before it looks up a band, so the simulator does the same (a typed 89.6 counts as 90).
  const metrics: ProcessedMetrics = {
    sales: Math.max(0, sales),
    avgConnects: roundHalfUp(Math.max(0, avgConnects)),
    avgTalkMinutes: roundHalfUp(Math.max(0, avgTalkMinutes)),
    qualityScore: qualityScore > 0 ? roundHalfUp(Math.min(100, Math.max(0, qualityScore))) : null,
    visitsAttributed: Math.max(0, visitsAttributed),
    absentDays: null,
  };

  const simResult = calculateFromMetrics(metrics, plan);
  const diffFromActual = simResult.total - actualTotalIncentive;

  // Check if class leveled up (a higher position in the plan's class list = a better class)
  useEffect(() => {
    const prevRank = classRank(plan, prevClassRef.current);
    const currentRank = classRank(plan, simResult.className);

    if (currentRank > prevRank && prevRank > 0) {
      fireMilestoneBurst(0.65, 0.4);
    }
    prevClassRef.current = simResult.className;
  }, [simResult.className]);

  // Help texts for bands & tiers
  const qCfg = plan.bonuses.quality;
  const cCfg = plan.bonuses.connects;
  const tCfg = plan.bonuses.talkMinutes;

  // Class presets come from the plan: each one sets revenue to the first rupee that reaches the class
  const steps = classSteps(plan);
  const topVisitTier = [...plan.visitTiers].sort((a, b) => a.min - b.min).at(-1);
  const simRank = classRank(plan, simResult.className);

  const applyPreset = (presetName: string) => {
    soundFx.playPop();
    if (presetName.startsWith('class:')) {
      const step = steps.find((s) => s.name === presetName.slice('class:'.length));
      if (step) setSales(step.minSales);
    } else if (presetName === 'maxBonuses') {
      setAvgConnects(cCfg.high);
      setAvgTalkMinutes(tCfg.high);
      setQualityScore(qCfg.high);
    } else if (presetName === 'superJackpot') {
      // Everything at the top: the top class, all three bonuses High, the top store-visit tier
      const top = steps[steps.length - 1];
      if (top) setSales(top.minSales);
      setAvgConnects(cCfg.high);
      setAvgTalkMinutes(tCfg.high);
      setQualityScore(qCfg.high);
      if (topVisitTier) setVisitsAttributed(topVisitTier.min);
      fireMilestoneBurst();
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice with Presets */}
      <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm shadow-xs border border-amber-500/30 shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Interactive What-If Payout Simulator</h3>
              <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded font-mono font-bold">Live Calc</span>
            </div>
            <p className="text-xs text-slate-300">
              Adjust expected final metrics to see your payout jump. Instant calculations with zero risk.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg shadow-xs transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>

      {/* Quick Target Preset Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-500 animate-subtle-sparkle" /> Presets:
        </span>
        {steps.map((s, i) => (
          <button
            key={s.name}
            onClick={() => applyPreset(`class:${s.name}`)}
            title={`Sets revenue to ${formatCurrencyINR(s.minSales)}, the first rupee above ${s.abovePct}% of the target`}
            className={`group relative px-3.5 py-1.5 rounded-xl font-bold border whitespace-nowrap transition active:scale-95 shadow-xs flex items-center gap-1.5 ${
              i % 2 === 0
                ? 'bg-amber-500/10 hover:bg-amber-500/20 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border-amber-500/30'
                : 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60'
            }`}
          >
            <span>{i % 2 === 0 ? '🎯' : '🔥'}</span>
            <span>
              Class {s.name} (&gt;{s.abovePct}%)
            </span>
          </button>
        ))}
        <button
          onClick={() => applyPreset('maxBonuses')}
          className="group relative px-3.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap transition active:scale-95 shadow-xs flex items-center gap-1.5"
        >
          <span>✨</span>
          <span>Max High Bands</span>
        </button>
        <button
          onClick={() => applyPreset('superJackpot')}
          className="group relative px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-slate-950 font-black shadow-[0_0_15px_rgba(245,158,11,0.35)] whitespace-nowrap transition active:scale-95 flex items-center gap-1.5 overflow-hidden"
        >
          <div className="absolute inset-0 w-1/2 h-full bg-white/30 transform -skew-x-12 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-700" />
          <span>🚀</span>
          <span>Pinnacle Jackpot (All-Out)</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Inputs */}
        <div className="lg:col-span-7 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h4 className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              Adjust Simulation Parameters
            </h4>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">Drag sliders or type exact values</span>
          </div>

          {/* 1. Final Revenue */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Final Revenue Projection (₹)
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTick();
                    setSales((s) => Math.max(0, s + 100000));
                  }}
                  className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded border border-slate-200 dark:border-slate-700 transition font-mono active:scale-95"
                >
                  +1L
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTick();
                    setSales((s) => Math.max(0, s + 500000));
                  }}
                  className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded border border-slate-200 dark:border-slate-700 transition font-mono active:scale-95"
                >
                  +5L
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playTick();
                    setSales((s) => Math.max(0, s + 1000000));
                  }}
                  className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded border border-slate-200 dark:border-slate-700 transition font-mono active:scale-95"
                >
                  +10L
                </button>
              </div>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-sm">₹</span>
              <input
                type="number"
                min={0}
                step={50000}
                value={sales}
                onChange={(e) => {
                  soundFx.playTick();
                  setSales(Math.max(0, Number(e.target.value) || 0));
                }}
                className="w-full pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-xl text-sm font-bold text-slate-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              <span>Formatted: <strong className="text-slate-900 dark:text-slate-100">{formatCurrencyINR(sales)}</strong></span>
              <span>Target: {formatCurrencyINR(plan.target)}</span>
            </div>
          </div>

          {/* 2. Unique Connects */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Average Unique Connects per day
              </label>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-0.5 rounded font-mono">
                {avgConnects} / day
              </span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={250}
                value={avgConnects}
                onChange={(e) => {
                  soundFx.playTick();
                  setAvgConnects(Math.max(0, Number(e.target.value) || 0));
                }}
                className="flex-1 accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <input
                type="number"
                min={0}
                max={250}
                value={avgConnects}
                onChange={(e) => {
                  soundFx.playTick();
                  setAvgConnects(Math.min(250, Math.max(0, Number(e.target.value) || 0)));
                }}
                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white font-mono"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              High = {cCfg.high}+ &bull; Mid = {cCfg.mid} to {cCfg.high - 1} &bull; None &lt; {cCfg.mid}
            </p>
          </div>

          {/* 3. Talk Time */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Average Talk Time per day (minutes)
              </label>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-0.5 rounded font-mono">
                {avgTalkMinutes} min/day
              </span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={300}
                value={avgTalkMinutes}
                onChange={(e) => {
                  soundFx.playTick();
                  setAvgTalkMinutes(Math.max(0, Number(e.target.value) || 0));
                }}
                className="flex-1 accent-indigo-600 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
              />
              <input
                type="number"
                min={0}
                max={300}
                value={avgTalkMinutes}
                onChange={(e) => {
                  soundFx.playTick();
                  setAvgTalkMinutes(Math.min(300, Math.max(0, Number(e.target.value) || 0)));
                }}
                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white font-mono"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              High = {tCfg.high}m+ &bull; Mid = {tCfg.mid}m to {tCfg.high - 1}m &bull; None &lt; {tCfg.mid}m
            </p>
          </div>

          {/* 4. Quality Score */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Average Quality Audit Score (%)
              </label>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-0.5 rounded font-mono">
                {qualityScore}%
              </span>
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
                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white font-mono"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              High = {qCfg.high}%+ &bull; Mid = {qCfg.mid}% to {qCfg.high - 1}% &bull; None &lt; {qCfg.mid}% (rounded to a whole number)
            </p>
          </div>

          {/* 5. Attributed Store Visits */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Attributed Store Visits
              </label>
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/60 px-2 py-0.5 rounded font-mono">
                {visitsAttributed} visits
              </span>
            </div>
            <input
              type="number"
              min={0}
              value={visitsAttributed}
              onChange={(e) => {
                soundFx.playTick();
                setVisitsAttributed(Math.max(0, Number(e.target.value) || 0));
              }}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {plan.visitTiers.map((t) => `T${t.tier}: ≥${t.min} (${formatCurrencyINR(t.payout)})`).join(' • ')}
            </p>
          </div>
        </div>

        {/* Right Side: Output Card */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-white rounded-3xl p-6 sm:p-7 border border-amber-500/30 shadow-[0_15px_45px_rgba(0,0,0,0.4)] space-y-5 sticky top-20 relative overflow-hidden group">
          {/* Ambient Lighting */}
          <div className="absolute top-0 right-0 w-44 h-44 bg-gradient-to-bl from-amber-400/20 via-amber-500/5 to-transparent rounded-full blur-2xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider font-extrabold text-amber-400 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-subtle-sparkle" />
                Simulated Total Payout
              </span>
              <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full ${
                simRank > 0 && simRank === steps.length
                  ? 'bg-amber-400 text-slate-950 font-black shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                  : simRank > 0
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-white/10 text-slate-300 border border-white/10'
              }`}>
                Class {simResult.className} · {formatNumberINR(simResult.achievementPct, 1)}%
              </span>
            </div>

            <div className="text-3xl sm:text-4xl lg:text-[40px] font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 tracking-tight font-mono filter drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)] mt-2">
              <AnimatedCounter value={simResult.total} />
            </div>

            {/* Difference compared to actual */}
            <div className="mt-3 text-xs font-semibold font-mono">
              {diffFromActual >= 0 ? (
                <span className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5 shadow-xs">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  +<AnimatedCounter value={diffFromActual} /> more than current reality
                </span>
              ) : (
                <span className="text-rose-300 bg-rose-950/50 border border-rose-800/60 px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5">
                  -<AnimatedCounter value={Math.abs(diffFromActual)} /> less than current
                </span>
              )}
            </div>
          </div>

          <div className="relative z-10 border-t border-white/10 pt-4 space-y-2.5 text-xs">
            <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-widest font-mono">
              Simulated Breakdown
            </h5>

            {/* Revenue Incentive */}
            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div>
                <span className="font-semibold text-slate-300">Revenue Incentive</span>
                <span className="text-[11px] text-slate-400 ml-1.5 font-mono">
                  ({(simResult.rate * 100).toFixed(2)}%)
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={simResult.revenueIncentiveNet} />
              </span>
            </div>

            {/* Quality Bonus */}
            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Quality Bonus</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
                  simResult.quality.band === 'High' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                  simResult.quality.band === 'Mid' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/10 text-slate-400'
                }`}>
                  {simResult.quality.band}
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={simResult.quality.amount} />
              </span>
            </div>

            {/* Connects Bonus */}
            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Unique Connects</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
                  simResult.connects.band === 'High' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                  simResult.connects.band === 'Mid' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/10 text-slate-400'
                }`}>
                  {simResult.connects.band}
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={simResult.connects.amount} />
              </span>
            </div>

            {/* Talk Time Bonus */}
            <div className="flex items-center justify-between py-1 border-b border-white/5">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Talk Time Bonus</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
                  simResult.talk.band === 'High' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                  simResult.talk.band === 'Mid' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/10 text-slate-400'
                }`}>
                  {simResult.talk.band}
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={simResult.talk.amount} />
              </span>
            </div>

            {/* Store Visit Rider */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Store Visit Rider</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-white/10 text-slate-300 border border-white/10">
                  {simResult.rider.tier > 0 ? `Tier ${simResult.rider.tier}` : 'None'}
                </span>
              </div>
              <span className="font-bold text-white font-mono">
                <AnimatedCounter value={simResult.rider.amount} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
