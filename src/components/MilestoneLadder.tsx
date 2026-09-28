import React from 'react';
import { Trophy, Sparkles, ChevronRight, Award, Flame, Zap, Crown, CheckCircle2 } from 'lucide-react';
import { Plan } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import { classRank, classSteps } from '../shared/classes';
import { fireGoldenCelebration } from '../utils/confetti';
import { soundFx } from '../utils/audio';

interface MilestoneLadderProps {
  currentClass: string;
  achievementPct: number;
  sales: number;
  plan: Plan;
  onSimulateTarget?: (targetSales: number) => void;
}

const ICONS = [Award, Zap, Flame, Crown];
const BADGE_COLORS = [
  'from-blue-600 to-indigo-800',
  'from-emerald-600 to-teal-800',
  'from-amber-500 to-orange-600',
  'from-amber-400 via-amber-500 to-yellow-600',
];

export const MilestoneLadder: React.FC<MilestoneLadderProps> = ({
  currentClass,
  achievementPct,
  sales,
  plan,
  onSimulateTarget,
}) => {
  // One step for each qualifying class of the plan (limits, rates and names all come from the cycle)
  const tiers = classSteps(plan).map((s, i) => ({
    name: `Class ${s.name}`,
    code: s.name,
    minPct: s.abovePct,
    reward: Number(s.ratePct),
    minSales: s.minSales, // more than the limit: the first rupee that reaches the class
    desc: s.isFirst
      ? 'Base Qualification Threshold'
      : s.isTop
      ? 'Elite Pinnacle Jackpot'
      : s.abovePct === 100
      ? '100% Target Met'
      : 'High Performer Multiplier',
    icon: ICONS[Math.min(i, ICONS.length - 1)],
    badgeColor: BADGE_COLORS[Math.min(i, BADGE_COLORS.length - 1)],
  }));
  const topTier = tiers[tiers.length - 1];

  const currentRankIndex = classRank(plan, currentClass);

  // Find next tier
  const nextTier = tiers.find((t) => classRank(plan, t.code) > currentRankIndex);
  const remainingSalesToNext = nextTier ? Math.max(0, nextTier.minSales - sales) : 0;

  // Overall journey progress (scale 0 to the top class limit)
  const overallTrackPct = Math.min(
    100,
    Math.max(0, (achievementPct / (topTier?.minPct || 100)) * 100)
  );

  return (
    <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7 border border-amber-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
      {/* Dynamic Ambient Background Lights */}
      <div className="absolute -top-32 -right-32 w-80 h-80 bg-amber-500/15 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-indigo-500/15 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-48 bg-amber-400/5 rounded-full blur-[90px] pointer-events-none" />

      {/* Header with Title and Celebration button */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </span>
            <span className="text-xs uppercase tracking-widest font-black text-amber-400 font-mono flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-400 animate-subtle-sparkle" />
              Incentive Class Progression Highway
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-xs text-slate-300 font-mono bg-white/10 px-2.5 py-0.5 rounded-full border border-white/10">
              Current: <strong className="text-amber-400 font-bold">Class {currentClass}</strong> ({formatNumberINR(achievementPct, 1)}%)
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-200">
            {nextTier ? (
              <span>
                Need <strong className="text-amber-400 font-mono">{formatCurrencyINR(remainingSalesToNext)}</strong> more revenue to reach{' '}
                <strong className="text-white underline decoration-amber-400/60 underline-offset-4">{nextTier.name}</strong> ({nextTier.reward}% payout rate)!
              </span>
            ) : (
              <span className="text-amber-300 flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-400" />
                Pinnacle Achieved! You have unlocked top-tier {topTier?.name ?? 'class'} commissions!
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => {
            soundFx.playLevelUp();
            fireGoldenCelebration();
          }}
          className="group relative inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-[0_0_25px_rgba(245,158,11,0.35)] active:scale-95 transition-all overflow-hidden shrink-0"
        >
          {/* Shimmer sweep */}
          <div className="absolute inset-0 w-1/2 h-full bg-white/30 transform -skew-x-12 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000" />
          <Sparkles className="w-4 h-4 text-slate-950 animate-subtle-sparkle" />
          Celebrate Milestone
        </button>
      </div>

      {/* Connected Neon Milestone Highway Bar */}
      <div className="relative z-10 mb-7 hidden sm:block">
        <div className="h-2.5 w-full bg-slate-800/80 rounded-full overflow-hidden p-0.5 border border-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 via-amber-400 to-yellow-300 shadow-[0_0_15px_rgba(251,191,36,0.9)] transition-all duration-700 ease-out"
            style={{ width: `${overallTrackPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-2 px-1">
          <span>0% Start</span>
          {tiers.map((t, i) => (
            <span
              key={t.code}
              className={achievementPct >= t.minPct ? 'text-amber-400 font-bold' : ''}
            >
              {i === tiers.length - 1
                ? `${t.minPct}%+ (${t.name} Pinnacle)`
                : `${t.minPct}% (${t.name})`}
            </span>
          ))}
        </div>
      </div>

      {/* Visual Progression Nodes */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        {tiers.map((tier) => {
          const tierIndex = classRank(plan, tier.code);
          const isUnlocked = currentRankIndex >= tierIndex;
          const isCurrent = currentClass === tier.code;
          const TierIcon = tier.icon;

          return (
            <div
              key={tier.code}
              onClick={() => {
                soundFx.playPop();
                if (onSimulateTarget) {
                  onSimulateTarget(tier.minSales);
                }
              }}
              className={`group relative p-4 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden ${
                isCurrent
                  ? 'bg-gradient-to-b from-amber-500/20 to-amber-950/40 border-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.3)] ring-1 ring-amber-400/50 scale-[1.02]'
                  : isUnlocked
                  ? 'bg-gradient-to-b from-emerald-950/40 to-slate-900/60 border-emerald-500/40 hover:border-emerald-400/80 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]'
                  : 'bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]'
              }`}
            >
              {/* Subtle metallic sheen glint */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/10 to-transparent rounded-full blur-xl pointer-events-none" />

              {/* Badge Top */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shadow-xs ${
                      isCurrent
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : isUnlocked
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/10 text-slate-400'
                    }`}
                  >
                    <TierIcon className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-200">
                    {tier.minPct}% Target
                  </span>
                </div>

                {isCurrent ? (
                  <span className="text-[10px] font-extrabold font-mono px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 flex items-center gap-1 shadow-[0_0_12px_rgba(251,191,36,0.6)]">
                    ACTIVE
                  </span>
                ) : isUnlocked ? (
                  <span className="text-[10px] font-bold font-mono text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> UNLOCKED
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    LOCKED
                  </span>
                )}
              </div>

              {/* Class Title & Rate */}
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-lg font-black tracking-tight text-white group-hover:text-amber-200 transition">
                  {tier.name}
                </span>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-white/10 text-amber-300 border border-amber-400/20">
                  {tier.reward}% Rate
                </span>
              </div>

              <div className="text-xs text-slate-300 font-mono mb-2">
                Min: {formatCurrencyINR(tier.minSales)}
              </div>

              <p className="text-[11px] text-slate-400 leading-snug line-clamp-1 mb-3">
                {tier.desc}
              </p>

              {/* Action Hint */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-amber-400/90 group-hover:text-amber-300 font-semibold transition">
                <span>Simulate Target</span>
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
