import React, { useState, useEffect } from 'react';
import { lazyView } from '../utils/lazyView';
import { AgentRecord, AgentType, Cycle, Plan, PreSalesPlan } from '../shared/types';
import {
  defaultHOPlan,
  defaultPreSalesPlan,
  defaultSTOREPlan,
  getPreSalesPlan,
  getRevenuePlan,
} from '../shared/plans';
import { metricsFromTotals, preSalesMetricsFromTotals } from '../shared/incentive';
import { MilestoneLadder } from './MilestoneLadder';
const ActualTab = lazyView<React.ComponentProps<typeof import('./ActualTab')['ActualTab']>>(() => import('./ActualTab'), 'ActualTab');
const TargetTab = lazyView<React.ComponentProps<typeof import('./TargetTab')['TargetTab']>>(() => import('./TargetTab'), 'TargetTab');
const SimulatorTab = lazyView<React.ComponentProps<typeof import('./SimulatorTab')['SimulatorTab']>>(() => import('./SimulatorTab'), 'SimulatorTab');
const PreSalesActualTab = lazyView<React.ComponentProps<typeof import('./PreSalesActualTab')['PreSalesActualTab']>>(() => import('./PreSalesActualTab'), 'PreSalesActualTab');
const PreSalesSimulatorTab = lazyView<React.ComponentProps<typeof import('./PreSalesSimulatorTab')['PreSalesSimulatorTab']>>(() => import('./PreSalesSimulatorTab'), 'PreSalesSimulatorTab');
const AgentLeaderboardTab = lazyView<React.ComponentProps<typeof import('./AgentLeaderboardTab')['AgentLeaderboardTab']>>(() => import('./AgentLeaderboardTab'), 'AgentLeaderboardTab');
const TeamRevenueTab = lazyView<React.ComponentProps<typeof import('./TeamRevenueTab')['TeamRevenueTab']>>(() => import('./TeamRevenueTab'), 'TeamRevenueTab');
const RawDataView = lazyView<React.ComponentProps<typeof import('./RawDataView')['RawDataView']>>(() => import('./RawDataView'), 'RawDataView');
const DayOnDayView = lazyView<React.ComponentProps<typeof import('./DayOnDayView')['DayOnDayView']>>(() => import('./DayOnDayView'), 'DayOnDayView');
const CallMetricsTab = lazyView<React.ComponentProps<typeof import('./CallMetricsTab')['CallMetricsTab']>>(() => import('./CallMetricsTab'), 'CallMetricsTab');
const RosterTab = lazyView<React.ComponentProps<typeof import('./RosterTab')['RosterTab']>>(() => import('./RosterTab'), 'RosterTab');
const HomeTab = lazyView<React.ComponentProps<typeof import('./HomeTab')['HomeTab']>>(() => import('./HomeTab'), 'HomeTab');
const BreaksAdherenceTab = lazyView<React.ComponentProps<typeof import('./BreaksAdherenceTab')['BreaksAdherenceTab']>>(() => import('./BreaksAdherenceTab'), 'BreaksAdherenceTab');
import { StaleBanner } from './StaleBanner';
import { useRosterStatus } from '../utils/rosterApi';
import { StackedSection, StackedSections } from './StackedSections';
import { calculateProjection, calculateRemainingWorkingDays } from '../shared/planning';
import {
  RotateCcw,
  Calendar,
  MapPin,
  Briefcase,
  AlertCircle,
  Home,
  CalendarDays,
  ArrowLeft,
  TrendingUp,
  FileSpreadsheet,
  PhoneCall,
  Timer,
} from 'lucide-react';
import { soundFx } from '../utils/audio';

interface AgentViewProps {
  officialEmail: string;
  getIdToken: () => Promise<string>;
  onBack?: () => void;
}

