import React, { useState, useEffect } from 'react';
import { RawOrderRecord, RawVisitRecord } from '../shared/types';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  FileSpreadsheet,
  ShoppingBag,
  Store,
  Search,
  RotateCcw,
  Download,
  Filter,
  Users,
  MapPin,
  Calendar,
  Phone,
  Clock,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { soundFx } from '../utils/audio';

interface RawDataViewProps {
  userRole: 'superAdmin' | 'manager' | 'tl' | 'agent';
  userEmail: string;
  getIdToken: () => Promise<string>;
  userLocation?: string;
  defaultTab?: 'orders' | 'visits';
  targetAgentEmail?: string;
  targetAgentName?: string;
  lockAgent?: boolean;
}

export function RawDataView({
  userRole,
  userEmail,
  getIdToken,
  userLocation,
  defaultTab = 'orders',
  targetAgentEmail,
  targetAgentName,
  lockAgent = false,
}: RawDataViewProps) {
  const [activeTab, setActiveTab] = useState<'orders' | 'visits'>(defaultTab);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; at: string; error?: string } | null>(null);

  const [orders, setOrders] = useState<RawOrderRecord[]>([]);
  const [visits, setVisits] = useState<RawVisitRecord[]>([]);
  const [allowedAgents, setAllowedAgents] = useState<
    Array<{ officialEmail: string; name: string; location: string }>
  >([]);
  const [summary, setSummary] = useState<{
    totalOrders: number;
    totalRevenue: number;
    totalVisits: number;
    aov: number;
  }>({
    totalOrders: 0,
    totalRevenue: 0,
    totalVisits: 0,
    aov: 0,
  });

  // Filters
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<string>(targetAgentEmail || 'all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    if (targetAgentEmail) {
      setSelectedAgent(targetAgentEmail);
    }
  }, [targetAgentEmail]);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const params = new URLSearchParams();
      const effectiveAgent = targetAgentEmail || (selectedAgent !== 'all' ? selectedAgent : '');

      if (selectedLocation !== 'all' && !effectiveAgent) params.set('location', selectedLocation);
      if (effectiveAgent) params.set('agentEmail', effectiveAgent);
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/raw-data?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setOrders(json.orders || []);
      setVisits(json.visits || []);
      setSyncStatus(json.syncStatus || null);
      setSummary(
        json.summary || {
          totalOrders: 0,
          totalRevenue: 0,
          totalVisits: 0,
          aov: 0,
        }
      );
      if (Array.isArray(json.allowedAgents)) {
        setAllowedAgents(json.allowedAgents);
      }
    } catch (err: any) {
      console.error('Failed to load raw data:', err);
      setError(err?.message || 'Failed to load transaction data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedLocation, selectedAgent, selectedCategory]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData();
  };

  const exportCSV = () => {
    soundFx.playPop();
    let csvContent = '';
    let filename = '';

    if (activeTab === 'orders') {
      const headers = [
        'Order_ID',
        'Date',
        'Order_Time',
        'Agent_Email',
        'Location',
        'Category',
        'Channel',
        'Order_Phone',
        'Talk_Time_Cohort',
        'Order_Value',
      ];
      const rows = orders.map((o) => [
        `"${o.orderId}"`,
        `"${o.date}"`,
        `"${o.orderTime}"`,
        `"${o.agentEmail}"`,
        `"${o.location}"`,
        `"${o.category}"`,
        `"${o.channel}"`,
        `"${o.orderPhone}"`,
        `"${o.talkTimeCohort}"`,
        o.orderValue,
      ]);
      csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      filename = `raw_orders_${userRole}_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      const headers = [
        'Visit_ID',
        'Type',
        'Date',
        'Visit_Date_Time',
        'Agent_Email',
        'Location',
        'Phone_Number',
        'Talk_Time_Seconds',
        'Visit_Source',
        'Interested_Sub_Status',
      ];
      const rows = visits.map((v) => [
        `"${v.id}"`,
        `"${v.type}"`,
        `"${v.date}"`,
        `"${v.visitDateTime}"`,
        `"${v.agentEmail}"`,
        `"${v.location}"`,
        `"${v.phoneNumber}"`,
        v.talkTimeSeconds,
        `"${v.visitSource}"`,
        `"${v.interestedSubStatus || ''}"`,
      ]);
      csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      filename = `raw_visits_${userRole}_${new Date().toISOString().slice(0, 10)}.csv`;
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

  const isStaff = userRole === 'superAdmin' || userRole === 'manager' || userRole === 'tl';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Raw Transaction Master
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono text-slate-300 bg-slate-800/80 border border-slate-700">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                {targetAgentEmail
                  ? `Filtered to Caller: ${targetAgentName || targetAgentEmail}`
                  : userRole === 'agent'
                  ? 'Scoped to Your Official Account'
                  : userRole === 'tl'
                  ? 'Scoped to Your Team'
                  : 'Company-Wide Master View'}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Raw Orders & Attributed Visits
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              {userRole === 'agent'
                ? 'Direct transaction-level audit logs for your orders and attributed customer store visits.'
                : userRole === 'tl'
                ? 'Complete transaction ledger for all callers in your team. Filter by caller or search order IDs.'
                : 'Master transaction ledger across all locations and callers synchronized with the central sheet.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-md shadow-amber-500/20 transition"
              title="Download filtered dataset as CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => {
                soundFx.playPop();
                fetchData(true);
              }}
              disabled={refreshing}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="Refresh Raw Data"
            >
              <RotateCcw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tab Switcher & Filters */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-slate-800">
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('orders');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeTab === 'orders'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              Raw Orders
              <span
                className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  activeTab === 'orders' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {summary.totalOrders}
              </span>
            </button>

            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('visits');
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeTab === 'visits'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              Attributed Visits
              <span
                className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  activeTab === 'visits' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {summary.totalVisits}
              </span>
            </button>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Location filter for Manager / Super Admin */}
            {(userRole === 'superAdmin' || userRole === 'manager') && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all" className="bg-slate-900">All Locations</option>
                  <option value="Dighe" className="bg-slate-900">Dighe</option>
                  <option value="Andheri" className="bg-slate-900">Andheri</option>
                  <option value="Bangalore" className="bg-slate-900">Bangalore</option>
                </select>
              </div>
            )}

            {/* Agent filter for Staff (TL, Manager, Super Admin) */}
            {isStaff && !lockAgent && allowedAgents.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="bg-transparent text-xs text-white focus:outline-none cursor-pointer max-w-[180px] truncate"
                >
                  <option value="all" className="bg-slate-900">
                    {userRole === 'tl' ? 'All My Team Callers' : 'All Callers'}
                  </option>
                  {allowedAgents.map((a) => (
                    <option key={a.officialEmail} value={a.officialEmail} className="bg-slate-900">
                      {a.name || a.officialEmail}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Category filter for Orders */}
            {activeTab === 'orders' && (
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all" className="bg-slate-900">All Channels</option>
                  <option value="Shopify" className="bg-slate-900">1. Shopify</option>
                  <option value="Another Number" className="bg-slate-900">2. Alt Number</option>
                  <option value="Marketplace" className="bg-slate-900">3. Marketplace</option>
                  <option value="POS" className="bg-slate-900">4. POS OC ALT</option>
                </select>
              </div>
            )}

            {/* Search form */}
            <form onSubmit={handleSearchSubmit} className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Order ID, Phone, Caller..."
                className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-48 sm:w-60"
              />
            </form>
          </div>
        </div>
      </div>

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-mono uppercase font-bold">Total Orders</span>
            <ShoppingBag className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono">
            {summary.totalOrders}
          </span>
          <span className="text-[11px] text-slate-400 block mt-0.5">Matching current view</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-mono uppercase font-bold">Total Order Value</span>
            <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono">
            {formatCurrencyINR(summary.totalRevenue)}
          </span>
          <span className="text-[11px] text-slate-400 block mt-0.5">Gross revenue sum</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-mono uppercase font-bold">Average Order Value</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono">
            {formatCurrencyINR(summary.aov)}
          </span>
          <span className="text-[11px] text-slate-400 block mt-0.5">Avg across orders</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-mono uppercase font-bold">Attributed Visits</span>
            <Store className="w-4 h-4 text-purple-500" />
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono">
            {summary.totalVisits}
          </span>
          <span className="text-[11px] text-slate-400 block mt-0.5">Store footfalls credited</span>
        </div>
      </div>

      {/* The last raw-data fill failed: say so instead of showing zeros as if there were no orders. */}
      {syncStatus && !syncStatus.ok && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <p className="font-bold">Raw orders and visits could not be loaded from the Google Sheet.</p>
          <p className="mt-1 break-words">
            {syncStatus.error || 'Ask the Super Admin to check the Raw_Revenue and Raw_Visit sync.'}
          </p>
          {syncStatus.at && (
            <p className="mt-1 text-rose-500">Last attempt: {new Date(syncStatus.at).toLocaleString('en-IN')}</p>
          )}
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-24 text-center">
            <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-slate-500 font-mono">Loading transaction master...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
            <button
              onClick={() => fetchData()}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
            >
              Retry
            </button>
          </div>
        ) : activeTab === 'orders' ? (
          /* ORDERS TABLE */
          orders.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <ShoppingBag className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No orders found</p>
              <p className="text-xs text-slate-500 mt-1">Try resetting your filters or search keywords.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-3 px-4">Order ID</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-4">Caller</th>
                    <th className="py-3 px-3">Location</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Channel</th>
                    <th className="py-3 px-3 font-mono">Phone</th>
                    <th className="py-3 px-3">Talk Cohort</th>
                    <th className="py-3 px-4 text-right font-black">Order Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <tr key={o.orderId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {o.orderId}
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-mono whitespace-nowrap">
                        {o.date}
                        {o.orderTime && o.orderTime !== o.date && (
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {o.orderTime.split(' ')[1] || ''}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 block">{o.agentEmail}</span>
                        <span className="text-[10px] text-slate-400 block">{o.agentCategory}</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {o.location}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            o.category.includes('Shopify')
                              ? 'bg-indigo-100 text-indigo-800'
                              : o.category.includes('Another Number') || o.category.includes('Alt')
                              ? 'bg-emerald-100 text-emerald-800'
                              : o.category.includes('Marketplace')
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {o.category}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">{o.channel}</td>
                      <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {o.orderPhone}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                        {o.talkTimeCohort}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {formatCurrencyINR(o.orderValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* VISITS TABLE */
          visits.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <Store className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">No attributed visits found</p>
              <p className="text-xs text-slate-500 mt-1">Try resetting your filters or search keywords.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-mono uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-3 px-4">Visit ID</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Date & Time</th>
                    <th className="py-3 px-4">Caller</th>
                    <th className="py-3 px-3">Location</th>
                    <th className="py-3 px-3 font-mono">Customer Phone</th>
                    <th className="py-3 px-3 text-right">Talk Duration</th>
                    <th className="py-3 px-3">Source</th>
                    <th className="py-3 px-3 text-center">Attributed Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {v.id}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            v.type === 'STORE'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {v.type === 'STORE' ? 'Store Caller' : 'HO Caller'}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                        {v.visitDateTime || v.date}
                        {v.bookingDate && (
                          <span className="text-[10px] text-slate-400 block">
                            Booked: {v.bookingDate}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-900">
                        {v.agentEmail}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {v.location}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {v.phoneNumber}
                      </td>
                      <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                        <span className="font-bold text-slate-900">{v.talkTimeSeconds}s</span>
                        <span className="text-[10px] text-slate-400 block">
                          ({Math.floor(v.talkTimeSeconds / 60)}m {v.talkTimeSeconds % 60}s)
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {v.visitSource}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          1 Credit
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
