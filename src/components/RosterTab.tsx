import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, Lock } from 'lucide-react';
import {
  RosterDayInfo,
  RosterEntryDTO,
  RosterMeResponse,
  RosterNotificationDTO,
  RosterSwapDTO,
  SwapCandidateDTO,
  addDays,
  bookingOutcome,
  dayLabel,
  dayProblem,
  weekEnd,
  weekStart,
} from '../shared/roster';
import { RosterApiError, newRequestId, rosterApi } from '../utils/rosterApi';
import { CARD } from './MetricTile';

interface RosterTabProps {
  getIdToken: () => Promise<string>;
  /** Staff opening an agent's roster (read-only). */
  agentEmail?: string;
  readOnly?: boolean;
  /** Called after a change, so the tab badge can refresh. */
  onChanged?: () => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CHIP: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  plApproved: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  closed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export const statusText = (e: Pick<RosterEntryDTO, 'status' | 'kind'>) =>
  e.status === 'pending' ? `${e.kind} · waiting for TL` : e.status === 'approved' ? e.kind : `${e.kind} · ${e.status}`;

export const chipClass = (e: Pick<RosterEntryDTO, 'status' | 'kind'>) =>
  e.status === 'pending' ? CHIP.pending : e.status === 'approved' ? (e.kind === 'PL' ? CHIP.plApproved : CHIP.approved) : CHIP.closed;

/** The agent's roster: a 3-week calendar for weekly offs, planned leave up to 60 days ahead, requests and inbox. */
export function RosterTab({ getIdToken, agentEmail, readOnly = false, onChanged }: RosterTabProps) {
  const [data, setData] = useState<RosterMeResponse | null>(null);
  const [error, setError] = useState<RosterApiError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<RosterNotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [swaps, setSwaps] = useState<RosterSwapDTO[]>([]);
  const [swapEntry, setSwapEntry] = useState<RosterEntryDTO | null>(null);
  const [candidates, setCandidates] = useState<SwapCandidateDTO[] | null>(null);
  const [partnerPick, setPartnerPick] = useState('');
  const [swapNote, setSwapNote] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await rosterApi<RosterMeResponse>(getIdToken, 'GET', `/api/roster/me${agentEmail ? `?agent=${encodeURIComponent(agentEmail)}` : ''}`);
      setData(me);
      setError(null);
      if (!readOnly) {
        const inbox = await rosterApi<{ items: RosterNotificationDTO[]; unread: number }>(getIdToken, 'GET', '/api/notifications?limit=15');
        setNotes(inbox.items);
        setUnread(inbox.unread);
        setSwaps((await rosterApi<{ items: RosterSwapDTO[] }>(getIdToken, 'GET', '/api/roster/swaps')).items);
      }
    } catch (err: any) {
      setError(err instanceof RosterApiError ? err : new RosterApiError(0, err?.message || 'Could not load the roster.'));
    }
  }, [getIdToken, agentEmail, readOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const dayInfo = useMemo(() => new Map((data?.days || []).map((d) => [d.day, d])), [data]);
  const active = useMemo(() => (data?.entries || []).filter((e) => e.status === 'pending' || e.status === 'approved'), [data]);
  const entryOn = (day: string) => active.find((e) => e.day === day);
  // weekly offs that are part of a swap request still waiting: they cannot be cancelled until it is settled
  const openSwapEntries = useMemo(() => {
    const ids = new Set<string>();
    for (const s of swaps) if (s.status === 'awaiting_partner' || s.status === 'awaiting_tl') { ids.add(s.requesterEntryId); ids.add(s.partnerEntryId); }
    return ids;
  }, [swaps]);

  const act = async (fn: () => Promise<{ message?: string } | void>, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const out = await fn();
      setMessage({ ok: true, text: (out && 'message' in out && out.message) || okText });
      setNote('');
      await load();
      onChanged?.();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  const book = (day: string, kind: 'WO' | 'PL') =>
    act(() => rosterApi(getIdToken, 'POST', '/api/roster/entries', { day, kind, requestId: newRequestId(), reason: note.trim() || undefined }), 'Saved.');
  const cancel = (e: RosterEntryDTO) => act(() => rosterApi(getIdToken, 'POST', `/api/roster/entries/${e.id}/cancel`, {}), 'Cancelled.');
  const startSwap = async (e: RosterEntryDTO) => {
    setSwapEntry(e);
    setCandidates(null);
    setPartnerPick('');
    setSwapNote('');
    setMessage(null);
    try {
      setCandidates((await rosterApi<{ candidates: SwapCandidateDTO[] }>(getIdToken, 'GET', `/api/roster/swap-candidates?entryId=${e.id}`)).candidates);
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Could not load colleagues to swap with.' });
      setSwapEntry(null);
    }
  };
  const sendSwap = () =>
    act(async () => {
      await rosterApi(getIdToken, 'POST', '/api/roster/swaps', { myEntryId: swapEntry!.id, partnerEntryId: partnerPick, requestId: newRequestId(), note: swapNote.trim() || undefined });
      setSwapEntry(null);
      return { message: 'Swap request sent. Your colleague has to accept, then your TL approves.' };
    }, 'Swap request sent.');
  const swapAction = (s: RosterSwapDTO, what: 'accept' | 'decline' | 'cancel') =>
    act(() => rosterApi(getIdToken, 'POST', `/api/roster/swaps/${s.id}/${what}`, {}), what === 'accept' ? 'Accepted. Your TL approves next.' : what === 'decline' ? 'Declined.' : 'Cancelled.');
  const markRead = async () => {
    try {
      await rosterApi(getIdToken, 'POST', '/api/notifications/read', {});
      await load();
      onChanged?.();
    } catch (_e) {
      /* the inbox is a convenience */
    }
  };

  if (error) {
    return (
      <div className={`${CARD} text-center text-sm`}>
        <p className="font-semibold text-slate-900 dark:text-fg">{error.status === 503 ? 'Rostering is temporarily unavailable.' : error.status === 404 ? 'Rostering is not switched on for you yet.' : error.message}</p>
        {error.status !== 404 && (
          <button onClick={load} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-900 text-white dark:bg-accent dark:text-on-accent">
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!data) return <div className={`${CARD} text-center text-xs text-slate-500 dark:text-slate-400`}>Loading the roster...</div>;

  const nowMs = Date.now();
  const weeks: string[] = [];
  for (let w = weekStart(data.today); w <= data.woLastDay; w = addDays(w, 7)) weeks.push(w);
  const weekWo = (day: string) => data.weeks.find((w) => w.weekStart === weekStart(day))?.woCount ?? 0;
  const sel = selected ? dayInfo.get(selected) : undefined;
  const selEntry = selected ? entryOn(selected) : undefined;
  const dayBlocked = (kind: 'WO' | 'PL') => (selected ? dayProblem(kind, selected, 'agent', nowMs) : null);
  const fullOnWeekday = Boolean(sel && !sel.weekend && sel.left === 0);

  return (
    <div className="space-y-6">
      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-accent" /> Roster{readOnly ? `: ${data.agentName}` : ''}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pick your weekly off for this week and the next 2 weeks (planned leave up to {dayLabel(data.plLastDay)}). Your first WO from Monday to Friday is confirmed at once while your team is under its limit. A Saturday or Sunday WO, a second WO in a week and all planned leave need your TL's approval.
          </p>
        </div>
        {!readOnly && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
            Changes this week: <strong className="text-slate-900 dark:text-fg">{data.changesThisWeek}</strong> of 3
          </span>
        )}
      </div>

      {message && (
        <div role="status" className={`rounded-lg px-4 py-2.5 text-xs font-semibold ${message.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
          {message.text}
        </div>
      )}

      <div className={CARD}>
        <div className="space-y-4">
          {weeks.map((w) => {
            const count = weekWo(w);
            return (
              <div key={w}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400">Week of {dayLabel(w)}</span>
                  <span className={`text-[11px] font-semibold ${count === 0 && weekEnd(w) >= data.today ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {count === 0 ? (weekEnd(w) >= data.today ? 'No WO yet: pick a day' : 'No WO') : `WO: ${count} this week`}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {WEEKDAYS.map((n, i) => (
                    <div key={n} className={`text-center text-[10px] uppercase tracking-wide font-bold ${i >= 5 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500'}`}>
                      {n}
                    </div>
                  ))}
                  {WEEKDAYS.map((_, i) => {
                    const day = addDays(w, i);
                    return <DayCell key={day} day={day} info={dayInfo.get(day)} entry={entryOn(day)} today={data.today} selected={selected === day} onSelect={() => setSelected(day)} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {!readOnly && (
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-line flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="roster-jump" className="font-semibold text-slate-600 dark:text-slate-300">
              Planned leave further ahead:
            </label>
            <input
              id="roster-jump"
              type="date"
              min={data.firstDay}
              max={data.plLastDay}
              value={selected && selected > data.woLastDay ? selected : ''}
              onChange={(e) => e.target.value && setSelected(e.target.value)}
              className="border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-2 py-1 text-xs"
            />
            <span className="text-slate-500 dark:text-slate-400">(up to {dayLabel(data.plLastDay)})</span>
          </div>
        )}
      </div>

      {selected && (
        <div className={CARD} aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-950 dark:text-fg">{dayLabel(selected)}</h3>
            {sel && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {sel.limit === null ? 'Your TL decides this day' : `Team limit ${sel.limit} · ${sel.used} off · ${sel.left} left`}
                {sel.pending > 0 ? ` · ${sel.pending} waiting` : ''}
              </span>
            )}
          </div>
          {selEntry ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${chipClass(selEntry)}`}>{statusText(selEntry)}</span>
              {selEntry.reason && <span className="text-xs text-slate-500 dark:text-slate-400">Note: {selEntry.reason}</span>}
              {!readOnly && !sel?.locked && openSwapEntries.has(selEntry.id) && (
                <span className="text-xs text-slate-500 dark:text-slate-400">In a swap request: settle it below first.</span>
              )}
              {!readOnly && !sel?.locked && !openSwapEntries.has(selEntry.id) && selEntry.kind === 'WO' && selEntry.status === 'approved' && (
                <button disabled={busy} onClick={() => startSwap(selEntry)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-line text-slate-700 dark:text-fg-2 hover:bg-slate-50 dark:hover:bg-hover disabled:opacity-50">
                  Swap with a colleague
                </button>
              )}
              {!readOnly && !sel?.locked && !openSwapEntries.has(selEntry.id) && (
                <button disabled={busy} onClick={() => cancel(selEntry)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-50">
                  Cancel
                </button>
              )}
              {!readOnly && sel?.locked && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <Lock className="w-3 h-3" /> Changes are closed for this day. Ask your TL.
                </span>
              )}
            </div>
          ) : readOnly ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No day off planned.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  disabled={busy || Boolean(dayBlocked('WO')) || fullOnWeekday || selected > data.woLastDay}
                  onClick={() => book(selected, 'WO')}
                  className="text-left rounded-xl border border-slate-200 dark:border-line p-3 hover:bg-slate-50 dark:hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="block text-sm font-bold text-slate-900 dark:text-fg">Take weekly off</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {selected > data.woLastDay
                      ? `Weekly offs open up to ${dayLabel(data.woLastDay)}.`
                      : dayBlocked('WO') || (fullOnWeekday ? "Team limit reached for this day. Pick another day, or ask your TL." : bookingOutcome('WO', selected, weekWo(selected)).why)}
                  </span>
                </button>
                <button
                  disabled={busy || Boolean(dayBlocked('PL')) || fullOnWeekday}
                  onClick={() => book(selected, 'PL')}
                  className="text-left rounded-xl border border-slate-200 dark:border-line p-3 hover:bg-slate-50 dark:hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="block text-sm font-bold text-slate-900 dark:text-fg">Request planned leave</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{dayBlocked('PL') || (fullOnWeekday ? 'Team limit reached for this day.' : bookingOutcome('PL', selected, 0).why)}</span>
                </button>
              </div>
              <div>
                <label htmlFor="roster-note" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Note for your TL (optional)
                </label>
                <input
                  id="roster-note"
                  value={note}
                  maxLength={300}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-3 py-1.5 text-xs"
                  placeholder="For example: family function"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {swapEntry && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-1">Swap your weekly off on {dayLabel(swapEntry.day)}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
            You can swap with a colleague of the same caller type and location, under the same team leader, in the same week. They have to accept, then your TL approves.
          </p>
          {candidates === null ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Looking for colleagues...</p>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Nobody can swap with you this week: no colleague of your type and team has a different weekly off in the same week.</p>
          ) : (
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Pick a colleague and their weekly off</legend>
              {candidates.map((c) => (
                <label key={c.entryId} className="flex items-center gap-2 text-xs text-slate-800 dark:text-fg cursor-pointer">
                  <input type="radio" name="swap-partner" value={c.entryId} checked={partnerPick === c.entryId} onChange={() => setPartnerPick(c.entryId)} />
                  <span className="font-semibold">{c.agentName}</span>
                  <span className="text-slate-500 dark:text-slate-400">has {dayLabel(c.day)} off</span>
                </label>
              ))}
            </fieldset>
          )}
          {candidates && candidates.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input value={swapNote} maxLength={300} onChange={(e) => setSwapNote(e.target.value)} placeholder="Note for your colleague (optional)" aria-label="Note for your colleague" className="flex-1 min-w-[14rem] border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-3 py-1.5 text-xs" />
              <button disabled={busy || !partnerPick} onClick={sendSwap} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-900 text-white dark:bg-accent dark:text-on-accent disabled:opacity-50">
                Send swap request
              </button>
            </div>
          )}
          <button onClick={() => setSwapEntry(null)} className="mt-3 text-xs text-slate-500 hover:underline">Close</button>
        </div>
      )}

      {!readOnly && swaps.length > 0 && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-3">Swaps</h3>
          <ul className="divide-y divide-slate-100 dark:divide-line">
            {swaps.map((s) => {
              const mineIsRequester = s.requesterEmail === data.agentEmail;
              const other = mineIsRequester ? s.partnerName : s.requesterName;
              const give = mineIsRequester ? s.requesterDay : s.partnerDay;
              const take = mineIsRequester ? s.partnerDay : s.requesterDay;
              const open = s.status === 'awaiting_partner' || s.status === 'awaiting_tl';
              return (
                <li key={s.id} className="py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-900 dark:text-fg">{mineIsRequester ? `You asked ${other}` : `${other} asked you`}</span>
                  <span className="text-slate-600 dark:text-slate-300">give {dayLabel(give)}, take {dayLabel(take)}</span>
                  <span className={`px-2 py-0.5 rounded font-bold ${open ? CHIP.pending : s.status === 'applied' ? CHIP.approved : CHIP.closed}`}>
                    {s.status === 'awaiting_partner' ? (mineIsRequester ? 'waiting for ' + other : 'waiting for you') : s.status === 'awaiting_tl' ? 'waiting for the TL' : s.status}
                  </span>
                  {s.decisionNote && <span className="text-slate-500 dark:text-slate-400">"{s.decisionNote}"</span>}
                  {s.failReason && <span className="text-slate-500 dark:text-slate-400">{s.failReason}</span>}
                  {s.status === 'awaiting_partner' && !mineIsRequester && (
                    <span className="ml-auto flex gap-2">
                      <button disabled={busy} onClick={() => swapAction(s, 'accept')} className="px-3 py-1 rounded-lg font-bold bg-brand-900 text-white dark:bg-accent dark:text-on-accent disabled:opacity-50">Accept</button>
                      <button disabled={busy} onClick={() => swapAction(s, 'decline')} className="px-3 py-1 rounded-lg font-bold border border-slate-300 dark:border-line disabled:opacity-50">Decline</button>
                    </span>
                  )}
                  {open && mineIsRequester && (
                    <button disabled={busy} onClick={() => swapAction(s, 'cancel')} className="ml-auto text-rose-700 dark:text-rose-300 font-semibold hover:underline disabled:opacity-50">Cancel request</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={CARD}>
        <h3 className="text-sm font-bold text-slate-950 dark:text-fg mb-3">My requests</h3>
        {data.entries.filter((e) => e.day >= data.today || e.status === 'pending').length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Nothing planned yet. Pick a day above.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-line">
            {data.entries
              .filter((e) => e.day >= data.today)
              .map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-mono font-semibold text-slate-900 dark:text-fg w-24">{dayLabel(e.day)}</span>
                  <span className={`px-2 py-0.5 rounded font-bold ${chipClass(e)}`}>{statusText(e)}</span>
                  {e.source !== 'self' && <span className="text-slate-500 dark:text-slate-400">set by {e.source === 'tl' ? 'your TL' : 'a manager'}</span>}
                  {e.decisionNote && <span className="text-slate-500 dark:text-slate-400">"{e.decisionNote}"</span>}
                  {!readOnly && (e.status === 'pending' || e.status === 'approved') && !openSwapEntries.has(e.id) && !(dayInfo.get(e.day)?.locked ?? true) && (
                    <button disabled={busy} onClick={() => cancel(e)} className="ml-auto text-rose-700 dark:text-rose-300 font-semibold hover:underline disabled:opacity-50">
                      Cancel
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      {!readOnly && (
        <div className={CARD}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-950 dark:text-fg flex items-center gap-2">
              <Bell className="w-4 h-4" /> Inbox {unread > 0 && <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold">{unread}</span>}
            </h3>
            {unread > 0 && (
              <button onClick={markRead} className="text-xs font-semibold text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notes.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No messages yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-line">
              {notes.map((n) => (
                <li key={n.id} className="py-2 text-xs">
                  <p className={`${n.read ? 'text-slate-600 dark:text-slate-300' : 'font-bold text-slate-950 dark:text-fg'}`}>
                    {!n.read && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-rose-600 mr-1.5 align-middle" />}
                    {n.title}
                  </p>
                  {n.body && <p className="text-slate-500 dark:text-slate-400">{n.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function DayCell({ day, info, entry, today, selected, onSelect }: { day: string; info?: RosterDayInfo; entry?: RosterEntryDTO; today: string; selected: boolean; onSelect: () => void }) {
  const past = day < today;
  const d = Number(day.slice(8));
  return (
    <button
      type="button"
      disabled={past || !info}
      onClick={onSelect}
      aria-label={`${dayLabel(day)}${entry ? `, ${statusText(entry)}` : ''}`}
      aria-pressed={selected}
      className={`min-h-[64px] sm:min-h-[76px] rounded-lg border p-1.5 text-left flex flex-col justify-between transition ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-slate-200 dark:border-line'
      } ${past ? 'opacity-40 cursor-default' : 'hover:bg-slate-50 dark:hover:bg-hover'} ${day === today ? 'bg-slate-50 dark:bg-raised' : ''}`}
    >
      <span className="flex items-center justify-between">
        <span className="text-xs font-bold font-mono text-slate-900 dark:text-fg">{d}</span>
        {info?.locked && !past && <Lock className="w-3 h-3 text-slate-400" aria-hidden />}
      </span>
      {entry ? (
        <span className={`rounded px-1 py-0.5 text-[10px] font-bold leading-tight ${chipClass(entry)}`}>{entry.status === 'pending' ? `${entry.kind} ?` : entry.kind}</span>
      ) : info && !past ? (
        <span className={`text-[10px] leading-tight ${info.weekend ? 'text-slate-400 dark:text-slate-500' : info.left === 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
          {info.weekend ? 'TL OK' : info.left === 0 ? 'Full' : `${info.left} left`}
        </span>
      ) : null}
    </button>
  );
}
