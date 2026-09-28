import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../shared/firebase-client';
import { LeaderboardRecord, LeaderboardRow } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import { Trophy, Medal, Award, MapPin, RefreshCw, Calendar, TrendingUp, Sparkles, Search, Crown } from 'lucide-react';
import { soundFx } from '../utils/audio';
import { fireGoldenCelebration, fireMilestoneBurst } from '../utils/confetti';
import { AnimatedCounter } from './AnimatedCounter';

interface LeaderboardsProps {
  userRole: 'superAdmin' | 'manager' | 'tl';
  userLocation?: string;
  activeCycleId: string;
}

const ALL_LOCATIONS = ['Dighe', 'Andheri', 'Bangalore'];

export function Leaderboards({ userRole, userLocation, activeCycleId }: LeaderboardsProps) {
  const allowedLocations =
    userRole === 'tl' && userLocation
      ? [userLocation]
      : ALL_LOCATIONS;

  const [activeLocation, setActiveLocation] = useState<string>(
    allowedLocations[0] || 'Dighe'
  );
  const [currentBoard, setCurrentBoard] = useState<LeaderboardRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchBoard = async (loc: string) => {
    setLoading(true);
    setError(null);
    try {
      const docRef = doc(db, 'cycles', activeCycleId, 'leaderboards', loc);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setCurrentBoard(snap.data() as LeaderboardRecord);
      } else {
        setCurrentBoard({
          location: loc,
          updatedAt: new Date().toISOString(),
          rows: [],
        });
      }
    } catch (err: any) {
      console.error(`Error loading leaderboard for ${loc}:`, err);
      setError(err?.message || `Failed to load ${loc} leaderboard`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBoard(activeLocation);
  }, [activeLocation, activeCycleId]);

  const rows = currentBoard?.rows || [];
  const top1 = rows.find((r) => r.rank === 1);
  const top2 = rows.find((r) => r.rank === 2);
  const top3 = rows.find((r) => r.rank === 3);

  const filteredRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.name.toLowerCase().includes(term) ||
      r.officialEmail.toLowerCase().includes(term) ||
      r.className.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header with Title & Location Tabs */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-5 h-5 text-amber-500 animate-subtle-sparkle" />
            <h1 className="text-xl font-bold text-slate-950 dark:text-white tracking-tight">
              Diwali Sales Leaderboards
            </h1>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              · Branch Rankings
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time branch rankings, revenue delivery, and incentive standings.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {allowedLocations.length > 1 && (
            <div className="bg-slate-100 dark:bg-slate-850 p-1 rounded-xl flex items-center border border-slate-200/60 dark:border-slate-800 shadow-xs">
              {allowedLocations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => {
                    soundFx.playPop();
                    setActiveLocation(loc);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeLocation === loc
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              soundFx.playPop();
              fetchBoard(activeLocation);
            }}
            disabled={loading}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-xs"
            title="Refresh Leaderboard"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top 3 Podium Showcase (if at least 1 agent exists) */}
      {rows.length > 0 && (
        <div className="relative overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 border border-amber-500/20 rounded-2xl p-6 shadow-xl text-white">
          <div className="absolute top-0 right-1/4 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-center justify-between mb-6 relative z-10">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 animate-subtle-sparkle" />
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
                {activeLocation} Podium Showcase
              </span>
            </div>
            <button
              onClick={() => {
                fireGoldenCelebration();
              }}
              className="text-xs font-bold font-mono text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 px-3 py-1 rounded-lg transition"
            >
              🎉 Cheer Top Performers
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end relative z-10 pt-4">
            {/* Rank 2 (Silver) */}
            {top2 ? (
              <div className="order-2 md:order-1 bg-white/5 border border-white/10 rounded-xl p-4 text-center backdrop-blur-sm relative hover:border-slate-300 transition">
                <div className="w-10 h-10 rounded-full bg-slate-300 text-slate-900 font-extrabold text-sm flex items-center justify-center mx-auto mb-2 shadow-md font-mono">
                  2
                </div>
                <div className="font-bold text-sm text-white truncate">{top2.name}</div>
                <div className="text-[11px] text-slate-400 font-mono mb-2">Class {top2.className} · {formatNumberINR(top2.achievementPct, 1)}%</div>
                <div className="text-xs text-slate-300 font-mono">Sales: {formatCurrencyINR(top2.sales)}</div>
                <div className="text-base font-extrabold text-amber-300 font-mono mt-1">
                  <AnimatedCounter value={top2.totalIncentive} />
                </div>
              </div>
            ) : <div className="order-2 md:order-1" />}

            {/* Rank 1 (Gold - Elevated Champion) */}
            {top1 ? (
              <div
                onClick={() => {
                  soundFx.playLevelUp();
                  fireMilestoneBurst(0.5, 0.35);
                }}
                className="group order-1 md:order-2 bg-gradient-to-b from-amber-500/25 via-amber-950/50 to-slate-950 border-2 border-amber-400 rounded-3xl p-5 sm:p-6 text-center shadow-[0_0_40px_rgba(245,158,11,0.35)] relative -translate-y-3 cursor-pointer transition-all duration-300 hover:scale-[1.03] overflow-hidden"
              >
                {/* Shimmer sweep */}
                <div className="absolute inset-0 w-1/2 h-full bg-white/20 transform -skew-x-12 -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 pointer-events-none" />

                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-950 px-3 py-0.5 rounded-full text-[10px] font-black font-mono tracking-wider flex items-center gap-1.5 shadow-[0_0_15px_rgba(251,191,36,0.8)] border border-amber-200">
                  <Crown className="w-3.5 h-3.5 text-slate-950" />
                  CHAMPION
                </div>
                <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-amber-400 to-yellow-300 text-slate-950 font-black text-lg flex items-center justify-center mx-auto mb-2.5 shadow-[0_0_20px_rgba(245,158,11,0.6)] font-mono border-2 border-white/60">
                  1
                </div>
                <div className="font-black text-base text-white tracking-tight truncate drop-shadow-sm">{top1.name}</div>
                <div className="text-xs text-amber-300 font-mono font-bold mb-2">Class {top1.className} · {formatNumberINR(top1.achievementPct, 1)}%</div>
                <div className="text-xs text-slate-300 font-mono">Revenue: {formatCurrencyINR(top1.sales)}</div>
                <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-yellow-100 font-mono mt-2 tracking-tight">
                  <AnimatedCounter value={top1.totalIncentive} />
                </div>
                <div className="mt-2 text-[10px] font-mono text-amber-400/80 uppercase tracking-widest font-bold">
                  Click to Celebrate 🎉
                </div>
              </div>
            ) : <div className="order-1 md:order-2" />}

            {/* Rank 3 (Bronze) */}
            {top3 ? (
              <div className="order-3 bg-white/5 border border-white/10 rounded-xl p-4 text-center backdrop-blur-sm relative hover:border-amber-700/60 transition">
                <div className="w-10 h-10 rounded-full bg-amber-700 text-white font-extrabold text-sm flex items-center justify-center mx-auto mb-2 shadow-md font-mono">
                  3
                </div>
                <div className="font-bold text-sm text-white truncate">{top3.name}</div>
                <div className="text-[11px] text-slate-400 font-mono mb-2">Class {top3.className} · {formatNumberINR(top3.achievementPct, 1)}%</div>
                <div className="text-xs text-slate-300 font-mono">Sales: {formatCurrencyINR(top3.sales)}</div>
                <div className="text-base font-extrabold text-amber-300 font-mono mt-1">
                  <AnimatedCounter value={top3.totalIncentive} />
                </div>
              </div>
            ) : <div className="order-3" />}
          </div>
        </div>
      )}

      {/* Leaderboard Table Card */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-slate-900 dark:text-white">{activeLocation} Complete Rankings</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">({filteredRows.length} callers)</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search caller..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 w-48 sm:w-56 font-sans"
              />
            </div>

            <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono hidden md:block">
              {currentBoard?.updatedAt ? (
                <span>
                  Updated{' '}
                  {new Date(currentBoard.updatedAt).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  IST
                </span>
              ) : (
                'Not updated yet'
              )}
            </div>
          </div>
        </div>

        {loading && !currentBoard ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500 mb-2" />
            Loading rankings for {activeLocation}...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-600 dark:text-rose-400">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            {searchTerm ? `No callers match "${searchTerm}" in ${activeLocation}.` : `No caller rankings recorded for ${activeLocation} yet.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider font-mono">
                <tr>
                  <th className="py-3 px-4 w-16 text-center">Rank</th>
                  <th className="py-3 px-4">Caller</th>
                  <th className="py-3 px-4 text-right">Revenue</th>
                  <th className="py-3 px-4 text-right">Target %</th>
                  <th className="py-3 px-4 text-center">Class</th>
                  <th className="py-3 px-4 text-right">Total Incentive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.map((row: LeaderboardRow) => {
                  const isTop1 = row.rank === 1;
                  const isTop2 = row.rank === 2;
                  const isTop3 = row.rank === 3;

                  return (
                    <tr
                      key={row.officialEmail}
                      onClick={() => {
                        if (isTop1) {
                          fireMilestoneBurst();
                        } else {
                          soundFx.playPop();
                        }
                      }}
                      className={`transition cursor-pointer ${
                        isTop1
                          ? 'bg-amber-500/10 dark:bg-amber-500/15 hover:bg-amber-500/20'
                          : isTop2
                          ? 'bg-slate-50/60 dark:bg-slate-850 hover:bg-slate-100/60 dark:hover:bg-slate-800'
                          : isTop3
                          ? 'bg-amber-700/5 dark:bg-amber-950/30 hover:bg-amber-700/15'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-850'
                      }`}
                    >
                      <td className="py-3 px-4 text-center">
                        {isTop1 ? (
                          <div className="w-6 h-6 rounded-md bg-amber-500 text-slate-950 font-extrabold text-xs flex items-center justify-center mx-auto shadow-xs font-mono">
                            1
                          </div>
                        ) : isTop2 ? (
                          <div className="w-6 h-6 rounded-md bg-slate-300 text-slate-900 font-extrabold text-xs flex items-center justify-center mx-auto shadow-xs font-mono">
                            2
                          </div>
                        ) : isTop3 ? (
                          <div className="w-6 h-6 rounded-md bg-amber-700 text-white font-extrabold text-xs flex items-center justify-center mx-auto shadow-xs font-mono">
                            3
                          </div>
                        ) : (
                          <span className="font-mono text-xs font-semibold text-slate-400 dark:text-slate-500">#{row.rank}</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-950 dark:text-white flex items-center gap-2">
                          {row.name}
                          {isTop1 && (
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 font-mono flex items-center gap-1">
                              <Trophy className="w-3 h-3 text-amber-500" />
                              Top Performer
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                          {row.officialEmail}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 dark:text-slate-200 tabular-nums">
                        {formatCurrencyINR(row.sales)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                        {formatNumberINR(row.achievementPct, 1)}%
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`font-mono text-xs font-bold ${
                            row.className === 'NQ'
                              ? 'text-slate-400 dark:text-slate-500'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {row.className}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-950 dark:text-white text-sm tabular-nums">
                        <AnimatedCounter value={row.totalIncentive} />
                      </td>
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
