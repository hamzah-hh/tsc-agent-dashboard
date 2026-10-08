import React, { useState, useEffect } from 'react';
import { AgentRecord, AgentType } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import { StaleBanner } from './StaleBanner';
import {
  Users,
  Search,
  ArrowUpDown,
  MapPin,
  TrendingUp,
  Award,
  ExternalLink,
  ChevronRight,
  Filter,
  PhoneIncoming,
  Sparkles,
} from 'lucide-react';

interface TeamViewProps {
  userRole: 'superAdmin' | 'manager' | 'tl';
  userEmail: string;
  activeCycleId: string;
  testMode?: boolean;
  getIdToken?: () => Promise<string>;
  onOpenAgent: (officialEmail: string) => void;
}

type SortField =
  | 'name'
  | 'sales'
  | 'achievementPct'
  | 'className'
  | 'qualityScore'
  | 'avgConnects'
  | 'avgTalkMinutes'
  | 'visitsAttributed'
  | 'totalIncentive';

const classNames = ['NQ', 'A', 'B', 'C', 'D'];
const revenueLocations = ['Dighe', 'Andheri', 'Bangalore'];

/** Connects per day for HO / Store agents; inbound calls per day for Pre Sales agents. */
function connectsPerDay(a: AgentRecord): number {
  const days = a.totals?.activeDays || 0;
  if (!days) return 0;
  return (a.agentType === 'PRE_SALES' ? a.totals.calls ?? 0 : a.totals.connects) / days;
}

/** Talk time per day in minutes (HO / Store); Pre Sales average seconds per call converted to minutes for sorting. */
function talkMinutesForSort(a: AgentRecord): number {
  if (a.agentType === 'PRE_SALES') return (a.result?.preSales?.talk.value ?? 0) / 60;
  const days = a.totals?.activeDays || 0;
  return days ? a.totals.talkSeconds / 60 / days : 0;
}

