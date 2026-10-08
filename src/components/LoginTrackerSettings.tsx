import React, { useState, useEffect } from 'react';
import {
  Clock,
  ShieldCheck,
  RotateCcw,
  Check,
  AlertTriangle,
  Users,
  Timer,
  Settings2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { AppConfig, LoginTrackerConfig } from '../shared/types';
import { soundFx } from '../utils/audio';

interface LoginTrackerSettingsProps {
  appConfig?: AppConfig;
  getIdToken: () => Promise<string>;
  onConfigUpdated?: (newConfig: AppConfig) => void;
}

interface ActivityItem {
  agentEmail: string;
  date: string;
  amSecondsUsed: number;
  pmSecondsUsed: number;
  lastHeartbeatTime?: number;
  lastWindow?: 'AM' | 'PM';
  updatedAt: string;
}

export function LoginTrackerSettings({
  appConfig,
  getIdToken,
  onConfigUpdated,
}: LoginTrackerSettingsProps) {
  const currentTracker = appConfig?.loginTracker || {
    enabled: true,
    amWindowMinutes: 30,
    pmWindowMinutes: 30,
    timezone: 'Asia/Kolkata',
  };

  const [enabled, setEnabled] = useState<boolean>(currentTracker.enabled !== false);
  const [amMinutes, setAmMinutes] = useState<number>(currentTracker.amWindowMinutes || 30);
  const [pmMinutes, setPmMinutes] = useState<number>(currentTracker.pmWindowMinutes || 30);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (appConfig?.loginTracker) {
      setEnabled(appConfig.loginTracker.enabled !== false);
      setAmMinutes(appConfig.loginTracker.amWindowMinutes || 30);
      setPmMinutes(appConfig.loginTracker.pmWindowMinutes || 30);
    }
  }, [appConfig]);

  const fetchActivities = async () => {
    setLoadingActivity(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/login-tracker/activity', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setActivities(json.activities || []);
      }
    } catch (e) {
      console.error('Failed to load login activity:', e);
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      soundFx.playPop();
      const token = await getIdToken();
      const res = await fetch('/api/admin/login-tracker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled,
          amWindowMinutes: Math.max(1, Math.round(amMinutes)),
          pmWindowMinutes: Math.max(1, Math.round(pmMinutes)),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setSaveMsg({ type: 'ok', text: 'Login limits updated and enforced successfully!' });
      if (onConfigUpdated && json.config) {
        onConfigUpdated(json.config);
      }
    } catch (e: any) {
      setSaveMsg({ type: 'error', text: e?.message || 'Failed to update login limits.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetAgent = async (agentEmail: string) => {
    if (!confirm(`Reset today's recorded usage for ${agentEmail}? They will regain their full access window.`)) {
      return;
    }
    setResettingEmail(agentEmail);
    try {
      soundFx.playPop();
      const token = await getIdToken();
      const res = await fetch('/api/admin/login-tracker/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agentEmail }),
      });
      if (res.ok) {
        await fetchActivities();
      }
    } catch (e) {
      console.error('Failed to reset usage:', e);
    } finally {
      setResettingEmail(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">
              Agent Login Tracker & Time-Boxed Access
            </h2>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Controls daily active login limits for Agents. Split automatically into two distinct half-day windows (AM: 12:00 AM–11:59 AM IST, PM: 12:00 PM–11:59 PM IST).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            <Clock className="w-3.5 h-3.5" />
            Asia/Kolkata (IST)
          </span>
        </div>
      </div>

      {/* Main Settings Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Toggle Card */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Time-Boxing Enforcement
            </span>
            <p className="text-xs text-slate-500 mb-4">
              When enabled, callers are automatically logged out once their session minutes for the current half-day window run out.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
            />
            <span className="text-xs font-bold text-slate-800">
              {enabled ? 'Enforced (Active)' : 'Disabled (Unlimited Access)'}
            </span>
          </label>
        </div>

        {/* AM Window Limit */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              AM Window Limit
            </span>
            <span className="text-[11px] font-mono text-indigo-600 font-bold">
              12:00 AM – 11:59 AM
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Maximum active session minutes allowed for morning shifts.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={720}
              value={amMinutes}
              onChange={(e) => setAmMinutes(Math.max(1, parseInt(e.target.value || '1', 10)))}
              disabled={!enabled}
              className="w-28 text-sm font-mono font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 disabled:opacity-50"
            />
            <span className="text-xs font-semibold text-slate-600">Minutes</span>
          </div>
        </div>

        {/* PM Window Limit */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              PM Window Limit
            </span>
            <span className="text-[11px] font-mono text-indigo-600 font-bold">
              12:00 PM – 11:59 PM
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Maximum active session minutes allowed for afternoon / evening shifts.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={720}
              value={pmMinutes}
              onChange={(e) => setPmMinutes(Math.max(1, parseInt(e.target.value || '1', 10)))}
              disabled={!enabled}
              className="w-28 text-sm font-mono font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 disabled:opacity-50"
            />
            <span className="text-xs font-semibold text-slate-600">Minutes</span>
          </div>
        </div>
      </div>

      {/* Summary Note & Save Button */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-start gap-2.5">
          <Settings2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-xs text-indigo-900 leading-relaxed">
            <strong>Active Rule:</strong> Each caller receives <strong>{amMinutes} minutes</strong> during the AM window and a separate <strong>{pmMinutes} minutes</strong> during the PM window (<strong>{amMinutes + pmMinutes} minutes/day</strong> total). Time is tracked only while the user is actively connected. Team Leaders, Managers, and Super Admins are exempt.
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition shrink-0"
        >
          {saving ? 'Saving...' : 'Save Login Limits'}
        </button>
      </div>

      {saveMsg && (
        <div
          className={`p-3 rounded-lg text-xs font-medium mb-6 flex items-center gap-2 ${
            saveMsg.type === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {saveMsg.type === 'ok' ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{saveMsg.text}</span>
        </div>
      )}

      {/* Active Callers Today Ledger */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-600" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Today's Caller Session Activity
            </span>
          </div>

          <button
            onClick={fetchActivities}
            disabled={loadingActivity}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-slate-600 hover:text-slate-900 text-xs font-semibold rounded transition"
            title="Refresh active callers"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loadingActivity ? 'animate-spin text-indigo-600' : ''}`} />
            Refresh
          </button>
        </div>

        {activities.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 italic">
            No caller login activity recorded yet today.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-[11px] font-mono uppercase text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">Caller Email</th>
                  <th className="py-2.5 px-4 font-semibold text-center">AM Used / Limit</th>
                  <th className="py-2.5 px-4 font-semibold text-center">PM Used / Limit</th>
                  <th className="py-2.5 px-4 font-semibold">Last Heartbeat</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {activities.map((a) => {
                  const amUsedMin = Math.round((a.amSecondsUsed || 0) / 60);
                  const pmUsedMin = Math.round((a.pmSecondsUsed || 0) / 60);
                  const isAmExhausted = (a.amSecondsUsed || 0) >= amMinutes * 60;
                  const isPmExhausted = (a.pmSecondsUsed || 0) >= pmMinutes * 60;

                  return (
                    <tr key={a.agentEmail} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        {a.agentEmail}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                            isAmExhausted
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {amUsedMin}m / {amMinutes}m
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                            isPmExhausted
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {pmUsedMin}m / {pmMinutes}m
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-500">
                        {a.updatedAt ? new Date(a.updatedAt).toLocaleTimeString('en-IN') : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => handleResetAgent(a.agentEmail)}
                          disabled={resettingEmail === a.agentEmail}
                          className="px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition disabled:opacity-50"
                        >
                          {resettingEmail === a.agentEmail ? 'Resetting...' : 'Reset Usage'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
