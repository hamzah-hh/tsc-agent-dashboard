import React from 'react';
import { AgentRecord } from '../shared/types';
import { PRODUCTIVITY_RULES, hms } from '../shared/teamOps';
import { csvName, csvStamp } from '../utils/csv';
import { ExportCsvButton } from './ExportCsvButton';
import { AgentBreaksSection } from './AgentBreaksSection';

interface CallMetricsTabProps {
  agentRecord: AgentRecord | null;
  getIdToken: () => Promise<string>;
  /** Pre Sales have no Dialer, so only their breaks are shown. */
  showCallMetrics: boolean;
}

/** The agent's Day on Day unique connects and talk time, and their Breaks. */
export function CallMetricsTab({ agentRecord, getIdToken, showCallMetrics }: CallMetricsTabProps) {
  // Newest day first; days with no Dialer row (day null/0) are not worked days
  const dodDays = [...(agentRecord?.daily || [])].filter((x) => x.day === 1 || x.day === 0.5).sort((a, b) => b.date.localeCompare(a.date));
  const name = agentRecord?.name || 'agent';

  return (
    <div className="space-y-6">
      {showCallMetrics && (
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono">
              Day on Day: Connects & Talk Time
            </span>
            <ExportCsvButton
              filename={csvName('call-metrics', name, csvStamp())}
              disabled={dodDays.length === 0}
              getRows={() => [
                ['Date', 'Day', 'Unique Connects', 'Talk Time'],
                ...dodDays.map((d) => [d.date, d.day === 0.5 ? 'Half Day' : 'Full Day', d.connects, hms(d.talkSeconds)]),
              ]}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
            Daily target: {PRODUCTIVITY_RULES.minUniqueConnectsPerDay} unique connects and {hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)} talk time (half for a half day). Red means below target.
          </p>
          {dodDays.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-xs text-slate-400 dark:text-slate-500">No daily data recorded yet</div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Date</th>
                    <th className="py-2 pr-3 font-semibold">Day</th>
                    <th className="py-2 pr-3 font-semibold text-right">Unique Connects</th>
                    <th className="py-2 font-semibold text-right">Talk Time</th>
                  </tr>
                </thead>
                <tbody>
                  {dodDays.map((d) => {
                    const factor = d.day === 0.5 ? 0.5 : 1;
                    const lowC = d.connects < PRODUCTIVITY_RULES.minUniqueConnectsPerDay * factor;
                    const lowT = Math.round(d.talkSeconds) < PRODUCTIVITY_RULES.minTalkSecondsPerDay * factor;
                    return (
                      <tr key={d.date} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-3 font-mono">{d.date}</td>
                        <td className="py-1.5 pr-3">{d.day === 1 ? 'Full Day' : 'Half Day'}</td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${lowC ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{d.connects}</td>
                        <td className={`py-1.5 text-right tabular-nums ${lowT ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{hms(d.talkSeconds)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <AgentBreaksSection getIdToken={getIdToken} agentName={name} />
    </div>
  );
}