export function TeamView({
  userRole,
  userEmail,
  activeCycleId,
  testMode = false,
  getIdToken,
  onOpenAgent,
}: TeamViewProps) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & sort states
  const [locationFilter, setLocationFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<'All' | AgentType>('All');
  const [search, setSearch] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('sales');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const fetchTeamAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!getIdToken) {
        throw new Error('Authentication session not ready');
      }
      const token = await getIdToken();
      const res = await fetch(`/api/team-agents?cycleId=${encodeURIComponent(activeCycleId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    } catch (err: any) {
      console.error('Error fetching team agents:', err);
      setError(err?.message || 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamAgents();
  }, [userEmail, userRole, activeCycleId]);

  // Demo (isTest) agents: everyone sees them while test mode is on. Once the app is live, only the
  // Super Admin sees them in the table, and they never count in the summary cards.
  const visibleAgents = agents.filter((a) => !a.isTest || testMode || userRole === 'superAdmin');
  const countsInStats = (a: AgentRecord) => !a.isTest || testMode;

  // Filter agents by location (for manager / superAdmin), agent type and search
  const filteredAgents = visibleAgents.filter((a) => {
    if (locationFilter !== 'All') {
      const aLoc = (a.location || '').trim().toLowerCase();
      const fLoc = locationFilter.trim().toLowerCase();
      if (fLoc === 'dighe (pre sales)') {
        if (aLoc !== 'dighe (pre sales)' && !(aLoc === 'dighe' && a.agentType === 'PRE_SALES')) {
          return false;
        }
      } else if (fLoc === 'dighe') {
        if (aLoc !== 'dighe' && aLoc !== 'dighe (pre sales)') {
          return false;
        }
      } else if (aLoc !== fLoc) {
        return false;
      }
    }
    if (typeFilter !== 'All' && a.agentType !== typeFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (a.name || '').toLowerCase().includes(q);
      const matchEmail = (a.officialEmail || '').toLowerCase().includes(q);
      const matchLoc = (a.location || '').toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchLoc) return false;
    }
    return true;
  });

  // Sort agents
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    let valA: any = 0;
    let valB: any = 0;

    switch (sortField) {
      case 'name':
        valA = a.name || '';
        valB = b.name || '';
        return sortAsc
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      case 'sales':
        valA = a.totals?.sales || 0;
        valB = b.totals?.sales || 0;
        break;
      case 'achievementPct':
        valA = a.result?.achievementPct || 0;
        valB = b.result?.achievementPct || 0;
        break;
      case 'className':
        valA = a.result?.className || 'NQ';
        valB = b.result?.className || 'NQ';
        return sortAsc
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      case 'qualityScore':
        valA = a.quality?.audits ? a.quality.score : -1;
        valB = b.quality?.audits ? b.quality.score : -1;
        break;
      case 'avgConnects':
        valA = connectsPerDay(a);
        valB = connectsPerDay(b);
        break;
      case 'avgTalkMinutes':
        valA = talkMinutesForSort(a);
        valB = talkMinutesForSort(b);
        break;
      case 'visitsAttributed':
        valA = a.totals?.visitsAttributed || 0;
        valB = b.totals?.visitsAttributed || 0;
        break;
      case 'totalIncentive':
        valA = a.result?.total || 0;
        valB = b.result?.total || 0;
        break;
    }

    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // 1. Summary Cards calculation. Demo agents do not count once the app is live, and Pre Sales agents
  // (no revenue, no achievement %) are left out of Total Revenue, Avg Achievement and the class counts.
  const statAgents = filteredAgents.filter(countsInStats);
  // Latest data date of the agents that count (demo agents do not decide whether real data is stale)
  const latestDataDate = agents
    .filter(countsInStats)
    .map((a) => a.lastDataDate || '')
    .filter(Boolean)
    .sort()
    .pop();
  const revenueAgents = statAgents.filter((a) => a.agentType !== 'PRE_SALES');
  const preSalesCount = statAgents.length - revenueAgents.length;
  const totalAgentsCount = statAgents.length;
  const totalRevenue = revenueAgents.reduce(
    (acc, a) => acc + (a.totals?.sales || 0),
    0
  );
  const branchTarget = 9000000;
  const activeBranchesCount =
    locationFilter !== 'All'
      ? 1
      : userRole === 'tl'
      ? 1
      : revenueLocations.filter((loc) => revenueAgents.some((a) => a.location === loc)).length || 3;
  const effectiveTarget = branchTarget * activeBranchesCount;
  const targetAchievement =
    effectiveTarget > 0 ? (totalRevenue / effectiveTarget) * 100 : 0;
  const averageAgentAchievement = revenueAgents.length > 0
    ? revenueAgents.reduce((acc, a) => acc + (a.result?.achievementPct || 0), 0) / revenueAgents.length
    : 0;

  const totalIncentive = statAgents.reduce(
    (acc, a) => acc + (a.result?.total || 0),
    0
  );

  // 2. Class & Tier Distribution
  const preSalesAgents = agents.filter(
    (a) =>
      (a.location.toLowerCase().includes('pre sales') || a.agentType === 'PRE_SALES') &&
      countsInStats(a)
  );

  const getClassCounts = (agentList: AgentRecord[]) => {
    const counts: Record<string, number> = { NQ: 0, A: 0, B: 0, C: 0, D: 0 };
    agentList.forEach((a) => {
      const c = a.result?.className || 'NQ';
      if (counts[c] !== undefined) counts[c]++;
    });
    return counts;
  };

  const overallClassCounts = getClassCounts(revenueAgents);

  return (
    <div className="space-y-6">
      {!loading && !error && <StaleBanner date={latestDataDate} />}

      {/* 1. Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Agents */}
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 font-mono block mb-1">
            Total Agents
          </span>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono">
            {formatNumberINR(totalAgentsCount)}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            {locationFilter === 'All' ? 'Across active team' : `${locationFilter} branch`}
          </p>
        </div>

        {/* Card 2: Total Revenue */}
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 font-mono block mb-1">
            Total Revenue
          </span>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono">
            {formatCurrencyINR(totalRevenue)}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Sum of team sales</p>
        </div>

        {/* Card 3: Average Achievement % */}
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 font-mono block mb-1">
            Average Achievement %
          </span>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono">
            {formatNumberINR(averageAgentAchievement, 1)}%
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Average of each agent's individual target %
          </p>
        </div>

        {/* Card 4: Total Incentive */}
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs">
          <span className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 font-mono block mb-1">
            Total Incentive
          </span>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 font-mono">
            {formatCurrencyINR(totalIncentive)}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Combined payout to date</p>
        </div>
      </div>

      {/* 2. Class Distribution Card */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 font-mono mb-4">
          Class Distribution (NQ, A, B, C, D)
        </h3>

        {/* Overall or TL view */}
        <div className="space-y-4">
          {userRole !== 'tl' ? (
            // For manager and superAdmin, one row for each location plus overall
            <div className="space-y-4">
              {/* Overall Row */}
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5 font-mono">
                  <span>
                    All Locations ({revenueAgents.length} agents
                    {preSalesCount > 0 ? ` + ${preSalesCount} Pre Sales, not classed` : ''})
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {classNames.map((c) => (
                    <div
                      key={c}
                      className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-center"
                    >
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-mono block">Class {c}</span>
                      <strong className="text-base font-extrabold text-slate-900 dark:text-white font-mono">
                        {overallClassCounts[c]}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per Location Rows */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4">
                <div>
                  <span className="text-[11px] uppercase font-bold text-slate-400 dark:text-slate-500 font-mono block mb-2">
                    Revenue Branch Distribution (Dighe, Andheri, Bangalore)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {revenueLocations.map((loc) => {
                      const locAgents = agents.filter(
                        (a) => a.location === loc && a.agentType !== 'PRE_SALES' && countsInStats(a)
                      );
                      const counts = getClassCounts(locAgents);
                      return (
                        <div
                          key={loc}
                          className="bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3"
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                              {loc}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 font-medium font-mono">
                              {locAgents.length} agents
                            </span>
                          </div>
                          <div className="grid grid-cols-5 gap-1 text-center">
                            {classNames.map((c) => (
                              <div key={c} className="bg-white dark:bg-slate-900 rounded-md p-1 border border-slate-200 dark:border-slate-800">
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 block font-mono">{c}</span>
                                <strong className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                                  {counts[c]}
                                </strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Dedicated Pre Sales Performance Section */}
                {preSalesAgents.length > 0 && (
                  <div className="bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                          <PhoneIncoming className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Dighe (Pre Sales) · Inbound Volume &amp; Quality Tiers</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                          Pre Sales callers qualify via Call Volume &amp; Talk Time Tiers with an 85% Quality Score Gate (no revenue classes).
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {preSalesAgents.length} Callers
                        </span>
                        <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {preSalesAgents.filter((a) => a.result?.preSales?.eligible).length} / {preSalesAgents.length} Gate Qualified (≥85%)
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Calls Tiers */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 font-mono block mb-2">
                          Daily Inbound Calls Tiers (Target: 101+ / 116+ / 131+)
                        </span>
                        <div className="grid grid-cols-4 gap-1.5 text-center">
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-slate-400 block font-mono">Below</span>
                            <span className="text-[9px] text-slate-400 font-sans">&le;100</span>
                            <strong className="text-xs font-bold text-slate-700 dark:text-slate-300 block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.calls.tier ?? 0) === 0).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 block font-mono font-bold">Tier 1 (₹500)</span>
                            <span className="text-[9px] text-slate-400 font-sans">101-115</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.calls.tier ?? 0) === 1).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 block font-mono font-bold">Tier 2 (₹1k)</span>
                            <span className="text-[9px] text-slate-400 font-sans">116-130</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.calls.tier ?? 0) === 2).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 block font-mono font-bold">Tier 3 (₹2k)</span>
                            <span className="text-[9px] text-slate-400 font-sans">131+</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.calls.tier ?? 0) >= 3).length}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Talk Time Tiers */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg p-3">
                        <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 font-mono block mb-2">
                          Daily Talk Time Tiers (Target: 166s+ / 181s+ / 211s+)
                        </span>
                        <div className="grid grid-cols-4 gap-1.5 text-center">
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-slate-400 block font-mono">Below</span>
                            <span className="text-[9px] text-slate-400 font-sans">&le;165s</span>
                            <strong className="text-xs font-bold text-slate-700 dark:text-slate-300 block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.talk.tier ?? 0) === 0).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 block font-mono font-bold">Tier 1 (₹500)</span>
                            <span className="text-[9px] text-slate-400 font-sans">166-180s</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.talk.tier ?? 0) === 1).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-amber-600 dark:text-amber-400 block font-mono font-bold">Tier 2 (₹1k)</span>
                            <span className="text-[9px] text-slate-400 font-sans">181-210s</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.talk.tier ?? 0) === 2).length}
                            </strong>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-950 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 block font-mono font-bold">Tier 3 (₹2k)</span>
                            <span className="text-[9px] text-slate-400 font-sans">211s+</span>
                            <strong className="text-xs font-bold text-slate-900 dark:text-white block font-mono mt-0.5">
                              {preSalesAgents.filter((a) => (a.result?.preSales?.talk.tier ?? 0) >= 3).length}
                            </strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // TL view: single row
            <div className="grid grid-cols-5 gap-2">
              {classNames.map((c) => (
                <div
                  key={c}
                  className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-center"
                >
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono block">Class {c}</span>
                  <strong className="text-lg font-extrabold text-slate-900 dark:text-white font-mono">
                    {overallClassCounts[c]}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Agent Table Card */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {/* Controls Bar: Location Filter & Search */}
        <div className="p-4 border-b border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Location filter for manager & superAdmin */}
            {userRole !== 'tl' && (
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="text-xs font-semibold border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="All">All Locations</option>
                  <option value="Dighe (Pre Sales)">Dighe (Pre Sales)</option>
                  <option value="Dighe">Dighe</option>
                  <option value="Andheri">Andheri</option>
                  <option value="Bangalore">Bangalore</option>
                </select>
              </div>
            )}

            {/* Agent type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'All' | AgentType)}
              className="text-xs font-semibold border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="All">All Types</option>
              <option value="HO">HO Callers</option>
              <option value="STORE">Store Callers</option>
              <option value="PRE_SALES">Pre Sales</option>
            </select>

            {/* Search input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agent name or email..."
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono shrink-0">
            Showing <strong className="text-slate-800 dark:text-slate-200">{sortedAgents.length}</strong> of <strong className="text-slate-800 dark:text-slate-200">{visibleAgents.length}</strong> agents
          </span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            Loading team roster...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-600 dark:text-rose-400">{error}</div>
        ) : sortedAgents.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            No agents found matching your filter criteria.
          </div>
        ) : (
          <div>
            {/* Desktop Full Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider select-none font-mono">
                  <tr>
                    <th
                      onClick={() => handleSort('name')}
                      className="py-3 px-4 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center gap-1">
                        Agent Name
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('sales')}
                      className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Revenue
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('achievementPct')}
                      className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Target %
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('className')}
                      className="py-3 px-4 text-center cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Class
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('qualityScore')}
                      className="py-3 px-4 text-center cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Quality
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('avgConnects')}
                      className="py-3 px-4 text-center cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Connects
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('avgTalkMinutes')}
                      className="py-3 px-4 text-center cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Talk Time
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('visitsAttributed')}
                      className="py-3 px-4 text-center cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Visits
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort('totalIncentive')}
                      className="py-3 px-4 text-right cursor-pointer hover:text-slate-900 dark:hover:text-white"
                    >
                      <div className="flex items-center justify-end gap-1">
                        Total Incentive
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedAgents.map((agent) => {
                    const res = agent.result;
                    const tot = agent.totals;
                    const actDays = tot?.activeDays || 0;
                    const avgConn = actDays > 0 ? Math.round(tot.connects / actDays) : 0;
                    const avgTalk = actDays > 0 ? Math.round(tot.talkSeconds / 60 / actDays) : 0;
                    const isPS = agent.agentType === 'PRE_SALES';
                    const ps = res?.preSales;

                    return (
                      <tr
                        key={agent.officialEmail}
                        onClick={() => onOpenAgent(agent.officialEmail)}
                        className="hover:bg-amber-500/5 dark:hover:bg-slate-800/60 transition cursor-pointer group"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition flex items-center gap-1.5">
                            {agent.name}
                            {isPS && (
                              <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-bold">
                                · Pre Sales
                              </span>
                            )}
                            {agent.isTest && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono font-bold">
                                · Demo
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                            {agent.location} · {agent.officialEmail}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 dark:text-slate-200 tabular-nums">
                          {isPS ? '—' : formatCurrencyINR(tot?.sales || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-950 dark:text-white tabular-nums">
                          {isPS ? '—' : `${formatNumberINR(res?.achievementPct || 0, 1)}%`}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isPS ? (
                            <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">PS</span>
                          ) : (
                            <span
                              className={`font-mono text-xs font-bold ${
                                res?.className === 'NQ'
                                  ? 'text-slate-400 dark:text-slate-600'
                                  : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {res?.className || 'NQ'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-200">
                            {agent.quality?.audits ? `${agent.quality.score}%` : '—'}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-mono">
                            {isPS ? (ps?.eligible ? 'Gate met' : 'Locked') : res?.quality?.band || 'None'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-200">
                            {isPS ? ps?.calls.value ?? 0 : avgConn}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-mono">
                            {isPS ? `calls/day · T${ps?.calls.tier ?? 0}` : res?.connects?.band || 'None'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-200">
                            {isPS ? `${ps?.talk.value ?? 0}s` : `${avgTalk}m`}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-mono">
                            {isPS ? `T${ps?.talk.tier ?? 0}` : res?.talk?.band || 'None'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-200">
                            {isPS ? '—' : tot?.visitsAttributed || 0}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-mono">
                            {isPS ? '' : `T${res?.rider?.tier || 0}`}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-950 dark:text-white text-sm tabular-nums">
                          {formatCurrencyINR(res?.total || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile View: On a phone, show only name, achievementPct, class, and Total Incentive; a tap opens the agent. */}
            <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {sortedAgents.map((agent) => (
                <div
                  key={agent.officialEmail}
                  onClick={() => onOpenAgent(agent.officialEmail)}
                  className="p-4 active:bg-amber-500/10 dark:active:bg-slate-850 flex items-center justify-between cursor-pointer"
                >
                  <div className="flex-1 pr-3">
                    <div className="font-bold text-sm text-slate-900 dark:text-white mb-0.5">
                      {agent.name}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {agent.agentType === 'PRE_SALES' ? (
                        <>
                          <span className="text-slate-500 dark:text-slate-400 font-medium font-mono">
                            Pre Sales · {agent.result?.preSales?.calls.value ?? 0} calls/day
                          </span>
                          <span
                            className={`px-2 py-0.2 rounded-full text-[10px] font-bold font-mono ${
                              agent.result?.preSales?.eligible
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {agent.result?.preSales?.eligible ? 'Gate met' : 'Locked'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-slate-500 dark:text-slate-400 font-medium font-mono">
                            {formatNumberINR(agent.result?.achievementPct || 0, 1)}% target
                          </span>
                          <span
                            className={`px-2 py-0.2 rounded-full text-[10px] font-bold font-mono ${
                              agent.result?.className === 'NQ'
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            Class {agent.result?.className || 'NQ'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className="text-xs uppercase font-bold text-slate-400 dark:text-slate-500 text-[10px] font-mono">
                        Incentive
                      </div>
                      <div className="font-extrabold text-slate-900 dark:text-white text-sm font-mono">
                        {formatCurrencyINR(agent.result?.total || 0)}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
