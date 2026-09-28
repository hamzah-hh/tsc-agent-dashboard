import React, { useState, useEffect } from 'react';
import { AgentRecord, AgentType, Cycle, Plan, PreSalesPlan } from '../shared/types';
import {
  defaultHOPlan,
  defaultPreSalesPlan,
  defaultSTOREPlan,
  getPreSalesPlan,
  getRevenuePlan,
} from '../shared/plans';
import { metricsFromTotals, preSalesMetricsFromTotals } from '../shared/incentive';
import { ActualTab } from './ActualTab';
import { TargetTab } from './TargetTab';
import { SimulatorTab } from './SimulatorTab';
import { PreSalesActualTab } from './PreSalesActualTab';
import { PreSalesSimulatorTab } from './PreSalesSimulatorTab';
import { calculateProjection, calculateRemainingWorkingDays } from '../shared/planning';
import {
  RotateCcw,
  Calendar,
  MapPin,
  Briefcase,
  AlertCircle,
  LayoutDashboard,
  Calculator,
  ArrowLeft,
  Target,
} from 'lucide-react';
import { soundFx } from '../utils/audio';

interface AgentViewProps {
  officialEmail: string;
  getIdToken: () => Promise<string>;
  onBack?: () => void;
}

export function AgentView({ officialEmail, getIdToken, onBack }: AgentViewProps) {
  const [activeTab, setActiveTab] = useState<'actual' | 'target' | 'simulator'>('actual');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simPresetSales, setSimPresetSales] = useState<number | undefined>(undefined);

  const [agentRecord, setAgentRecord] = useState<AgentRecord | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const res = await fetch(
        `/api/agent-data?officialEmail=${encodeURIComponent(officialEmail)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setAgentRecord(data.agentRecord);
      setCycle(data.cycle);
    } catch (err: any) {
      console.error('Error fetching agent view:', err);
      setError(err?.message || 'Failed to load agent data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [officialEmail]);

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-9 h-9 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Loading Agent Performance...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6 text-center shadow-xs">
        <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 rounded-xl flex items-center justify-center text-rose-600 dark:text-rose-400 mx-auto mb-3">
          <AlertCircle className="w-5 h-5" />
        </div>
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Could not load agent record</h4>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-5">{error}</p>
        <div className="flex items-center justify-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"
            >
              Go Back
            </button>
          )}
          <button
            onClick={() => fetchData(true)}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition shadow-xs font-bold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Active plan fallback
  const activeCycle = cycle || {
    name: 'Diwali 2026',
    startDate: '2026-10-01',
    endDate: '2026-11-30',
    status: 'active' as const,
    workingDaysPerWeek: 6,
    plans: {
      HO: defaultHOPlan,
      STORE: defaultSTOREPlan,
      PRE_SALES: defaultPreSalesPlan,
    },
  };

  const agentType: AgentType = agentRecord?.agentType || 'STORE';
  const isPreSales = agentType === 'PRE_SALES';
  // HO / Store agents use the revenue plan; Pre Sales agents use their own plan
  const plan: Plan = getRevenuePlan(activeCycle, agentType === 'HO' ? 'HO' : 'STORE');
  const preSalesPlan: PreSalesPlan = getPreSalesPlan(activeCycle);

  // Check if lastDataDate is more than 2 days before today in IST
  // IST is UTC+5:30
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayISTStr = nowIST.toISOString().split('T')[0];
  const lastDataDate = agentRecord?.lastDataDate || '';

  let isOutdated = false;
  if (lastDataDate) {
    const lastDateMs = new Date(lastDataDate + 'T00:00:00Z').getTime();
    const todayMs = new Date(todayISTStr + 'T00:00:00Z').getTime();
    const daysDiff = Math.round((todayMs - lastDateMs) / (1000 * 60 * 60 * 24));
    if (daysDiff > 2) {
      isOutdated = true;
    }
  }

  // Simulator starting values
  const totals = agentRecord?.totals || {
    sales: 0,
    orders: 0,
    connects: 0,
    talkSeconds: 0,
    visitsBooked: 0,
    visitsAttributed: 0,
    activeDays: 0,
  };
  const quality = agentRecord?.quality || { audits: 0, score: 0 };
  const remainingWorkingDays = calculateRemainingWorkingDays(
    lastDataDate,
    activeCycle.startDate,
    activeCycle.endDate,
    activeCycle.workingDaysPerWeek
  );

  // The same rounding as the real calculation (whole numbers, quality rounded), so the Simulator starts
  // exactly where the Actual tab is. With no data yet, it starts at the top of the plan's bands.
  const actualMetrics = metricsFromTotals(totals, quality, agentRecord?.absentDays ?? null);

  const initialSales = totals.activeDays > 0
    ? Math.round(calculateProjection(totals.sales, totals.activeDays, remainingWorkingDays))
    : plan.target;

  const initialAvgConnects = totals.activeDays > 0
    ? actualMetrics.avgConnects
    : plan.bonuses.connects.high;

  const initialAvgTalkMinutes = totals.activeDays > 0
    ? actualMetrics.avgTalkMinutes
    : plan.bonuses.talkMinutes.high;

  const initialQualityScore = actualMetrics.qualityScore ?? 0;

  const initialVisits = totals.activeDays > 0
    ? Math.round(
        calculateProjection(
          totals.visitsAttributed,
          totals.activeDays,
          remainingWorkingDays
        )
      )
    : [...plan.visitTiers].sort((a, b) => a.min - b.min)[0]?.min ?? 0;

  // Pre Sales simulator starting values (current averages, or the first tier / gate before any data)
  const psMetrics = preSalesMetricsFromTotals(totals, quality, preSalesPlan);
  const psHasData = totals.activeDays > 0;
  const initialPsCalls = psHasData ? psMetrics.avgCalls : preSalesPlan.calls[0]?.min ?? 100;
  const initialPsTalk = psHasData ? psMetrics.avgTalkSeconds : preSalesPlan.talkSeconds[0]?.min ?? 165;
  const initialPsQuality = psMetrics.qualityScore ?? (psHasData ? 0 : preSalesPlan.qualityGate);

  const actualTotalIncentive = agentRecord?.result?.total || 0;

  return (
    <div className="space-y-6">
      {/* Outdated Data Warning Banner */}
      {isOutdated && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-300 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Data last updated on {lastDataDate}.</span>
          </div>
          <span className="text-[11px] text-amber-700 dark:text-amber-400 font-mono">Sync pending from Ops sheet</span>
        </div>
      )}

      {/* HEADER (both tabs) */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {onBack && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition mr-1.5 text-xs font-semibold"
                title="Back to team"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Team
              </button>
            )}
            <h1 className="text-xl font-bold text-slate-950 dark:text-white tracking-tight">
              {agentRecord?.name || 'Caller Performance'}
            </h1>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-mono tracking-wide">
              · {agentType === 'HO' ? 'HO Caller' : agentType === 'PRE_SALES' ? 'Pre Sales' : 'Store Caller'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">{agentRecord?.location || 'Location'}</span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
            <span>{activeCycle.name}</span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
            <span>{lastDataDate ? `Data up to ${lastDataDate}` : 'No cycle data recorded'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Segmented Tab Control */}
          <div className="bg-slate-100 dark:bg-slate-950 p-1 rounded-xl flex items-center border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('actual');
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'actual'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Actual
            </button>
            {!isPreSales && (
              <button
                onClick={() => {
                  soundFx.playPop();
                  setActiveTab('target');
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'target'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span className="sm:hidden">Target</span>
                <span className="hidden sm:inline">Target & Goals</span>
              </button>
            )}
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('simulator');
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'simulator'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              Simulator
            </button>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => {
              soundFx.playPop();
              fetchData(true);
            }}
            disabled={refreshing}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-xs"
            title="Refresh Data"
          >
            <RotateCcw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Tab Body */}
      {isPreSales ? (
        activeTab === 'simulator' ? (
          <PreSalesSimulatorTab
            plan={preSalesPlan}
            initialCalls={initialPsCalls}
            initialTalkSeconds={initialPsTalk}
            initialQualityScore={initialPsQuality}
            actualTotalIncentive={actualTotalIncentive}
          />
        ) : (
          <PreSalesActualTab
            agentRecord={agentRecord}
            plan={preSalesPlan}
            cycle={activeCycle}
            onNavigateToSimulator={() => setActiveTab('simulator')}
          />
        )
      ) : activeTab === 'actual' ? (
        <ActualTab
          agentRecord={agentRecord}
          plan={plan}
          cycle={activeCycle}
          onNavigateToSimulator={(targetSales) => {
            soundFx.playPop();
            setSimPresetSales(targetSales);
            setActiveTab('simulator');
          }}
          onNavigateToTarget={() => {
            soundFx.playPop();
            setActiveTab('target');
          }}
        />
      ) : activeTab === 'target' ? (
        <TargetTab
          agentRecord={agentRecord}
          plan={plan}
          cycle={activeCycle}
          onNavigateToSimulator={(targetSales) => {
            soundFx.playPop();
            setSimPresetSales(targetSales);
            setActiveTab('simulator');
          }}
          onNavigateToActual={() => {
            soundFx.playPop();
            setActiveTab('actual');
          }}
        />
      ) : (
        <SimulatorTab
          plan={plan}
          agentType={agentType}
          initialSales={initialSales}
          initialAvgConnects={initialAvgConnects}
          initialAvgTalkMinutes={initialAvgTalkMinutes}
          initialQualityScore={initialQualityScore}
          initialVisits={initialVisits}
          actualTotalIncentive={actualTotalIncentive}
          presetSales={simPresetSales}
        />
      )}
    </div>
  );
}
