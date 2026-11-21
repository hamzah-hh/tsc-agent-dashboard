import { PushToggle } from './PushToggle';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, History, Users } from 'lucide-react';
import { RosterDayInfo, RosterEntryDTO, RosterSwapDTO, RosterTeamResponse, dayLabel, defaultWeekdayLimit, isWeekend } from '../shared/roster';
import { RosterApiError, newRequestId, rosterApi } from '../utils/rosterApi';
import { CARD } from './MetricTile';
import { CHIP, chipClass, statusText } from './RosterTab';

const CHIP_PENDING = CHIP.pending;
const CHIP_CLOSED = CHIP.closed;

interface StaffRosterTabProps {
  getIdToken: () => Promise<string>;
  userRole: 'superAdmin' | 'manager' | 'tl';
  /** Called after a change, so the tab badge can refresh. */
  onChanged?: () => void;
}

type TeamData = RosterTeamResponse & { teamKey: string };
interface ApprovalsData {
  entries: RosterEntryDTO[];
  loads: Record<string, { used: number; limit: number | null }>;
  count: number;
}
interface AuditItem {
  id: number;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  agentName: string | null;
  day: string | null;
  note: string | null;
  detail: Record<string, any>;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const input = 'border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-2 py-1 text-xs';
const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${btn} bg-brand-900 text-white dark:bg-accent dark:text-on-accent hover:bg-brand-800 dark:hover:bg-accent-hover`;
const outline = `${btn} border border-slate-300 dark:border-line text-slate-700 dark:text-fg-2 hover:bg-slate-50 dark:hover:bg-hover`;
const danger = `${btn} border border-rose-300 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10`;

/** The TL's (or a manager's) view: team grid, limits, approvals, history. */
export function StaffRosterTab({ getIdToken, userRole, onChanged }: StaffRosterTabProps) {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [approvals, setApprovals] = useState<ApprovalsData | null>(null);
  const [swaps, setSwaps] = useState<RosterSwapDTO[]>([]);
  const [rejectingSwap, setRejectingSwap] = useState<string | null>(null);
  const [error, setError] = useState<RosterApiError | null>(null);
  const [teamKey, setTeamKey] = useState('');
  const [cell, setCell] = useState<{ email: string; day: string } | null>(null);
  const [limitDay, setLimitDay] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState('');
  const [allDaysValue, setAllDaysValue] = useState('');
  const [note, setNote] = useState('');
  const [override, setOverride] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [audit, setAudit] = useState<AuditItem[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await rosterApi<TeamData>(getIdToken, 'GET', `/api/roster/team${teamKey ? `?team=${encodeURIComponent(teamKey)}` : ''}`);
      setTeam(t);
      setAllDaysValue(t.allDaysLimit === null ? '' : String(t.allDaysLimit));
      if (!teamKey) setTeamKey(t.teamKey);
      setApprovals(await rosterApi<ApprovalsData>(getIdToken, 'GET', '/api/roster/approvals'));
      setSwaps((await rosterApi<{ items: RosterSwapDTO[] }>(getIdToken, 'GET', '/api/roster/swaps')).items);
      setError(null);
    } catch (err: any) {
      setError(err instanceof RosterApiError ? err : new RosterApiError(0, err?.message || 'Could not load the roster.'));
    }
  }, [getIdToken, teamKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!showAudit) return;
    rosterApi<{ items: AuditItem[] }>(getIdToken, 'GET', '/api/roster/audit')
      .then((r) => setAudit(r.items))
      .catch(() => setAudit([]));
  }, [showAudit, getIdToken, team]);

  const days = team?.days || [];
  const dayMap = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);
  const byAgentDay = useMemo(() => {
    const m = new Map<string, RosterEntryDTO>();
    for (const e of team?.entries || []) if (e.status === 'pending' || e.status === 'approved') m.set(`${e.agentEmail}|${e.day}`, e);
    return m;
  }, [team]);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: okText });
      setNote('');
      setOverride(false);
      setRejecting(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  const decide = (e: RosterEntryDTO, decision: 'approve' | 'reject', withOverride = false) =>
    run(() => rosterApi(getIdToken, 'POST', `/api/roster/entries/${e.id}/decision`, { decision, note: note.trim() || undefined, override: withOverride || undefined }), decision === 'approve' ? 'Approved.' : 'Rejected.');
  const decideSwap = (s: RosterSwapDTO, decision: 'approve' | 'reject') =>
    run(() => rosterApi(getIdToken, 'POST', `/api/roster/swaps/${s.id}/decision`, { decision, note: note.trim() || undefined }), decision === 'approve' ? 'Swap approved: the two weekly offs have traded places.' : 'Swap rejected.');
  const revoke = (e: RosterEntryDTO) => run(() => rosterApi(getIdToken, 'POST', `/api/roster/entries/${e.id}/revoke`, { note: note.trim() }), 'Revoked.');
  const setDayOff = (email: string, day: string, kind: 'WO' | 'PL') =>
    run(() => rosterApi(getIdToken, 'POST', '/api/roster/entries', { agentEmail: email, day, kind, requestId: newRequestId(), reason: note.trim() || undefined, override: override || undefined }), 'Saved.');
  const saveLimit = (day: string | null, value: string) =>
    run(() => rosterApi(getIdToken, 'PUT', '/api/roster/limits', { team: team?.teamKey, day, maxInactive: Number(value), note: note.trim() || undefined }), 'Limit saved.');
  const clearLimit = (day: string | null) =>
    run(() => rosterApi(getIdToken, 'DELETE', `/api/roster/limits?team=${encodeURIComponent(team?.teamKey || '')}${day ? `&day=${day}` : ''}`), 'Limit cleared.');

  const exportCsv = async () => {
    try {
      const res = await fetch('/api/roster/export', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      if (!res.ok) throw new Error('Could not export.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `roster_${team?.today || 'export'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Could not export.' });
    }
  };

  if (error) {
    return (
      <div className={`${CARD} text-center text-sm`}>
        <p className="font-semibold text-slate-900 dark:text-fg">{error.status === 503 ? 'Rostering is temporarily unavailable.' : error.status === 404 ? 'Rostering is not switched on for your team yet.' : error.message}</p>
        {error.status !== 404 && <button onClick={load} className={`${primary} mt-3`}>Try again</button>}
      </div>
    );
  }
  if (!team) return <div className={`${CARD} text-center text-xs text-slate-500 dark:text-slate-400`}>Loading the team roster...</div>;

  const pendingList = approvals?.entries || [];
  const selEntry = cell ? byAgentDay.get(`${cell.email}|${cell.day}`) : undefined;
  const selInfo = cell ? dayMap.get(cell.day) : undefined;
  const selAgent = cell ? team.agents.find((a) => a.email === cell.email) : undefined;
  const limitInfo: RosterDayInfo | undefined = limitDay ? dayMap.get(limitDay) : undefined;
  const isManager = userRole !== 'tl';

  return (
    <div className="space-y-6">
      <PushToggle getIdToken={getIdToken} />

      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Team roster
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {team.teamSize} agents. Set how many may be off each day (weekly offs and planned leave together), approve requests, and see who is off.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && team.teamKeys.length > 1 && (
            <select value={team.teamKey} onChange={(e) => { setTeamKey(e.target.value); setCell(null); setLimitDay(null); }} className={input} aria-label="Team">
              {team.teamKeys.map((k) => (
                <option key={k} value={k}>{k.startsWith('loc:') ? `${k.slice(4)} (no TL)` : k}</option>
              ))}
            </select>
          )}
          <button onClick={exportCsv} className={`${outline} inline-flex items-center gap-1.5`}><Download className="w-3.5 h-3.5" /> Export CSV</button>
          <button onClick={() => setShowAudit((v) => !v)} className={`${outline} inline-flex items-center gap-1.5`}><History className="w-3.5 h-3.5" /> History</button>
        </div>
      </div>

      {message && (
        <div role="status" className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${message.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>{message.text}</div>
      )}
      {team.feasibility && (
        <div className="rounded-lg px-4 py-2.5 text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {team.feasibility}
        </div>
      )}

      <div className={CARD}>
        <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-3">
          Waiting for you {pendingList.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">{pendingList.length}</span>}
        </h3>
        {pendingList.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Nothing waiting. Weekly offs within the limit are confirmed automatically.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-line">
            {pendingList.map((e) => {
              const load = approvals?.loads[e.id];
              // A pending weekday request already holds its slot; a pending weekend request holds none until approved
              const after = load ? (isWeekend(e.day) ? load.used + 1 : load.used) : 0;
              const full = Boolean(load && load.limit !== null && after > load.limit);
              return (
                <li key={e.id} className="py-3 flex flex-col gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold text-slate-950 dark:text-fg">{e.agentName}</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{dayLabel(e.day)}</span>
                    <span className={`px-2 py-0.5 rounded font-bold ${chipClass(e)}`}>{e.kind === 'PL' ? 'Planned leave' : 'Weekly off'}</span>
                    {load && <span className={full ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}>{load.limit === null ? `${after} off that day if approved (no limit set)` : `${after} of ${load.limit} off that day if approved`}</span>}
                    {e.reason && <span className="text-slate-500 dark:text-slate-400">"{e.reason}"</span>}
                  </div>
                  {rejecting === e.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why? (the agent sees this)" maxLength={300} className={`${input} flex-1 min-w-[12rem]`} aria-label="Reason for rejecting" />
                      <button disabled={busy || !note.trim()} onClick={() => decide(e, 'reject')} className={danger}>Reject</button>
                      <button onClick={() => { setRejecting(null); setNote(''); }} className={outline}>Back</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button disabled={busy || Boolean(full)} onClick={() => decide(e, 'approve')} className={primary}>Approve</button>
                      {full && (
                        <>
                          <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Reason to go over the limit" maxLength={300} className={`${input} min-w-[12rem]`} aria-label="Reason for approving over the limit" />
                          <button disabled={busy || !note.trim()} onClick={() => decide(e, 'approve', true)} className={outline}>Approve over the limit</button>
                        </>
                      )}
                      <button disabled={busy} onClick={() => { setRejecting(e.id); setNote(''); }} className={outline}>Reject</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {swaps.some((s) => s.status === 'awaiting_tl' || s.status === 'awaiting_partner') && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-3">
            Swaps {swaps.filter((s) => s.status === 'awaiting_tl').length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">{swaps.filter((s) => s.status === 'awaiting_tl').length}</span>}
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-line">
            {swaps.filter((s) => s.status === 'awaiting_tl' || s.status === 'awaiting_partner').map((s) => (
              <li key={s.id} className="py-3 text-xs space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold text-slate-950 dark:text-fg">{s.requesterName} and {s.partnerName}</span>
                  <span className="text-slate-700 dark:text-slate-300">{s.requesterName} gives {dayLabel(s.requesterDay)} and takes {dayLabel(s.partnerDay)}; {s.partnerName} the other way round</span>
                  <span className={`px-2 py-0.5 rounded font-bold ${s.status === 'awaiting_tl' ? CHIP_PENDING : CHIP_CLOSED}`}>{s.status === 'awaiting_tl' ? 'both agreed' : 'waiting for ' + s.partnerName}</span>
                  {s.note && <span className="text-slate-500 dark:text-slate-400">"{s.note}"</span>}
                </div>
                {s.status === 'awaiting_tl' &&
                  (rejectingSwap === s.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why? (both agents see this)" maxLength={300} className={`${input} flex-1 min-w-[12rem]`} aria-label="Reason for rejecting the swap" />
                      <button disabled={busy || !note.trim()} onClick={() => decideSwap(s, 'reject').then(() => setRejectingSwap(null))} className={danger}>Reject</button>
                      <button onClick={() => { setRejectingSwap(null); setNote(''); }} className={outline}>Back</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busy} onClick={() => decideSwap(s, 'approve')} className={primary}>Approve swap</button>
                      <button disabled={busy} onClick={() => { setRejectingSwap(s.id); setNote(''); }} className={outline}>Reject</button>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">A swap does not change how many are off on either day.</p>
        </div>
      )}

      <div className={CARD}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label htmlFor="limit-all" className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Limit for every day</label>
            <div className="flex items-center gap-2">
              <input id="limit-all" type="number" min={0} max={200} value={allDaysValue} onChange={(e) => setAllDaysValue(e.target.value)} placeholder={String(defaultWeekdayLimit(team.teamSize))} className={`${input} w-20`} />
              <button disabled={busy || allDaysValue === ''} onClick={() => saveLimit(null, allDaysValue)} className={primary}>Save</button>
              {team.allDaysLimit !== null && <button disabled={busy} onClick={() => clearLimit(null)} className={outline}>Clear</button>}
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md">
            Without a limit, weekdays allow {defaultWeekdayLimit(team.teamSize)} off at a time (team size / 5, rounded up) and weekends need your approval each time. Click a date in the grid to set a limit for that date.
          </p>
        </div>

        {limitDay && (
          <div className="mb-4 rounded-lg border border-slate-200 dark:border-line p-3 flex flex-wrap items-end gap-3">
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Limit for {dayLabel(limitDay)}</span>
              <input type="number" min={0} max={200} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className={`${input} w-20`} aria-label={`Limit for ${dayLabel(limitDay)}`} />
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Now: {limitInfo?.limit === null || limitInfo?.limit === undefined ? 'no limit' : `${limitInfo.limit} (${limitInfo.limitSource})`}, {limitInfo?.used ?? 0} off
            </span>
            <button disabled={busy || limitValue === ''} onClick={() => saveLimit(limitDay, limitValue).then(() => setLimitDay(null))} className={primary}>Save</button>
            {limitInfo?.limitSource === 'date' && <button disabled={busy} onClick={() => clearLimit(limitDay).then(() => setLimitDay(null))} className={outline}>Clear</button>}
            <button onClick={() => setLimitDay(null)} className={outline}>Close</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white dark:bg-panel text-left px-2 py-1 font-bold text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wide">Agent</th>
                {days.map((d) => {
                  const dow = (new Date(d.day + 'T00:00:00Z').getUTCDay() + 6) % 7;
                  return (
                    <th key={d.day} className={`px-1 py-1 text-center font-semibold min-w-[3.25rem] ${d.weekend ? 'bg-slate-50 dark:bg-raised' : ''} ${d.day === team.today ? 'border-b-2 border-accent' : ''}`}>
                      <button
                        type="button"
                        onClick={() => { setLimitDay(d.day); setLimitValue(d.limit === null ? '' : String(d.limit)); setCell(null); }}
                        className="w-full hover:bg-slate-100 dark:hover:bg-hover rounded px-1 py-0.5"
                        title={`Set the limit for ${dayLabel(d.day)}`}
                      >
                        <span className="block text-[10px] uppercase text-slate-500 dark:text-slate-400">{WEEKDAYS[dow]}</span>
                        <span className="block font-mono text-slate-900 dark:text-fg">{Number(d.day.slice(8))}</span>
                        <span className={`block text-[10px] ${d.overBooked ? 'text-rose-600 dark:text-rose-400 font-bold' : d.limit !== null && d.used >= d.limit ? 'text-amber-700 dark:text-amber-300 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                          {d.limit === null ? `${d.used} off` : `${d.used}/${d.limit}`}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {team.agents.map((a) => (
                <tr key={a.email} className="border-t border-slate-100 dark:border-line">
                  <td className="sticky left-0 z-10 bg-white dark:bg-panel px-2 py-1 whitespace-nowrap font-semibold text-slate-900 dark:text-fg">{a.name}</td>
                  {days.map((d) => {
                    const e = byAgentDay.get(`${a.email}|${d.day}`);
                    const selected = cell?.email === a.email && cell.day === d.day;
                    const past = d.day < team.today;
                    return (
                      <td key={d.day} className={`p-0.5 text-center ${d.weekend ? 'bg-slate-50 dark:bg-raised' : ''}`}>
                        <button
                          type="button"
                          disabled={past}
                          onClick={() => { setCell({ email: a.email, day: d.day }); setLimitDay(null); setNote(''); setOverride(false); }}
                          aria-label={`${a.name}, ${dayLabel(d.day)}${e ? `, ${statusText(e)}` : ''}`}
                          className={`w-full h-7 rounded text-[10px] font-bold ${selected ? 'ring-1 ring-accent' : ''} ${past ? 'opacity-40' : 'hover:bg-slate-100 dark:hover:bg-hover'}`}
                        >
                          {e ? <span className={`inline-block px-1 rounded ${chipClass(e)}`}>{e.status === 'pending' ? `${e.kind}?` : e.kind}</span> : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">WO = weekly off, PL = planned leave, ? = waiting for you. The number under a date is how many are off against the limit.</p>

        {cell && selAgent && selInfo && (
          <div className="mt-4 rounded-lg border border-slate-200 dark:border-line p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="font-bold text-slate-950 dark:text-fg">{selAgent.name}</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">{dayLabel(cell.day)}</span>
              {selEntry && <span className={`px-2 py-0.5 rounded font-bold ${chipClass(selEntry)}`}>{statusText(selEntry)}</span>}
              <button onClick={() => setCell(null)} className="ml-auto text-slate-500 hover:underline">Close</button>
            </div>
            {selEntry?.reason && <p className="text-xs text-slate-500 dark:text-slate-400">Note: {selEntry.reason}</p>}
            {selEntry ? (
              selEntry.status === 'pending' ? (
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy} onClick={() => decide(selEntry, 'approve', override)} className={primary}>Approve</button>
                  <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Reason (needed to reject or go over the limit)" maxLength={300} className={`${input} flex-1 min-w-[14rem]`} aria-label="Reason" />
                  <label className="text-[11px] flex items-center gap-1 text-slate-600 dark:text-slate-300"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> over the limit</label>
                  <button disabled={busy || !note.trim()} onClick={() => decide(selEntry, 'reject')} className={danger}>Reject</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why are you withdrawing it?" maxLength={300} className={`${input} flex-1 min-w-[14rem]`} aria-label="Reason" />
                  <button disabled={busy || !note.trim()} onClick={() => revoke(selEntry)} className={danger}>Revoke</button>
                </div>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={userRole === 'tl' ? 'Note (optional)' : 'Why? (needed when acting for an agent)'} maxLength={300} className={`${input} flex-1 min-w-[14rem]`} aria-label="Note" />
                  {selInfo.limit !== null && selInfo.used >= selInfo.limit && (
                    <label className="text-[11px] flex items-center gap-1 text-slate-600 dark:text-slate-300"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> go over the limit ({selInfo.used} of {selInfo.limit})</label>
                  )}
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => setDayOff(cell.email, cell.day, 'WO')} className={primary}>Set weekly off</button>
                  <button disabled={busy} onClick={() => setDayOff(cell.email, cell.day, 'PL')} className={outline}>Set planned leave</button>
                </div>
              </div>
            )}
          </div>
        )}

        {team.noWo.some((w) => w.agents.length > 0) && (
          <div className="mt-4 text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <p className="font-bold text-slate-950 dark:text-fg">No weekly off yet</p>
            {team.noWo.filter((w) => w.agents.length > 0).map((w) => (
              <p key={w.weekStart}><span className="font-mono">Week of {dayLabel(w.weekStart)}:</span> {w.agents.join(', ')}</p>
            ))}
          </div>
        )}
      </div>

      {showAudit && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-3">History</h3>
          {!audit ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Loading...</p>
          ) : audit.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Nothing yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-white dark:bg-panel text-slate-500 dark:text-slate-400">
                  <tr><th className="py-1 pr-3">When (UTC)</th><th className="py-1 pr-3">Who</th><th className="py-1 pr-3">Did</th><th className="py-1 pr-3">Agent</th><th className="py-1 pr-3">Day</th><th className="py-1">Note</th></tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100 dark:border-line">
                      <td className="py-1 pr-3 font-mono whitespace-nowrap">{a.at.replace('T', ' ').slice(0, 16)}</td>
                      <td className="py-1 pr-3">{a.actor} <span className="text-slate-400">({a.actorRole})</span></td>
                      <td className="py-1 pr-3 font-semibold">{a.action.replace('_', ' ')}{a.detail?.maxInactive !== undefined ? ` ${a.detail.maxInactive}` : ''}</td>
                      <td className="py-1 pr-3">{a.agentName || ''}</td>
                      <td className="py-1 pr-3 font-mono">{a.day ? dayLabel(a.day) : ''}</td>
                      <td className="py-1">{a.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
