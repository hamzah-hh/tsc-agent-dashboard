import React, { useState, useEffect } from 'react';
import { TeamRevenueDoc } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  TrendingUp,
  ShoppingBag,
  Smartphone,
  Layers,
  Store,
  Calendar,
  RotateCcw,
  ShieldCheck,
  Search,
  Download,
  DollarSign,
  PieChart,
  AlertCircle,
} from 'lucide-react';
import { soundFx } from '../utils/audio';
import { RevenueDiscrepancyForm } from './RevenueDiscrepancyForm';

interface TeamRevenueTabProps {
  getIdToken: () => Promise<string>;
  agentLocation: string;
  agentType: string;
}

export function TeamRevenueTab({ getIdToken, agentLocation, agentType }: TeamRevenueTabProps) {
  const [data, setData] = useState<TeamRevenueDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState('');

  const fetchRevenue = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const res = await fetch(`/api/team-revenue?location=${encodeURIComponent(agentLocation)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(json.teamRevenue);
    } catch (err: any) {
      console.error('Failed to load team revenue:', err);
      setError(err?.message || 'Could not load team revenue data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRevenue();
  }, [agentLocation]);

  const dailyList = data?.daily || [];
  const filteredDaily = dailyList.filter(
    (d) => !searchDate || d.date.includes(searchDate) || String(d.day).includes(searchDate)
  );

  const categories = data?.categories || {
    shopify: { orders: 0, sales: 0, pctOfSales: 0 },
    bfan: { orders: 0, sales: 0, pctOfSales: 0 },
    bfmp: { orders: 0, sales: 0, pctOfSales: 0 },
    posoc: { orders: 0, sales: 0, pctOfSales: 0 },
  };

  const exportCSV = () => {
    if (!data || dailyList.length === 0) return;
    const headers = [
      'Date',
      'Day',
      'Shopify_Orders',
      'Shopify_Revenue',
      'BFAN_Orders',
      'BFAN_Revenue',
      'BFMP_Orders',
      'BFMP_Revenue',
      'POSOC_Orders',
      'POSOC_Revenue',
      'Total_Orders',
      'Total_Revenue',
    ];
    const rows = dailyList.map((d) => [
      d.date,
      d.day,
      d.shopify.orders,
      d.shopify.sales,
      d.bfan.orders,
      d.bfan.sales,
      d.bfmp.orders,
      d.bfmp.sales,
      d.posoc.orders,
      d.posoc.sales,
      d.totalOrders,
      d.totalSales,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${data.location}_Team_Revenue_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-sm border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                <TrendingUp className="w-3.5 h-3.5" />
                Team Channel Revenue
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800/80">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                {agentLocation} Team Restricted View
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {agentLocation} Revenue Breakdown
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Official sales performance across 4 key channels: <strong>Shopify</strong>, <strong>BFAN</strong>, <strong>BFMP</strong>, and <strong>POSOC</strong>. Daily orders and revenue match sheet totals for {agentLocation}.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                document.getElementById('revenue-discrepancy-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold border border-amber-500/40 transition"
              title="Report an issue or discrepancy regarding revenue"
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Raise Discrepancy</span>
            </button>
            <button
              onClick={exportCSV}
              disabled={dailyList.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition disabled:opacity-50"
              title="Download CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-300" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              onClick={() => {
                soundFx.playPop();
                fetchRevenue(true);
              }}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
              title="Refresh Team Revenue"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-500">Loading {agentLocation} team revenue...</p>
        </div>
      ) : error ? (
        <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center">
          <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
          <button
            onClick={() => fetchRevenue()}
            className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold"
          >
            Try Again
          </button>
        </div>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500">
          No revenue recorded yet for {agentLocation}.
        </div>
      ) : (
        <>
          {/* 4 Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">
                Total Team Revenue
              </span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {formatCurrencyINR(data.totalSales)}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">Full cycle accumulated sales</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">
                Total Orders Closed
              </span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {data.totalOrders}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">Combined orders across 4 channels</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">
                Average Order Value (AOV)
              </span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {formatCurrencyINR(data.aov)}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">Per closed order average</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold block">
                Active Days Logged
              </span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1">
                {dailyList.length} days
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">Verified sheet entries</span>
            </div>
          </div>

          {/* Notice when channel-wise split was not provided in DoD sheet */}
          {!data.hasDoDSplit && data.totalSales > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed">
                <span className="font-bold">No Channel Split in DoD Sheet:</span> Team revenue ({formatCurrencyINR(data.totalSales)}) and total orders ({data.totalOrders}) are recorded from your Main Sheet. Individual channel columns below show ₹0 because no channel-wise split (Shopify, BFAN, BFMP, POSOC) was provided in the DoD sheet. Values are never fabricated.
              </div>
            </div>
          )}

          {/* 4 Category Revenue Breakdown Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Shopify */}
            <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-xs relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                  Shopify
                </span>
                <span className="text-xs font-mono font-bold text-emerald-700">
                  {categories.shopify.pctOfSales || 0}%
                </span>
              </div>
              <div className="text-xl font-black text-slate-900 font-mono">
                {formatCurrencyINR(categories.shopify.sales)}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 font-mono">
                <span>{categories.shopify.orders} orders</span>
                <span>
                  AOV:{' '}
                  {categories.shopify.orders > 0
                    ? formatCurrencyINR(Math.round(categories.shopify.sales / categories.shopify.orders))
                    : '₹0'}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, categories.shopify.pctOfSales || 0)}%` }}
                />
              </div>
            </div>

            {/* BFAN */}
            <div className="bg-white border border-indigo-200 rounded-2xl p-5 shadow-xs relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                  BFAN
                </span>
                <span className="text-xs font-mono font-bold text-indigo-700">
                  {categories.bfan.pctOfSales || 0}%
                </span>
              </div>
              <div className="text-xl font-black text-slate-900 font-mono">
                {formatCurrencyINR(categories.bfan.sales)}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 font-mono">
                <span>{categories.bfan.orders} orders</span>
                <span>
                  AOV:{' '}
                  {categories.bfan.orders > 0
                    ? formatCurrencyINR(Math.round(categories.bfan.sales / categories.bfan.orders))
                    : '₹0'}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, categories.bfan.pctOfSales || 0)}%` }}
                />
              </div>
            </div>

            {/* BFMP */}
            <div className="bg-white border border-purple-200 rounded-2xl p-5 shadow-xs relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  BFMP
                </span>
                <span className="text-xs font-mono font-bold text-purple-700">
                  {categories.bfmp.pctOfSales || 0}%
                </span>
              </div>
              <div className="text-xl font-black text-slate-900 font-mono">
                {formatCurrencyINR(categories.bfmp.sales)}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 font-mono">
                <span>{categories.bfmp.orders} orders</span>
                <span>
                  AOV:{' '}
                  {categories.bfmp.orders > 0
                    ? formatCurrencyINR(Math.round(categories.bfmp.sales / categories.bfmp.orders))
                    : '₹0'}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-purple-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, categories.bfmp.pctOfSales || 0)}%` }}
                />
              </div>
            </div>

            {/* POSOC */}
            <div className="bg-white border border-amber-200 rounded-2xl p-5 shadow-xs relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  <Store className="w-3.5 h-3.5 text-amber-600" />
                  POSOC
                </span>
                <span className="text-xs font-mono font-bold text-amber-700">
                  {categories.posoc.pctOfSales || 0}%
                </span>
              </div>
              <div className="text-xl font-black text-slate-900 font-mono">
                {formatCurrencyINR(categories.posoc.sales)}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 font-mono">
                <span>{categories.posoc.orders} orders</span>
                <span>
                  AOV:{' '}
                  {categories.posoc.orders > 0
                    ? formatCurrencyINR(Math.round(categories.posoc.sales / categories.posoc.orders))
                    : '₹0'}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3 overflow-hidden">
                <div
                  className="bg-amber-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, categories.posoc.pctOfSales || 0)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Daily Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Daily Channel Revenue Log</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Orders and revenue across all 4 categories for each day of the cycle.
                </p>
              </div>

              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchDate}
                  onChange={(e) => setSearchDate(e.target.value)}
                  placeholder="Filter by date (YYYY-MM-DD)..."
                  className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-3 text-center">Day</th>
                    <th className="py-3 px-3 text-right">Shopify (Ord · Rev)</th>
                    <th className="py-3 px-3 text-right">BFAN (Ord · Rev)</th>
                    <th className="py-3 px-3 text-right">BFMP (Ord · Rev)</th>
                    <th className="py-3 px-3 text-right">POSOC (Ord · Rev)</th>
                    <th className="py-3 px-3 text-right">Total Orders</th>
                    <th className="py-3 px-4 text-right bg-slate-100/60">Total Daily Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredDaily.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50/70 transition-colors">
                      {/* Date */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {row.date}
                      </td>

                      {/* Day */}
                      <td className="py-3 px-3 text-center font-mono text-slate-500">
                        {row.day}
                      </td>

                      {/* Shopify */}
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                        <span className="text-slate-500 font-medium mr-1.5">{row.shopify.orders} ord</span>
                        <span className="text-emerald-700 font-bold">{formatCurrencyINR(row.shopify.sales)}</span>
                      </td>

                      {/* BFAN */}
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                        <span className="text-slate-500 font-medium mr-1.5">{row.bfan.orders} ord</span>
                        <span className="text-indigo-700 font-bold">{formatCurrencyINR(row.bfan.sales)}</span>
                      </td>

                      {/* BFMP */}
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                        <span className="text-slate-500 font-medium mr-1.5">{row.bfmp.orders} ord</span>
                        <span className="text-purple-700 font-bold">{formatCurrencyINR(row.bfmp.sales)}</span>
                      </td>

                      {/* POSOC */}
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                        <span className="text-slate-500 font-medium mr-1.5">{row.posoc.orders} ord</span>
                        <span className="text-amber-700 font-bold">{formatCurrencyINR(row.posoc.sales)}</span>
                      </td>

                      {/* Total Orders */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                        {row.totalOrders}
                      </td>

                      {/* Total Revenue */}
                      <td className="py-3 px-4 text-right font-mono font-black text-slate-950 bg-slate-50/80 whitespace-nowrap">
                        {formatCurrencyINR(row.totalSales)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
              <span>
                Verified Rule: Shopify + BFAN + BFMP + POSOC = Daily Orders and Revenue from Main Sheet
              </span>
              <span className="text-indigo-700 font-bold">
                {agentLocation} Team View
              </span>
            </div>
          </div>

          {/* Microsoft Forms Revenue Discrepancy Embed */}
          <RevenueDiscrepancyForm defaultExpanded={true} />
        </>
      )}
    </div>
  );
}