export function AgentView({ officialEmail, getIdToken, onBack }: AgentViewProps) {
  const [activeTab, setActiveTab] = useState<'home' | 'revenue' | 'calls' | 'breaks' | 'roster' | 'rawData'>('home');
  // The Roster tab appears only when rostering is switched on for this person (and the agent's team is in the pilot)
  const { status: rosterStatus, refresh: refreshRoster } = useRosterStatus(getIdToken);
  // Scrolls the Revenue page to a section from a button inside another section
  const [jumpTo, setJumpTo] = useState<{ id: string; n: number } | null>(null);
  const jump = (id: string) => {
    soundFx.playPop();
    setJumpTo((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
  };
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
      <div className="max-w-md mx-auto my-12 bg-white/95 dark:bg-slate-900/90 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-6 text-center shadow-xs">
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
            className="px-3.5 py-1.5 text-xs font-semibold text-white dark:text-on-accent bg-brand-900 dark:bg-accent hover:bg-brand-800 dark:hover:bg-accent-hover rounded-lg transition shadow-xs font-bold"
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

  const lastDataDate = agentRecord?.lastDataDate || '';

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

  const leaderboardSection: StackedSection = {
    id: 'leaderboard',
    title: 'Leaderboard',
    node: (
      <AgentLeaderboardTab
        getIdToken={getIdToken}
        currentAgentEmail={agentRecord?.officialEmail || officialEmail}
        currentLocation={agentRecord?.location || ''}
        currentAgentType={agentType}
      />
    ),
  };
  const revenueSections: StackedSection[] = isPreSales
    ? [
        {
          id: 'actual',
          title: 'Actual',
          node: <PreSalesActualTab agentRecord={agentRecord} plan={preSalesPlan} cycle={activeCycle} onNavigateToSimulator={() => jump('simulator')} />,
        },
        {
          id: 'simulator',
          title: 'Simulator',
          node: (
            <PreSalesSimulatorTab
              plan={preSalesPlan}
              initialCalls={initialPsCalls}
              initialTalkSeconds={initialPsTalk}
              initialQualityScore={initialPsQuality}
              actualTotalIncentive={actualTotalIncentive}
            />
          ),
        },
        leaderboardSection,
      ]
    : [
        {
          id: 'overview',
          title: 'Overview',
          node: (
            <TargetTab
              part="banner"
              agentRecord={agentRecord}
              plan={plan}
              cycle={activeCycle}
              onNavigateToSimulator={(targetSales) => {
                setSimPresetSales(targetSales);
                jump('simulator');
              }}
              onNavigateToActual={() => jump('actual')}
              ladder={
                agentRecord?.result && agentRecord.totals ? (
                  <MilestoneLadder
                    embedded
                    currentClass={agentRecord.result.className}
                    achievementPct={agentRecord.result.achievementPct}
                    sales={agentRecord.totals.sales}
                    plan={plan}
                    onSimulateTarget={(targetSales) => {
                      setSimPresetSales(targetSales);
                      jump('simulator');
                    }}
                  />
                ) : undefined
              }
            />
          ),
        },
        {
          id: 'actual',
          title: 'Actual',
          node: (
            <ActualTab
              agentRecord={agentRecord}
              plan={plan}
              cycle={activeCycle}
              onNavigateToSimulator={(targetSales) => {
                setSimPresetSales(targetSales);
                jump('simulator');
              }}
              onNavigateToTarget={() => jump('target')}
              hideTargetBlocks
            />
          ),
        },
        {
          id: 'target',
          title: 'Targets & Goals',
          node: (
            <TargetTab
              part="rest"
              agentRecord={agentRecord}
              plan={plan}
              cycle={activeCycle}
              onNavigateToSimulator={(targetSales) => {
                setSimPresetSales(targetSales);
                jump('simulator');
              }}
              onNavigateToActual={() => jump('actual')}
            />
          ),
        },
        {
          id: 'simulator',
          title: 'Simulator',
          node: (
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
          ),
        },
        leaderboardSection,
        {
          id: 'team-revenue',
          title: 'Team Revenue',
          node: <TeamRevenueTab getIdToken={getIdToken} agentLocation={agentRecord?.location || 'Dighe'} agentType={agentType} />,
        },
        {
          id: 'day-on-day',
          title: 'Day-on-Day',
          node: (
            <DayOnDayView
              userRole="agent"
              userEmail={agentRecord?.officialEmail || officialEmail}
              targetAgentEmail={agentRecord?.officialEmail || officialEmail}
              targetAgentName={agentRecord?.name}
              lockAgent={true}
              userLocation={agentRecord?.location}
              getIdToken={getIdToken}
            />
          ),
        },
      ];

  return (
    <div className="space-y-6">
      {/* Outdated data warning: latest data date more than 2 days old */}
      <StaleBanner date={lastDataDate} />

      {/* HEADER (both tabs) */}
      <div className="bg-white/95 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
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

        <div className="flex items-center gap-2.5 max-w-full overflow-hidden">
          {/* Segmented Tab Control with horizontal scroll on narrow screens */}
          <div className="bg-slate-100 dark:bg-slate-950 p-1 rounded-xl flex items-center border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-x-auto max-w-full scrollbar-none">
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('home');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                activeTab === 'home'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span className="sm:hidden">Home</span>
              <span className="hidden sm:inline">Home</span>
            </button>
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('revenue');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                activeTab === 'revenue'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="sm:hidden">Revenue</span>
              <span className="hidden sm:inline">Revenue</span>
            </button>
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('calls');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                activeTab === 'calls'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span className="sm:hidden">Calls</span>
              <span className="hidden sm:inline">Call Metrics</span>
            </button>
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('breaks');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                activeTab === 'breaks'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Timer className="w-3.5 h-3.5" />
              <span className="sm:hidden">Breaks</span>
              <span className="hidden sm:inline">Breaks & Adherence</span>
            </button>
            {rosterStatus?.enabled && (
              <button
                onClick={() => {
                  soundFx.playPop();
                  setActiveTab('roster');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                  activeTab === 'roster'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>Roster</span>
                {rosterStatus.badge ? <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none ">{rosterStatus.badge}</span> : null}
              </button>
            )}
            <button
              onClick={() => {
                soundFx.playPop();
                setActiveTab('rawData');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition shrink-0 ${
                activeTab === 'rawData'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="sm:hidden">Raw</span>
              <span className="hidden sm:inline">Raw Data</span>
            </button>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => {
              soundFx.playPop();
              fetchData(true);
            }}
            disabled={refreshing}
            className="p-2 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition shadow-xs shrink-0"
            title="Refresh Data"
          >
            <RotateCcw className={`w-4 h-4 ${refreshing ? 'animate-spin text-amber-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Revenue: Actual, Targets & Goals, Simulator, Leaderboard, Team Revenue and Day-on-Day in one view */}
      {/* Main Tab Body */}
      {activeTab === 'home' ? (
        <HomeTab agentRecord={agentRecord} plan={isPreSales ? null : plan} isPreSales={isPreSales} getIdToken={getIdToken} />
      ) : activeTab === 'calls' ? (
        <CallMetricsTab agentRecord={agentRecord} isPreSales={isPreSales} />
      ) : activeTab === 'breaks' ? (
        <BreaksAdherenceTab agentRecord={agentRecord} getIdToken={getIdToken} />
      ) : activeTab === 'roster' && rosterStatus?.enabled ? (
        <RosterTab
          getIdToken={getIdToken}
          agentEmail={onBack ? agentRecord?.officialEmail || officialEmail : undefined}
          readOnly={Boolean(onBack)}
          onChanged={refreshRoster}
        />
      ) : activeTab === 'rawData' ? (
        <RawDataView
          userRole="agent"
          userEmail={agentRecord?.officialEmail || officialEmail}
          targetAgentEmail={agentRecord?.officialEmail || officialEmail}
          targetAgentName={agentRecord?.name}
          lockAgent={true}
          userLocation={agentRecord?.location}
          getIdToken={getIdToken}
        />
      ) : (
        <StackedSections sections={revenueSections} jumpTo={jumpTo} />
      )}
    </div>
  );
}
