import React, { useState, useEffect } from 'react';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  CalendarDays,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Building2,
  Percent,
  RotateCcw,
  Download,
  ShoppingBag,
  LayoutGrid,
  Table as TableIcon,
  ShieldCheck,
  MapPin,
} from 'lucide-react';
import { soundFx } from '../utils/audio';

interface DayOnDayViewProps {
  userRole: 'superAdmin' | 'manager' | 'tl' | 'agent';
  userEmail: string;
  getIdToken: () => Promise<string>;
  targetAgentEmail?: string;
  targetAgentName?: string;
  userLocation?: string;
  lockAgent?: boolean;
}

interface DodDayRow {
  date: string;
  dayNumber: number;
  agent: {
    sales: number;
    orders: number;
    connects: number;
    talkMinutes: number;
    salesDelta: number;
    salesGrowthPct: number | null;
    ordersDelta: number;
  };
  team: {
    sales: number;
    orders: number;
    activeCallersCount: number;
    salesDelta: number;
    salesGrowthPct: number | null;
    ordersDelta: number;
  };
  sharePct: number;
  cumulative: {
    agentSales: number;
    teamSales: number;
    agentOrders: number;
    teamOrders: number;
    sharePct: number;
  };
}

interface TeamRosterItem {
  officialEmail: string;
  name: string;
  location: string;
  className: string;
  totalSales: number;
  totalOrders: number;
  daySales: Record<string, number>;
  shareOfTeam: number;
}

