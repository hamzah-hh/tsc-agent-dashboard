import React, { useState, useEffect } from 'react';
import { SyncLogRecord } from '../shared/types';
import { formatNumberINR } from '../shared/incentive';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Database, AlertCircle, ExternalLink, FileSpreadsheet } from 'lucide-react';

interface SyncStatusProps {
  getIdToken: () => Promise<string>;
}

export function SyncStatus({ getIdToken }: SyncStatusProps) {
  const [logs, setLogs] = useState<SyncLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/sync-logs', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err: any) {
      console.error('Error fetching sync logs:', err);
      setError(err?.message || 'Failed to load sync status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Compute status dot based on latest record:
  // green = ok and lastDataDate within 2 days (in IST)
  // yellow = ok but older
  // red = error (or no logs)
  let latestDotColor = 'bg-slate-300';
  let latestDotStatusText = 'No logs available';

  if (logs.length > 0) {
    const latest = logs[0];
    if (latest.result === 'error') {
      latestDotColor = 'bg-rose-500';
      latestDotStatusText = 'Last sync failed';
    } else {
      // Check lastDataDate within 2 days in IST
      const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      const todayISTStr = nowIST.toISOString().split('T')[0];
      const todayMs = new Date(todayISTStr + 'T00:00:00Z').getTime();

      if (latest.lastDataDate) {
        const lastDateMs = new Date(latest.lastDataDate + 'T00:00:00Z').getTime();
        const daysDiff = Math.round((todayMs - lastDateMs) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 2) {
          latestDotColor = 'bg-emerald-500';
          latestDotStatusText = `Healthy (up to ${latest.lastDataDate})`;
        } else {
          latestDotColor = 'bg-amber-500';
          latestDotStatusText = `Delayed (last date ${latest.lastDataDate}, >2 days ago)`;
        }
      } else {
        latestDotColor = 'bg-emerald-500';
        latestDotStatusText = 'Sync successful';
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Summary Banner */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-3 h-3 rounded-full ${latestDotColor} shadow-xs shrink-0`} />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Data Sync Status
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
              {latestDotStatusText}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Audit history of the last 30 sync operations from Google Apps Script, Excel batch imports, and test runners.
          </p>
        </div>

        <button
          onClick={() => fetchLogs(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs transition shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-amber-500' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Linked Google Sheet Source Banner */}
      <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>Primary Source Spreadsheet</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-emerald-200/60 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100">
                Connected
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-md sm:max-w-xl">
              1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk
            </p>
          </div>
        </div>

        <a
          href="https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-xs transition shrink-0"
        >
          <span>Open Google Sheet</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Table of Sync Records */}
      <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur-sm border border-slate-200/90 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500 mb-2" />
            Loading sync records...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
            No sync operations recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300 border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[10px] tracking-wider font-mono">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4 text-center">Result</th>
                  <th className="py-3 px-4 text-right">Rows</th>
                  <th className="py-3 px-4 text-right">Agents</th>
                  <th className="py-3 px-4">Last Data Date</th>
                  <th className="py-3 px-4">Warnings / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {new Date(log.time).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <span className="capitalize font-semibold text-slate-800 dark:text-slate-200 font-mono">
                        {log.source === 'apps-script'
                          ? 'Apps Script (Daily)'
                          : log.source === 'import'
                          ? 'Excel Manual Import'
                          : 'Test Suite'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {log.result === 'ok' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 font-mono">
                          <CheckCircle className="w-3 h-3" />
                          OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60 font-mono">
                          <XCircle className="w-3 h-3" />
                          Error
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-800 dark:text-slate-200 font-mono">
                      {log.rows !== undefined ? formatNumberINR(log.rows) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-slate-800 dark:text-slate-200 font-mono">
                      {log.agents !== undefined ? formatNumberINR(log.agents) : '—'}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300 font-mono">
                      {log.lastDataDate || '—'}
                    </td>
                    <td className="py-3 px-4 text-[11px]">
                      {log.aiOk !== undefined && (
                        <div className="mb-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/60 font-mono">
                            AI: {log.aiOk} OK{log.aiFailed ? `, ${log.aiFailed} failed` : ''}
                          </span>
                        </div>
                      )}
                      {log.error ? (
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">{log.error}</span>
                      ) : log.warnings && log.warnings.length > 0 ? (
                        <div className="space-y-0.5 text-amber-700 dark:text-amber-400 max-w-md truncate font-mono">
                          {log.warnings.join(' • ')}
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
