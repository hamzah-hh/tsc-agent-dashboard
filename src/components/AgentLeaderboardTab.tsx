import React, { useState, useEffect } from 'react';
import { AgentLeaderboardRow, LocationRevenueData } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  Trophy,
  Crown,
  Search,
  RotateCcw,
  MapPin,
  CheckCircle,
  EyeOff,
  Briefcase,
  Users,
  Headphones,
  PhoneCall,
  Clock,
  ShieldCheck,
  TrendingUp,
  ShoppingBag,
  Smartphone,
  Layers,
  Store,
  ChevronDown,
  ChevronUp,
  Building2,
} from 'lucide-react';
import { soundFx } from '../utils/audio';

interface AgentLeaderboardTabProps {
  getIdToken: () => Promise<string>;
  currentAgentEmail: string;
  currentLocation: string;
  currentAgentType: string;
}

export function AgentLeaderboardTab({
  getIdToken,
  currentAgentEmail,
  currentLocation,
  currentAgentType,
}: AgentLeaderboardTabProps) {
  // Normalize agent category
  const normalizedCategory: 'ho' | 'store' | 'preSales' =
    currentAgentType === 'PRE_SALES' || currentLocation.toLowerCase().includes('pre sales')
      ? 'preSales'
      : currentAgentType === 'STORE' ||
        currentLocation.toLowerCase().includes('andheri') ||
        currentLocation.toLowerCase().includes('bangalore')
      ? 'store'
      : 'ho';

  const [activeTab, setActiveTab] = useState<'ho' | 'store' | 'preSales'>(normalizedCategory);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [locationRevenue, setLocationRevenue] = useState<LocationRevenueData | null>(null);
  const [showFullStructure, setShowFullStructure] = useState(false);
  const [data, setData] = useState<{
    ho: AgentLeaderboardRow[];
    store: AgentLeaderboardRow[];
    preSales: AgentLeaderboardRow[];
    allowedCategory?: 'HO' | 'STORE' | 'PRE_SALES' | 'ALL';
    userRole?: string;
  }>({
    ho: [],
    store: [],
    preSales: [],
    allowedCategory: undefined,
  });

  const fetchLeaderboards = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const [res, locRes] = await Promise.all([
        fetch('/api/agent-leaderboard', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`/api/location-revenue?location=${encodeURIComponent(currentLocation)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const allowed = json.allowedCategory as 'HO' | 'STORE' | 'PRE_SALES' | 'ALL' | undefined;

      setData({
        ho: json.ho || [],
        store: json.store || [],
        preSales: json.preSales || [],
        allowedCategory: allowed,
        userRole: json.userRole,
      });

      if (locRes.ok) {
        const locJson = await locRes.json().catch(() => ({}));
        if (locJson.locationRevenue) {
          setLocationRevenue(locJson.locationRevenue);
        }
      }

      // Automatically lock to the allowed category
      if (allowed === 'HO') setActiveTab('ho');
      else if (allowed === 'STORE') setActiveTab('store');
      else if (allowed === 'PRE_SALES') setActiveTab('preSales');
    } catch (err: any) {
      console.error('Failed to load agent leaderboard:', err);
      setError(err?.message || 'Could not load leaderboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLeaderboards();
  }, []);

  const isStaff = data.allowedCategory === 'ALL' || data.userRole === 'superAdmin' || data.userRole === 'manager';

  // Determine which list to render
  const currentList =
    activeTab === 'preSales'
      ? data.preSales
      : activeTab === 'store'
      ? data.store
      : data.ho;

  const filteredList = currentList.filter(
    (row) =>
      row.name.toLowerCase().includes(search.toLowerCase()) ||
      row.location.toLowerCase().includes(search.toLowerCase()) ||
      row.officialEmail.toLowerCase().includes(search.toLowerCase())
  );

  const currentUserRow = currentList.find(
    (r) => r.isCurrentAgent || r.officialEmail.toLowerCase() === currentAgentEmail.toLowerCase()
  );

  const categoryTitle =
    activeTab === 'preSales'
      ? 'Pre Sales Callers'
      : activeTab === 'store'
      ? 'Store Callers'
      : 'HO Callers';

  const categorySubtitle =
    activeTab === 'preSales'
      ? 'Performance standings for all Pre Sales Callers (Dighe). Ranked by overall incentive payout, daily calls, and talk time.'
      : activeTab === 'store'
      ? 'Performance standings for all Store Callers across Andheri and Bangalore. Ranked by overall incentive performance.'
      : 'Performance standings for all Head Office Callers (Dighe). Ranked by overall incentive performance.';

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                <Trophy className="w-3.5 h-3.5" />
                {categoryTitle} Leaderboard
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-slate-400 bg-slate-800 border border-slate-700">
                <EyeOff className="w-3 h-3 text-emerald-400" /> Payout Privacy Protected
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {categoryTitle} Standings
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              {categorySubtitle}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                soundFx.playPop();
                fetchLeaderboards(true);
              }}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
              title="Refresh Leaderboard"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Category Controls & Search */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800">
          {/* If the viewer is Admin/Manager, show tabs to inspect each category.
              If viewer is an Agent, NO tabs are displayed — they are strictly restricted to their own category! */}
          {isStaff ? (
            <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                onClick={() => {
                  soundFx.playPop();
                  setActiveTab('ho');
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'ho'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                HO Callers
                <span
                  className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    activeTab === 'ho' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {data.ho.length}
                </span>
              </button>

              <button
                onClick={() => {
                  soundFx.playPop();
                  setActiveTab('store');
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'store'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Store Callers
                <span
                  className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    activeTab === 'store' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {data.store.length}
                </span>
              </button>

              <button
                onClick={() => {
                  soundFx.playPop();
                  setActiveTab('preSales');
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === 'preSales'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                Pre Sales
                <span
                  className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    activeTab === 'preSales' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {data.preSales.length}
                </span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Showing strictly {categoryTitle} ({currentList.length} callers)
            </div>
          )}

          {/* Search box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${categoryTitle}...`}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Current User Quick-Rank Callout Banner */}
      {currentUserRow && (
        <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent border-2 border-amber-500/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 font-black text-lg flex items-center justify-center font-mono shadow-md shadow-amber-500/20 shrink-0">
              #{currentUserRow.rank}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">Your Standing</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500 text-slate-950">
                  YOU
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {currentUserRow.name} · {currentUserRow.location} ({categoryTitle})
              </p>
            </div>
          </div>

          {activeTab === 'preSales' ? (
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-amber-200">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Worked Days</span>
                <span className="font-mono font-bold text-slate-900">{currentUserRow.activeDays}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Daily Calls</span>
                <span className="font-mono font-bold text-slate-900">{currentUserRow.avgCalls ?? 0}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Daily Talk Time</span>
                <span className="font-mono font-bold text-slate-900">
                  {currentUserRow.avgTalkSeconds ?? 0}s ({Math.floor((currentUserRow.avgTalkSeconds ?? 0) / 60)}m {(currentUserRow.avgTalkSeconds ?? 0) % 60}s)
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Quality</span>
                <span className="font-mono font-bold text-emerald-700">
                  {currentUserRow.qualityScore !== null ? `${currentUserRow.qualityScore}%` : '-'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs border-t sm:border-t-0 pt-2 sm:pt-0 border-amber-200">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Orders</span>
                <span className="font-mono font-bold text-slate-900">{currentUserRow.orders}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Revenue</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrencyINR(currentUserRow.sales)}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Achievement</span>
                <span className="font-mono font-bold text-amber-700">
                  {formatNumberINR(currentUserRow.achievementPct, 1)}%
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 block">Class</span>
                <span className="font-mono font-bold text-indigo-700">Class {currentUserRow.className}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Location Revenue Overview as shown in the sheet */}
      {locationRevenue && activeTab !== 'preSales' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900">
                    Location Revenue — {locationRevenue.location}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    Master Sheet Sync
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Official revenue performance and channel attribution for {locationRevenue.location}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFullStructure(!showFullStructure)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 transition"
              >
                {showFullStructure ? (
                  <>
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                    Hide Structure Table
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                    View Channel Breakdown Table
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Metric KPI Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                Total Revenue
              </span>
              <span className="text-lg font-black text-slate-900 font-mono">
                {formatCurrencyINR(locationRevenue.totalRevenue)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                Total Orders
              </span>
              <span className="text-lg font-black text-slate-900 font-mono">
                {locationRevenue.totalOrders}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-[11px] font-mono font-bold text-slate-500 uppercase block mb-1">
                Location AOV
              </span>
              <span className="text-lg font-black text-slate-900 font-mono">
                {formatCurrencyINR(locationRevenue.aov)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/60">
              <span className="text-[11px] font-mono font-bold text-amber-800 uppercase block mb-1">
                Active Callers
              </span>
              <span className="text-lg font-black text-amber-900 font-mono">
                {locationRevenue.rows.length} Callers
              </span>
            </div>
          </div>

          {/* Channel Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-indigo-700 block">
                  1. Shopify
                </span>
                <span className="text-sm font-black text-slate-900 font-mono block mt-0.5">
                  {formatCurrencyINR(locationRevenue.categories.shopify.sales)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {locationRevenue.categories.shopify.orders} Orders
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4" />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-700 block">
                  2. Alt Number
                </span>
                <span className="text-sm font-black text-slate-900 font-mono block mt-0.5">
                  {formatCurrencyINR(locationRevenue.categories.bfan.sales)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {locationRevenue.categories.bfan.orders} Orders
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Smartphone className="w-4 h-4" />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-purple-50/60 border border-purple-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-purple-700 block">
                  3. Marketplace
                </span>
                <span className="text-sm font-black text-slate-900 font-mono block mt-0.5">
                  {formatCurrencyINR(locationRevenue.categories.bfmp.sales)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {locationRevenue.categories.bfmp.orders} Orders
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-amber-700 block">
                  4. POS OC ALT
                </span>
                <span className="text-sm font-black text-slate-900 font-mono block mt-0.5">
                  {formatCurrencyINR(locationRevenue.categories.posoc.sales)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {locationRevenue.categories.posoc.orders} Orders
                </span>
              </div>
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <Store className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* Expandable Revenue Table Structure */}
          {showFullStructure && (
            <div className="mt-4 pt-4 border-t border-slate-100 overflow-x-auto">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-700">
                  Revenue Table Structure ({locationRevenue.location})
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">
                  Reflecting spreadsheet Revenue_Table_Structure
                </span>
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-2.5 px-3">Agent</th>
                    <th className="py-2.5 px-3 text-right">Shopify Orders</th>
                    <th className="py-2.5 px-3 text-right">Shopify Revenue</th>
                    <th className="py-2.5 px-3 text-right">Alt No. Orders</th>
                    <th className="py-2.5 px-3 text-right">Alt No. Revenue</th>
                    <th className="py-2.5 px-3 text-right">Marketplace Orders</th>
                    <th className="py-2.5 px-3 text-right">Marketplace Revenue</th>
                    <th className="py-2.5 px-3 text-right">POS OC Orders</th>
                    <th className="py-2.5 px-3 text-right">POS OC Revenue</th>
                    <th className="py-2.5 px-3 text-right font-black">Total Orders</th>
                    <th className="py-2.5 px-3 text-right font-black">Total Revenue</th>
                    <th className="py-2.5 px-3 text-right">AOV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {locationRevenue.rows.map((r) => {
                    const isCurrent = r.agentEmail.toLowerCase() === currentAgentEmail.toLowerCase();
                    return (
                      <tr
                        key={r.agentEmail}
                        className={isCurrent ? 'bg-amber-50 font-bold border-l-4 border-l-amber-500' : 'hover:bg-slate-50'}
                      >
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span>{r.agentEmail}</span>
                          {isCurrent && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-amber-500 text-slate-950 font-bold">
                              YOU
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right">{r.shopifyOrders}</td>
                        <td className="py-2 px-3 text-right">{formatCurrencyINR(r.shopifyRevenue)}</td>
                        <td className="py-2 px-3 text-right">{r.altOrders}</td>
                        <td className="py-2 px-3 text-right">{formatCurrencyINR(r.altRevenue)}</td>
                        <td className="py-2 px-3 text-right">{r.mpOrders}</td>
                        <td className="py-2 px-3 text-right">{formatCurrencyINR(r.mpRevenue)}</td>
                        <td className="py-2 px-3 text-right">{r.posOrders}</td>
                        <td className="py-2 px-3 text-right">{formatCurrencyINR(r.posRevenue)}</td>
                        <td className="py-2 px-3 text-right font-black text-slate-900">{r.totalOrders}</td>
                        <td className="py-2 px-3 text-right font-black text-slate-900">{formatCurrencyINR(r.totalRevenue)}</td>
                        <td className="py-2 px-3 text-right">{formatCurrencyINR(r.aov)}</td>
                      </tr>
                    );
                  })}
                  {/* Total Row */}
                  <tr className="bg-slate-100/80 font-black border-t-2 border-slate-300 text-slate-900">
                    <td className="py-2.5 px-3">Total ({locationRevenue.location})</td>
                    <td className="py-2.5 px-3 text-right">{locationRevenue.categories.shopify.orders}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrencyINR(locationRevenue.categories.shopify.sales)}</td>
                    <td className="py-2.5 px-3 text-right">{locationRevenue.categories.bfan.orders}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrencyINR(locationRevenue.categories.bfan.sales)}</td>
                    <td className="py-2.5 px-3 text-right">{locationRevenue.categories.bfmp.orders}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrencyINR(locationRevenue.categories.bfmp.sales)}</td>
                    <td className="py-2.5 px-3 text-right">{locationRevenue.categories.posoc.orders}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrencyINR(locationRevenue.categories.posoc.sales)}</td>
                    <td className="py-2.5 px-3 text-right text-amber-900">{locationRevenue.totalOrders}</td>
                    <td className="py-2.5 px-3 text-right text-amber-900">{formatCurrencyINR(locationRevenue.totalRevenue)}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrencyINR(locationRevenue.aov)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Main Leaderboard Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-slate-500">Loading standings...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
            <button
              onClick={() => fetchLeaderboards()}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
            >
              Try Again
            </button>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <Trophy className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-700">No callers found</p>
            <p className="text-xs text-slate-500 mt-1">
              {search ? 'Try clearing your search query.' : 'No data recorded yet for this category.'}
            </p>
          </div>
        ) : activeTab === 'preSales' ? (
          /* PRE SALES TABLE */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-3 px-4 w-14 text-center">Rank</th>
                  <th className="py-3 px-4">Caller</th>
                  <th className="py-3 px-3">Location</th>
                  <th className="py-3 px-3 text-center">Worked Days</th>
                  <th className="py-3 px-4 text-right">Inbound Calls / Day</th>
                  <th className="py-3 px-4 text-right">Average Talk Time</th>
                  <th className="py-3 px-3 text-center">Quality Score</th>
                  <th className="py-3 px-4 text-center">Quality Gate (≥85)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredList.map((row) => {
                  const isCurrent =
                    row.isCurrentAgent || row.officialEmail.toLowerCase() === currentAgentEmail.toLowerCase();
                  const isTop1 = row.rank === 1;
                  const isTop2 = row.rank === 2;
                  const isTop3 = row.rank === 3;
                  const gateMet = (row.qualityScore ?? 0) >= 85;

                  return (
                    <tr
                      key={row.officialEmail}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-amber-50/80 font-medium hover:bg-amber-100/70 border-l-4 border-l-amber-500'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        {isTop1 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 text-slate-950 font-bold shadow-xs">
                            <Crown className="w-4 h-4" />
                          </div>
                        ) : isTop2 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-300 text-slate-900 font-bold shadow-xs">
                            2
                          </div>
                        ) : isTop3 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700 text-white font-bold shadow-xs">
                            3
                          </div>
                        ) : (
                          <span className="text-slate-500 font-bold">#{row.rank}</span>
                        )}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isCurrent ? 'text-amber-900' : 'text-slate-900'}`}>
                            {row.name}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500 text-slate-950">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{row.officialEmail}</span>
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-3 font-medium text-slate-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {row.location}
                        </span>
                      </td>

                      {/* Worked Days */}
                      <td className="py-3.5 px-3 text-center font-mono text-slate-600">
                        {row.activeDays}
                      </td>

                      {/* Calls */}
                      <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{row.avgCalls ?? 0}</span>
                          {(row.callsTier ?? 0) > 0 ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                (row.callsTier ?? 0) >= 3
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (row.callsTier ?? 0) === 2
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              Tier {row.callsTier}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Below T1</span>
                          )}
                        </div>
                      </td>

                      {/* Talk Time */}
                      <td className="py-3.5 px-4 text-right font-mono whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">
                            {row.avgTalkSeconds ?? 0}s ({Math.floor((row.avgTalkSeconds ?? 0) / 60)}m {(row.avgTalkSeconds ?? 0) % 60}s)
                          </span>
                          {(row.talkTier ?? 0) > 0 ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                (row.talkTier ?? 0) >= 3
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : (row.talkTier ?? 0) === 2
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              Tier {row.talkTier}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Below T1</span>
                          )}
                        </div>
                      </td>

                      {/* Quality Score */}
                      <td className="py-3.5 px-3 text-center font-mono whitespace-nowrap">
                        {row.qualityScore !== null ? (
                          <span
                            className={`font-semibold ${
                              row.qualityScore >= 85 ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {row.qualityScore}%
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      {/* Quality Gate */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap font-mono text-[11px]">
                        {gateMet ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                            <ShieldCheck className="w-3 h-3 text-emerald-600" />
                            Gate Met
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold border border-slate-200">
                            Locked (&lt;85%)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* HO & STORE TABLE */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-3 px-4 w-14 text-center">Rank</th>
                  <th className="py-3 px-4">Caller</th>
                  <th className="py-3 px-3">Location</th>
                  <th className="py-3 px-3 text-right">Orders</th>
                  <th className="py-3 px-4 text-right">Net Revenue</th>
                  <th className="py-3 px-3 text-right">Target Achieved</th>
                  <th className="py-3 px-3 text-center">Class</th>
                  <th className="py-3 px-3 text-right">AOV</th>
                  <th className="py-3 px-3 text-center">Worked Days</th>
                  <th className="py-3 px-3 text-right">Daily Connects</th>
                  <th className="py-3 px-3 text-right">Daily Talk Time</th>
                  <th className="py-3 px-3 text-center">Quality</th>
                  <th className="py-3 px-4 text-right">Store Footfalls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredList.map((row) => {
                  const isCurrent =
                    row.isCurrentAgent || row.officialEmail.toLowerCase() === currentAgentEmail.toLowerCase();
                  const isTop1 = row.rank === 1;
                  const isTop2 = row.rank === 2;
                  const isTop3 = row.rank === 3;

                  return (
                    <tr
                      key={row.officialEmail}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-amber-50/80 font-medium hover:bg-amber-100/70 border-l-4 border-l-amber-500'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        {isTop1 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 text-slate-950 font-bold shadow-xs">
                            <Crown className="w-4 h-4" />
                          </div>
                        ) : isTop2 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-300 text-slate-900 font-bold shadow-xs">
                            2
                          </div>
                        ) : isTop3 ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-700 text-white font-bold shadow-xs">
                            3
                          </div>
                        ) : (
                          <span className="text-slate-500 font-bold">#{row.rank}</span>
                        )}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isCurrent ? 'text-amber-900' : 'text-slate-900'}`}>
                            {row.name}
                          </span>
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500 text-slate-950">
                              YOU
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{row.officialEmail}</span>
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-3 font-medium text-slate-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {row.location}
                        </span>
                      </td>

                      {/* Orders */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold text-slate-800">
                        {row.orders}
                      </td>

                      {/* Net Revenue */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                        {formatCurrencyINR(row.sales)}
                      </td>

                      {/* Target Achieved */}
                      <td className="py-3.5 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        <div className="inline-flex flex-col items-end">
                          <span className={row.achievementPct >= 100 ? 'text-emerald-600 font-bold' : 'text-slate-700'}>
                            {formatNumberINR(row.achievementPct, 1)}%
                          </span>
                        </div>
                      </td>

                      {/* Class */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap font-mono">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            row.className === 'D'
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : row.className === 'C'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : row.className === 'B'
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : row.className === 'A'
                              ? 'bg-slate-100 text-slate-800 border border-slate-300'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          Class {row.className}
                        </span>
                      </td>

                      {/* AOV */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                        {formatCurrencyINR(row.aov)}
                      </td>

                      {/* Worked Days */}
                      <td className="py-3.5 px-3 text-center font-mono text-slate-600">
                        {row.activeDays}
                      </td>

                      {/* Connects */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-700">
                        {row.avgConnects}/day
                      </td>

                      {/* Talk Time */}
                      <td className="py-3.5 px-3 text-right font-mono text-slate-700">
                        {row.avgTalkMinutes}m/day
                      </td>

                      {/* Quality */}
                      <td className="py-3.5 px-3 text-center font-mono whitespace-nowrap">
                        {row.qualityScore !== null ? (
                          <span
                            className={`font-semibold ${
                              row.qualityScore >= 85 ? 'text-emerald-700' : 'text-slate-600'
                            }`}
                          >
                            {row.qualityScore}%
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">-</span>
                        )}
                      </td>

                      {/* Store Visits Attributed */}
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-700">
                        {row.visitsAttributed}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>Ranked by Overall Incentive Payout descending</span>
          <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
            <CheckCircle className="w-3.5 h-3.5" /> Exact Payout Figures Confidential
          </span>
        </div>
      </div>
    </div>
  );
}
