import React, { useState } from 'react';
import { TeamView } from './TeamView';
import { Leaderboards } from './Leaderboards';
import { SyncStatus } from './SyncStatus';
import { TestCenter } from './TestCenter';
import { AgentView } from './AgentView';
import {
  Users,
  Trophy,
  Activity,
  TestTube,
  ArrowLeft,
  ShieldCheck,
  MapPin,
} from 'lucide-react';

interface StaffPortalProps {
  userRole: 'superAdmin' | 'manager' | 'tl';
  userEmail: string;
  userLocation?: string;
  activeCycleId: string;
  testMode?: boolean;
  getIdToken: () => Promise<string>;
}

type StaffTab = 'team' | 'leaderboards' | 'syncStatus' | 'testCenter';

export function StaffPortal({
  userRole,
  userEmail,
  userLocation,
  activeCycleId,
  testMode = false,
  getIdToken,
}: StaffPortalProps) {
  const [activeTab, setActiveTab] = useState<StaffTab>('team');
  const [selectedAgentEmail, setSelectedAgentEmail] = useState<string | null>(null);

  // If an agent record is opened, display AgentView with read-only Simulator/Actual and "Back to team" button
  if (selectedAgentEmail) {
    return (
      <div className="space-y-4">
        <AgentView
          officialEmail={selectedAgentEmail}
          getIdToken={getIdToken}
          onBack={() => setSelectedAgentEmail(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Role Header & Tab Navigation */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-bold text-slate-950 dark:text-white tracking-tight">
              {userRole === 'superAdmin'
                ? 'Super Admin Console'
                : userRole === 'manager'
                ? 'Manager Overview'
                : 'Team Leader Dashboard'}
            </h1>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              · {userRole === 'superAdmin' ? 'Super Admin' : userRole === 'manager' ? 'Cross-Location' : userLocation || 'Team'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {userRole === 'tl'
              ? `Monitoring active caller performance and daily targets in ${userLocation || 'assigned branch'}.`
              : userRole === 'manager'
              ? 'Monitoring cross-location caller performance and incentive realization across all 3 branches.'
              : 'System administration, real-time data sync audits, and live metrics.'}
          </p>
        </div>

        {/* Navigation Tabs based on role */}
        <div className="bg-slate-100 dark:bg-slate-850 p-1 rounded-xl flex flex-wrap items-center gap-1 shrink-0 border border-slate-200/60 dark:border-slate-800 shadow-xs">
          <button
            onClick={() => setActiveTab('team')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'team'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Team
          </button>

          <button
            onClick={() => setActiveTab('leaderboards')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'leaderboards'
                ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            {userRole === 'tl' ? 'Leaderboard' : 'Leaderboards'}
          </button>

          {userRole === 'superAdmin' && (
            <button
              onClick={() => setActiveTab('syncStatus')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'syncStatus'
                  ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Sync Status
            </button>
          )}

          {userRole === 'superAdmin' && testMode && (
            <button
              onClick={() => setActiveTab('testCenter')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'testCenter'
                  ? 'bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TestTube className="w-3.5 h-3.5" />
              Test Center
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'team' && (
        <TeamView
          userRole={userRole}
          userEmail={userEmail}
          activeCycleId={activeCycleId}
          onOpenAgent={(officialEmail) => setSelectedAgentEmail(officialEmail)}
        />
      )}

      {activeTab === 'leaderboards' && (
        <Leaderboards
          userRole={userRole}
          userLocation={userLocation}
          activeCycleId={activeCycleId}
        />
      )}

      {activeTab === 'syncStatus' && userRole === 'superAdmin' && (
        <SyncStatus getIdToken={getIdToken} />
      )}

      {activeTab === 'testCenter' && userRole === 'superAdmin' && testMode && (
        <TestCenter userEmail={userEmail} getIdToken={getIdToken} />
      )}
    </div>
  );
}
