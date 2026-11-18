import React, { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { AppConfig } from '../shared/types';
import { RosterApiError, rosterApi } from '../utils/rosterApi';

interface RosterSettingsProps {
  appConfig: AppConfig;
  getIdToken: () => Promise<string>;
  onConfigUpdated?: (newConfig: AppConfig) => void;
}

/** Super Admin: the rostering switch and the pilot teams (the TLs whose teams see it first; empty = everyone). */
export function RosterSettings({ appConfig, getIdToken, onConfigUpdated }: RosterSettingsProps) {
  const current = appConfig.roster || { enabled: false, pilotTeams: [] };
  const [enabled, setEnabled] = useState(current.enabled);
  const [pilot, setPilot] = useState(current.pilotTeams.join('\n'));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const pilotTeams = pilot.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const out = await rosterApi<{ config: AppConfig }>(getIdToken, 'POST', '/api/admin/config', { roster: { enabled, pilotTeams } });
      onConfigUpdated?.(out.config);
      setMsg({ ok: true, text: enabled ? (pilotTeams.length ? `On for ${pilotTeams.length} pilot team${pilotTeams.length === 1 ? '' : 's'}.` : 'On for every team.') : 'Switched off.' });
    } catch (err: any) {
      setMsg({ ok: false, text: err instanceof RosterApiError ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-panel border border-slate-200 dark:border-line rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-accent" />
        <h3 className="text-xs font-bold text-slate-800 dark:text-fg uppercase tracking-wider">Rostering (weekly offs and leave)</h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Off until you switch it on. With pilot teams listed, only the agents and TLs of those teams get the Roster tab; managers and Super Admins always do. Leave the list empty to open it to everyone.
      </p>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-fg mb-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rostering is on
      </label>
      <label htmlFor="roster-pilot" className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Pilot teams: the TL's official email, one per line
      </label>
      <textarea
        id="roster-pilot"
        rows={3}
        value={pilot}
        onChange={(e) => setPilot(e.target.value)}
        className="w-full max-w-md border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-3 py-2 text-xs font-mono"
        placeholder="tl.dighe@thesleepcompany.in"
      />
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-900 text-white dark:bg-accent dark:text-on-accent disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