export function DayOnDayView({
  userRole,
  userEmail,
  getIdToken,
  targetAgentEmail,
  targetAgentName,
  userLocation,
  lockAgent = false,
}: DayOnDayViewProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeViewMode, setActiveViewMode] = useState<'comparison' | 'matrix'>('comparison');
  const [selectedAgent, setSelectedAgent] = useState<string>(targetAgentEmail || '');
  const [selectedLocation, setSelectedLocation] = useState<string>(userLocation || 'Dighe');

  const [data, setData] = useState<{
    agent: {
      name: string;
      officialEmail: string;
      location: string;
      className: string;
      agentType: string;
    } | null;
    team: {
      location: string;
      targetAmount: number;
      totalRevenue: number;
      totalOrders: number;
      agentCount: number;
    };
    summary: {
      latestDate: string;
      latestAgentSales: number;
      latestTeamSales: number;
      latestSharePct: number;
      totalAgentSales: number;
      totalTeamSales: number;
      totalSharePct: number;
      totalAgentOrders: number;
      totalTeamOrders: number;
      dates: string[];
    };
    dailyComparison: DodDayRow[];
    teamRosterMatrix: TeamRosterItem[];
  } | null>(null);

  const isStaff = userRole === 'superAdmin' || userRole === 'manager' || userRole === 'tl';

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const params = new URLSearchParams();

      const effectiveAgent = targetAgentEmail || (selectedAgent || '');
      if (effectiveAgent) params.set('agentEmail', effectiveAgent);
      if (selectedLocation && !effectiveAgent) params.set('location', selectedLocation);

      const res = await fetch(`/api/dod-data?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(json);

      if (!selectedAgent && json.agent?.officialEmail) {
        setSelectedAgent(json.agent.officialEmail);
      }
    } catch (err: any) {
      console.error('Failed to load Day-on-Day data:', err);
      setError(err?.message || 'Failed to load Day-on-Day performance data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (targetAgentEmail) {
      setSelectedAgent(targetAgentEmail);
    }
  }, [targetAgentEmail]);

  useEffect(() => {
    fetchData();
  }, [selectedAgent, selectedLocation]);

  const handleExportCSV = () => {
    if (!data) return;
    soundFx.playPop();

    let csvContent = '';
    let filename = '';

    if (activeViewMode === 'comparison') {
      const headers = [
        'Date',
        'Day_Number',
        'Agent_Sales_INR',
        'Agent_Sales_Delta_INR',
        'Agent_Sales_Growth_Pct',
        'Agent_Orders',
        'Agent_Connects',
        'Team_Sales_INR',
        'Team_Sales_Delta_INR',
        'Team_Sales_Growth_Pct',
        'Team_Orders',
        'Agent_Share_Of_Team_Pct',
        'Cumulative_Agent_Sales_INR',
        'Cumulative_Team_Sales_INR',
        'Cumulative_Share_Pct',
      ];
      const rows = data.dailyComparison.map((r) => [
        `"${r.date}"`,
        r.dayNumber,
        r.agent.sales,
        r.agent.salesDelta,
        r.agent.salesGrowthPct !== null ? `${r.agent.salesGrowthPct}%` : 'N/A',
        r.agent.orders,
        r.agent.connects,
        r.team.sales,
        r.team.salesDelta,
        r.team.salesGrowthPct !== null ? `${r.team.salesGrowthPct}%` : 'N/A',
        r.team.orders,
        `${r.sharePct}%`,
        r.cumulative.agentSales,
        r.cumulative.teamSales,
        `${r.cumulative.sharePct}%`,
      ]);
      csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      filename = `dod_comparison_${data.agent?.name || 'agent'}_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      const dates = data.summary.dates || [];
      const headers = ['Caller_Name', 'Official_Email', 'Location', 'Class', ...dates.map((d) => `Sales_${d}`), 'Total_Sales_INR', 'Total_Orders', 'Share_Of_Team_Pct'];
      const rows = data.teamRosterMatrix.map((r) => [
        `"${r.name}"`,
        `"${r.officialEmail}"`,
        `"${r.location}"`,
        `"${r.className}"`,
        ...dates.map((d) => r.daySales[d] || 0),
        r.totalSales,
        r.totalOrders,
        `${r.shareOfTeam}%`,
      ]);
      csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
      filename = `dod_team_matrix_${data.team.location}_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                <CalendarDays className="w-3.5 h-3.5" />
                Day-on-Day (D-o-D) Analytics
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono text-slate-300 bg-slate-800/80 border border-slate-700">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                {targetAgentEmail
                  ? `Caller vs Team: ${targetAgentName || targetAgentEmail}`
                  : userRole === 'agent'
                  ? 'Your Personal D-o-D vs Team'
                  : userRole === 'tl'
                  ? `Team D-o-D (${data?.team.location || userLocation || 'Team'})`
                  : 'Company-Wide D-o-D'}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              {data?.agent ? `${data.agent.name} · Day-on-Day Breakdown` : 'Team Day-on-Day Performance'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Tracking daily revenue velocity, daily orders, and individual contribution percentage alongside {data?.team.location || 'Branch'} team revenue.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
            {/* View Mode Toggle for staff */}
            {isStaff && !lockAgent && (
              <div className="bg-slate-950 p-1 rounded-xl flex items-center border border-slate-800">
                <button
                  onClick={() => {
                    soundFx.playPop();
                    setActiveViewMode('comparison');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeViewMode === 'comparison'
                      ? 'bg-slate-800 text-white shadow-xs font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <TableIcon className="w-3.5 h-3.5" />
                  Comparison
                </button>
                <button
                  onClick={() => {
                    soundFx.playPop();
                    setActiveViewMode('matrix');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeViewMode === 'matrix'
                      ? 'bg-slate-800 text-white shadow-xs font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Team Matrix
                </button>
              </div>
            )}

            {/* Export CSV button */}
            <button
              onClick={handleExportCSV}
              disabled={loading || !data}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold rounded-xl transition border border-slate-700 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>

            {/* Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="p-2 border border-slate-800 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white transition"
              title="Refresh D-o-D data"
            >
              <RotateCcw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Bar (Only for staff when not locked to single caller) */}
        {isStaff && !lockAgent && (
          <div className="mt-6 pt-5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Location filter (Manager & Super Admin) */}
              {(userRole === 'superAdmin' || userRole === 'manager') && (
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedLocation}
                    onChange={(e) => {
                      setSelectedLocation(e.target.value);
                      setSelectedAgent('');
                    }}
                    className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="Dighe" className="bg-slate-900">Dighe</option>
                    <option value="Andheri" className="bg-slate-900">Andheri</option>
                    <option value="Bangalore" className="bg-slate-900">Bangalore</option>
                  </select>
                </div>
              )}

              {/* Agent selector (for Comparison view) */}
              {activeViewMode === 'comparison' && data?.teamRosterMatrix && (
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedAgent}
                    onChange={(e) => setSelectedAgent(e.target.value)}
                    className="bg-transparent text-xs text-white focus:outline-none cursor-pointer max-w-[200px] truncate"
                  >
                    {data.teamRosterMatrix.map((a) => (
                      <option key={a.officialEmail} value={a.officialEmail} className="bg-slate-900">
                        {a.name || a.officialEmail}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Active Branch: <strong className="text-white">{data?.team.location}</strong> ({data?.team.agentCount || 0} Callers)
            </div>
          </div>
        )}
      </div>

      {/* KPI Summary Cards */}
      {data && data.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Card 1: Agent Total Revenue */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase font-bold">Caller Revenue</span>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {formatCurrencyINR(data.summary.totalAgentSales)}
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {data.summary.totalAgentOrders} Orders across all recorded days
            </p>
          </div>

          {/* Card 2: Team Total Revenue */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase font-bold">{data.team.location} Team Total</span>
              <Building2 className="w-4 h-4 text-indigo-500" />
            </div>
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {formatCurrencyINR(data.summary.totalTeamSales)}
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {data.summary.totalTeamOrders} Branch Orders ({data.team.agentCount} Callers)
            </p>
          </div>

          {/* Card 3: Overall Contribution % */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase font-bold">Team Share %</span>
              <Percent className="w-4 h-4 text-amber-500" />
            </div>
            <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
              {data.summary.totalSharePct}%
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Caller share of total branch sales
            </p>
          </div>

          {/* Card 4: Latest Day Velocity */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase font-bold">Latest Day ({data.summary.latestDate})</span>
              <ShoppingBag className="w-4 h-4 text-cyan-500" />
            </div>
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {formatCurrencyINR(data.summary.latestAgentSales)}
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Team: {formatCurrencyINR(data.summary.latestTeamSales)} ({data.summary.latestSharePct}%)
            </p>
          </div>
        </div>
      )}

      {/* Main Table: Comparison View */}
      {activeViewMode === 'comparison' && data && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-indigo-500" />
                Day-on-Day Performance Ledger
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Comparing caller daily sales, orders, and connects against {data.team.location} branch daily revenue.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase font-bold text-slate-500 dark:text-slate-400">
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4 text-right">Caller Sales</th>
                  <th className="py-3.5 px-4 text-center">Caller D-o-D Growth</th>
                  <th className="py-3.5 px-4 text-center">Orders</th>
                  <th className="py-3.5 px-4 text-center">Connects</th>
                  <th className="py-3.5 px-4 text-right">Team Sales ({data.team.location})</th>
                  <th className="py-3.5 px-4 text-center">Team D-o-D Growth</th>
                  <th className="py-3.5 px-4 text-center">Team Orders</th>
                  <th className="py-3.5 px-4 text-center">Share of Team</th>
                  <th className="py-3.5 px-4 text-right">Cumulative Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.dailyComparison.map((r, i) => {
                  const agDelta = r.agent.salesDelta;
                  const tmDelta = r.team.salesDelta;

                  return (
                    <tr
                      key={r.date}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      {/* Date */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 dark:text-white font-mono">
                          {r.date}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          Day {r.dayNumber}
                        </span>
                      </td>

                      {/* Caller Sales */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatCurrencyINR(r.agent.sales)}
                      </td>

                      {/* Caller D-o-D Growth */}
                      <td className="py-3.5 px-4 text-center font-mono text-[11px]">
                        {i === 0 ? (
                          <span className="text-slate-400">Baseline</span>
                        ) : agDelta > 0 ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <ArrowUpRight className="w-3 h-3" />
                            +{formatCurrencyINR(agDelta)} ({r.agent.salesGrowthPct !== null ? `+${r.agent.salesGrowthPct}%` : '—'})
                          </span>
                        ) : agDelta < 0 ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400">
                            <ArrowDownRight className="w-3 h-3" />
                            {formatCurrencyINR(agDelta)} ({r.agent.salesGrowthPct !== null ? `${r.agent.salesGrowthPct}%` : '—'})
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>

                      {/* Caller Orders */}
                      <td className="py-3.5 px-4 text-center font-mono">
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {r.agent.orders}
                        </span>
                        {i > 0 && r.agent.ordersDelta !== 0 && (
                          <span
                            className={`ml-1 text-[10px] ${
                              r.agent.ordersDelta > 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            ({r.agent.ordersDelta > 0 ? `+${r.agent.ordersDelta}` : r.agent.ordersDelta})
                          </span>
                        )}
                      </td>

                      {/* Connects */}
                      <td className="py-3.5 px-4 text-center font-mono text-slate-600 dark:text-slate-300">
                        {r.agent.connects || '—'}
                      </td>

                      {/* Team Sales */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-indigo-900 dark:text-indigo-200">
                        {formatCurrencyINR(r.team.sales)}
                      </td>

                      {/* Team D-o-D Growth */}
                      <td className="py-3.5 px-4 text-center font-mono text-[11px]">
                        {i === 0 ? (
                          <span className="text-slate-400">Baseline</span>
                        ) : tmDelta > 0 ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <ArrowUpRight className="w-3 h-3" />
                            +{formatCurrencyINR(tmDelta)} ({r.team.salesGrowthPct !== null ? `+${r.team.salesGrowthPct}%` : '—'})
                          </span>
                        ) : tmDelta < 0 ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400">
                            <ArrowDownRight className="w-3 h-3" />
                            {formatCurrencyINR(tmDelta)} ({r.team.salesGrowthPct !== null ? `${r.team.salesGrowthPct}%` : '—'})
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>

                      {/* Team Orders */}
                      <td className="py-3.5 px-4 text-center font-mono font-medium text-slate-700 dark:text-slate-300">
                        {r.team.orders}
                      </td>

                      {/* Share of Team */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-14 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-amber-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, r.sharePct * 3)}%` }}
                            />
                          </div>
                          <span className="font-mono font-bold text-xs text-amber-600 dark:text-amber-400">
                            {r.sharePct}%
                          </span>
                        </div>
                      </td>

                      {/* Cumulative Sales */}
                      <td className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        <div>{formatCurrencyINR(r.cumulative.agentSales)}</div>
                        <span className="text-[10px] text-slate-400">
                          {r.cumulative.sharePct}% of {formatCurrencyINR(r.cumulative.teamSales)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Table: Team Roster Matrix View (Staff only) */}
      {activeViewMode === 'matrix' && data && isStaff && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-indigo-500" />
                {data.team.location} Branch: Caller Day-on-Day Roster Matrix
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Every caller's daily sales side-by-side with overall branch revenue and contribution share.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase font-bold text-slate-500 dark:text-slate-400">
                  <th className="py-3.5 px-4">Caller</th>
                  <th className="py-3.5 px-3 text-center">Class</th>
                  {data.summary.dates.map((d) => (
                    <th key={d} className="py-3.5 px-4 text-right font-mono">
                      {d.slice(5)}
                    </th>
                  ))}
                  <th className="py-3.5 px-4 text-right">Total Revenue</th>
                  <th className="py-3.5 px-3 text-center">Orders</th>
                  <th className="py-3.5 px-4 text-center">% of Branch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {data.teamRosterMatrix.map((agent) => (
                  <tr
                    key={agent.officialEmail}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Caller */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {agent.name}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono truncate block max-w-xs">
                        {agent.officialEmail}
                      </span>
                    </td>

                    {/* Class */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {agent.className}
                      </span>
                    </td>

                    {/* Daily Sales columns */}
                    {data.summary.dates.map((d) => {
                      const dayVal = agent.daySales[d] || 0;
                      return (
                        <td
                          key={d}
                          className="py-3.5 px-4 text-right font-mono text-[11px] text-slate-800 dark:text-slate-200"
                        >
                          {dayVal > 0 ? (
                            <span className="font-semibold">{formatCurrencyINR(dayVal)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Total Revenue */}
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-950 dark:text-white">
                      {formatCurrencyINR(agent.totalSales)}
                    </td>

                    {/* Orders */}
                    <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                      {agent.totalOrders}
                    </td>

                    {/* % of Branch */}
                    <td className="py-3.5 px-4 text-center">
                      <span className="font-mono font-bold text-xs text-amber-600 dark:text-amber-400">
                        {agent.shareOfTeam}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
