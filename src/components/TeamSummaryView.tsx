import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Coffee, Gauge, RefreshCw, Target, X } from 'lucide-react';
import { formatCurrencyINR, formatNumberINR } from '../shared/incentive';
import {
  BREAK_COLUMNS,
  BreakDay,
  BreakMetric,
  PRODUCTIVITY_RULES,
  ProductivityDay,
  TeamSummaryAgent,
  TeamSummaryResponse,
  TargetRow,
  hms,
  idleAcwPct,
  nameFromEmail,
} from '../shared/teamOps';

interface TeamSummaryViewProps {
  userRole: 'superAdmin' | 'manager' | 'tl';
  getIdToken: () => Promise<string>;
}

const RED = 'text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/40';
const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs';
// Headers wrap ("Avg Unique Connects / Agent / Day" on two lines) so the tables fit without scrolling
const th = 'py-2 px-2 text-[10px] uppercase tracking-wide leading-tight text-slate-500 dark:text-slate-400 font-bold align-bottom';
const td = 'py-2 px-2 whitespace-nowrap tabular-nums';

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (d: number) => (d === 1 ? 'Full Day' : d === 0.5 ? 'Half Day' : String(d));
const fmt1 = (n: number | null) => (n === null || !Number.isFinite(n) ? '-' : formatNumberINR(n, 1));

// ------------------------------------------------------------------ calculations

interface ProdStats {
  agents: number;
  agentDays: number; // sum of Day_Type
  avgConnects: number | null;
  avgTalk: number | null;
  daysLowConnects: number;
  daysLowTalk: number;
}

function prodStats(days: ProductivityDay[]): ProdStats {
  const agentDays = days.reduce((s, d) => s + d.day, 0);
  const connects = days.reduce((s, d) => s + d.connects, 0);
  const talk = days.reduce((s, d) => s + d.talkSeconds, 0);
  return {
    agents: new Set(days.map((d) => d.agentEmail)).size,
    agentDays,
    avgConnects: agentDays > 0 ? connects / agentDays : null,
    avgTalk: agentDays > 0 ? talk / agentDays : null,
    daysLowConnects: days.filter((d) => lowConnects(d.connects, d.day)).length,
    daysLowTalk: days.filter((d) => lowTalk(d.talkSeconds, d.day)).length,
  };
}

// A half day needs half the daily minimum
const lowConnects = (value: number | null, day = 1) => value !== null && value < PRODUCTIVITY_RULES.minUniqueConnectsPerDay * day;
// Times are compared in whole seconds, as shown (hh:mm:ss), so a red value never displays as equal to the limit
const lowTalk = (value: number | null, day = 1) => value !== null && Math.round(value) < PRODUCTIVITY_RULES.minTalkSecondsPerDay * day;

type BreakAverages = Record<BreakMetric, number | null> & { days: number; agents: number; daysOver: number };

function overLimit(key: BreakMetric, value: number | null): boolean {
  const col = BREAK_COLUMNS.find((c) => c.key === key)!;
  if (value === null) return false;
  if (col.limitSec !== undefined) return Math.round(value) > col.limitSec;
  if (col.limitPct !== undefined) return value > col.limitPct;
  return false;
}

function dayOverAnyLimit(b: BreakDay): boolean {
  return (
    BREAK_COLUMNS.some((c) => c.limitSec !== undefined && overLimit(c.key, (b as any)[c.key])) ||
    overLimit('idleAcwPct', idleAcwPct(b.idleAcw, b.staffed))
  );
}

/** Averages per agent per day; Idle Time and ACW % is total idle + ACW over total staffed time. */
function breakAverages(rows: BreakDay[]): BreakAverages {
  const n = rows.length;
  const avg = (k: keyof BreakDay) => (n > 0 ? rows.reduce((s, r) => s + (r[k] as number), 0) / n : null);
  const idleAcw = rows.reduce((s, r) => s + r.idleAcw, 0);
  const staffed = rows.reduce((s, r) => s + r.staffed, 0);
  return {
    bio: avg('bio'),
    first: avg('first'),
    lunch: avg('lunch'),
    last: avg('last'),
    total: avg('total'),
    idleAcw: avg('idleAcw'),
    staffed: avg('staffed'),
    idleAcwPct: idleAcwPct(idleAcw, staffed),
    days: n,
    agents: new Set(rows.map((r) => r.agentEmail)).size,
    daysOver: rows.filter(dayOverAnyLimit).length,
  };
}

const breakText = (key: BreakMetric, value: number | null) => (key === 'idleAcwPct' ? (value === null ? '-' : `${value.toFixed(2)}%`) : hms(value));

function useExclusions() {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const toggle = (email: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  return { excluded, toggle, reset: () => setExcluded(new Set()) };
}

function ExcludedNote({ count, onReset }: { count: number; onReset: () => void }) {
  return (
    <p className="px-5 pb-3 text-[11px] text-slate-500 dark:text-slate-400">
      {count > 0 ? (
        <>
          {count} agent{count > 1 ? 's' : ''} left out of the averages.{' '}
          <button onClick={onReset} className="font-bold text-indigo-600 dark:text-indigo-300 hover:underline">
            Include everyone again
          </button>
        </>
      ) : (
        'Open a team and untick an agent to see the averages without them.'
      )}
    </p>
  );
}

function DrillSummary({ items }: { items: Array<{ label: string; value: string; red?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-bold leading-tight">{i.label}</p>
          <p className={`text-sm font-bold tabular-nums ${i.red ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{i.value}</p>
        </div>
      ))}
    </div>
  );
}

function breakCell(key: BreakMetric, value: number | null) {
  const text = key === 'idleAcwPct' ? (value === null ? '-' : `${value.toFixed(2)}%`) : hms(value);
  return <td className={`${td} text-right ${overLimit(key, value) ? RED : 'text-slate-800 dark:text-slate-200'}`}>{text}</td>;
}

// ------------------------------------------------------------------ page

export function TeamSummaryView({ userRole, getIdToken }: TeamSummaryViewProps) {
  const [data, setData] = useState<TeamSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/team-summary', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Could not load the team summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The newest day with data: the default end of the range
  const latest = useMemo(() => {
    if (!data) return '';
    let max = '';
    for (const d of data.productivity) if (d.date > max) max = d.date;
    for (const b of data.breaks) if (b.date > max) max = b.date;
    return max || data.cycle.startDate;
  }, [data]);

  useEffect(() => {
    if (data && !from) {
      setFrom(data.cycle.startDate);
      setTo(latest);
    }
  }, [data, latest, from]);

  const agentsByEmail = useMemo(() => new Map((data?.agents || []).map((a) => [a.officialEmail.toLowerCase(), a])), [data]);
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const productivity = useMemo(() => (data?.productivity || []).filter((d) => inRange(d.date)), [data, from, to]);
  const breaks = useMemo(() => (data?.breaks || []).filter((b) => inRange(b.date)), [data, from, to]);

  if (loading) {
    return <div className={`${card} p-10 text-center text-xs text-slate-500`}>Loading the team summary...</div>;
  }
  if (error || !data) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
          Retry
        </button>
      </div>
    );
  }

  const presets: Array<[string, string, string]> = [
    ['Cycle to date', data.cycle.startDate, latest],
    ['Last 7 days', addDays(latest, -6) < data.cycle.startDate ? data.cycle.startDate : addDays(latest, -6), latest],
    ['Latest day', latest, latest],
  ];

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4`}>
        <div>
          <h2 className="text-lg font-bold text-slate-950 dark:text-white">Overall Team Summary and Targets</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {userRole === 'tl' ? 'Your team' : 'All teams'} · {data.cycle.name} · Dialer, Breaks and Targets tabs of the sheet
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {presets.map(([label, f, t]) => (
            <button
              key={label}
              onClick={() => {
                setFrom(f);
                setTo(t);
              }}
              className={`px-3 py-1.5 rounded-lg font-semibold border transition ${
                from === f && to === t
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
          <input type="date" value={from} min={data.cycle.startDate} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-white rounded-lg px-2 py-1.5" aria-label="From" />
          <span className="text-slate-400">to</span>
          <input type="date" value={to} min={from || undefined} max={data.cycle.endDate} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-white rounded-lg px-2 py-1.5" aria-label="To" />
          <button onClick={load} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Reload">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <ProductivitySection agents={data.agents} days={productivity} agentsByEmail={agentsByEmail} />
      <BreaksSection agents={data.agents} rows={breaks} agentsByEmail={agentsByEmail} hasData={data.breaks.length > 0} />
      <TargetsSection targets={data.targets} agents={data.agents} cycle={data.cycle} />
    </div>
  );
}

// ------------------------------------------------------------------ 1. Average Productivity

export function ProductivitySection({
  agents,
  days,
  agentsByEmail,
}: {
  agents: TeamSummaryAgent[];
  days: ProductivityDay[];
  agentsByEmail: Map<string, TeamSummaryAgent>;
}) {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [drillAgent, setDrillAgent] = useState<string | null>(null);
  const { excluded, toggle, reset } = useExclusions();

  // A team is a TL's agents (Pre Sales has no Dialer data)
  const teams = useMemo(() => {
    const m = new Map<string, { tl: string; location: string; emails: Set<string> }>();
    for (const a of agents) {
      if (a.agentType === 'PRE_SALES') continue;
      const tl = (a.tlOfficialEmail || '').toLowerCase() || `no-tl:${a.location}`;
      if (!m.has(tl)) m.set(tl, { tl, location: a.location, emails: new Set() });
      m.get(tl)!.emails.add(a.officialEmail.toLowerCase());
    }
    return [...m.values()].sort((x, y) => x.location.localeCompare(y.location));
  }, [agents]);
  // Teams with Dialer days in the chosen range, with their numbers
  const activeDays = days.filter((d) => !excluded.has(d.agentEmail.toLowerCase()));
  const shown = teams
    .filter((t) => days.some((d) => t.emails.has(d.agentEmail.toLowerCase())))
    .map((t) => ({ ...t, s: prodStats(activeDays.filter((d) => t.emails.has(d.agentEmail.toLowerCase()))) }));

  const overall = prodStats(activeDays);
  const drillDays = drillAgent ? days.filter((d) => d.agentEmail.toLowerCase() === drillAgent).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const drillStats = prodStats(drillDays);

  return (
    <section className={card}>
      <SectionHeader
        icon={<Gauge className="w-4 h-4 text-indigo-500" />}
        title="Average Productivity"
        note={`Per agent per worked day, from the Dialer tab. Red: below ${PRODUCTIVITY_RULES.minUniqueConnectsPerDay} unique connects or below ${hms(PRODUCTIVITY_RULES.minTalkSecondsPerDay)} talk time (half for a half day).`}
      />
      <ExcludedNote count={excluded.size} onReset={reset} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className={th}>Team</th>
              <th className={`${th} text-right`}>Agents</th>
              <th className={`${th} text-right`}>Agent-days</th>
              <th className={`${th} text-right`}>Avg Unique Connects / Agent / Day</th>
              <th className={`${th} text-right`}>Avg Talk Time / Agent / Day</th>
              <th className={`${th} text-right`}>Days Below Connects</th>
              <th className={`${th} text-right`}>Days Below Talk Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((t) => {
              const s = t.s;
              const open = openTeam === t.tl;
              return (
                <React.Fragment key={t.tl}>
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setOpenTeam(open ? null : t.tl)}>
                    <td className={`${td} font-semibold text-slate-900 dark:text-white`}>
                      <span className="inline-flex items-center gap-1.5">
                        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {t.location} · {t.tl.startsWith('no-tl:') ? 'No TL' : nameFromEmail(t.tl)}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>{s.agents}</td>
                    <td className={`${td} text-right`}>{fmt1(s.agentDays)}</td>
                    <td className={`${td} text-right ${lowConnects(s.avgConnects) ? RED : ''}`}>{fmt1(s.avgConnects)}</td>
                    <td className={`${td} text-right ${lowTalk(s.avgTalk) ? RED : ''}`}>{hms(s.avgTalk)}</td>
                    <td className={`${td} text-right`}>{s.daysLowConnects}</td>
                    <td className={`${td} text-right`}>{s.daysLowTalk}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/70 dark:bg-slate-950/40 px-3 py-3">
                        <AgentProductivityTable
                          emails={[...t.emails]}
                          days={days}
                          agentsByEmail={agentsByEmail}
                          excluded={excluded}
                          onToggle={toggle}
                          onOpen={(email) => setDrillAgent(email)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {shown.length > 1 && (
              <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold">
                <td className={`${td} text-slate-900 dark:text-white`}>All teams</td>
                <td className={`${td} text-right`}>{overall.agents}</td>
                <td className={`${td} text-right`}>{fmt1(overall.agentDays)}</td>
                <td className={`${td} text-right ${lowConnects(overall.avgConnects) ? RED : ''}`}>{fmt1(overall.avgConnects)}</td>
                <td className={`${td} text-right ${lowTalk(overall.avgTalk) ? RED : ''}`}>{hms(overall.avgTalk)}</td>
                <td className={`${td} text-right`}>{overall.daysLowConnects}</td>
                <td className={`${td} text-right`}>{overall.daysLowTalk}</td>
              </tr>
            )}
            {shown.length === 0 && <EmptyRow cols={7} text="No Dialer data for this range." />}
          </tbody>
        </table>
      </div>

      {drillAgent && (
        <DrillDown title={agentsByEmail.get(drillAgent)?.name || drillAgent} subtitle="Daily Dialer data" onClose={() => setDrillAgent(null)}>
          <DrillSummary
            items={[
              { label: 'Days worked', value: fmt1(drillStats.agentDays) },
              { label: 'Avg Unique Connects / Day', value: fmt1(drillStats.avgConnects), red: lowConnects(drillStats.avgConnects) },
              { label: 'Avg Talk Time / Day', value: hms(drillStats.avgTalk), red: lowTalk(drillStats.avgTalk) },
              { label: 'Days Below Connects', value: String(drillStats.daysLowConnects) },
              { label: 'Days Below Talk Time', value: String(drillStats.daysLowTalk) },
            ]}
          />
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Day Type</th>
                <th className={`${th} text-right`}>Unique Connects</th>
                <th className={`${th} text-right`}>Talk Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {drillDays.map((d) => (
                <tr key={d.date}>
                  <td className={`${td}`}>{d.date}</td>
                  <td className={td}>{dayLabel(d.day)}</td>
                  <td className={`${td} text-right ${lowConnects(d.connects, d.day) ? RED : ''}`}>{d.connects}</td>
                  <td className={`${td} text-right ${lowTalk(d.talkSeconds, d.day) ? RED : ''}`}>{hms(d.talkSeconds)}</td>
                </tr>
              ))}
              {drillDays.length === 0 && <EmptyRow cols={4} text="No Dialer days in this range." />}
            </tbody>
          </table>
        </DrillDown>
      )}
    </section>
  );
}

function AgentProductivityTable({
  emails,
  days,
  agentsByEmail,
  excluded,
  onToggle,
  onOpen,
}: {
  emails: string[];
  days: ProductivityDay[];
  agentsByEmail: Map<string, TeamSummaryAgent>;
  excluded: Set<string>;
  onToggle: (email: string) => void;
  onOpen: (email: string) => void;
}) {
  const rows = emails
    .map((e) => ({ email: e, name: agentsByEmail.get(e)?.name || e, s: prodStats(days.filter((d) => d.agentEmail.toLowerCase() === e)) }))
    .sort((a, b) => (a.s.avgConnects ?? Infinity) - (b.s.avgConnects ?? Infinity));
  return (
    <table className="w-full text-xs text-left bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th} title="Untick to leave an agent out of the averages">Include</th>
          <th className={th}>Agent (click for daily data)</th>
          <th className={`${th} text-right`}>Days</th>
          <th className={`${th} text-right`}>Avg Unique Connects / Day</th>
          <th className={`${th} text-right`}>Avg Talk Time / Day</th>
          <th className={`${th} text-right`}>Days Below Connects</th>
          <th className={`${th} text-right`}>Days Below Talk Time</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(({ email, name, s }) => (
          <tr key={email} className={`hover:bg-indigo-50/60 dark:hover:bg-slate-800/60 cursor-pointer ${excluded.has(email) ? 'opacity-50' : ''}`} onClick={() => onOpen(email)}>
            <td className={td} onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={!excluded.has(email)} onChange={() => onToggle(email)} aria-label={`Include ${name} in the averages`} className="w-3.5 h-3.5 accent-indigo-600" />
            </td>
            <td className={`${td} font-semibold text-indigo-700 dark:text-indigo-300 underline-offset-2 hover:underline`}>{name}</td>
            <td className={`${td} text-right`}>{fmt1(s.agentDays)}</td>
            <td className={`${td} text-right ${lowConnects(s.avgConnects) ? RED : ''}`}>{fmt1(s.avgConnects)}</td>
            <td className={`${td} text-right ${lowTalk(s.avgTalk) ? RED : ''}`}>{hms(s.avgTalk)}</td>
            <td className={`${td} text-right`}>{s.daysLowConnects}</td>
            <td className={`${td} text-right`}>{s.daysLowTalk}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ 2. Breaks

export function BreaksSection({
  agents,
  rows,
  agentsByEmail,
  hasData,
}: {
  agents: TeamSummaryAgent[];
  rows: BreakDay[];
  agentsByEmail: Map<string, TeamSummaryAgent>;
  hasData: boolean;
}) {
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  const [drillAgent, setDrillAgent] = useState<string | null>(null);
  const { excluded, toggle, reset } = useExclusions();

  const locationOf = (email: string) => agentsByEmail.get(email.toLowerCase())?.location || 'Unknown';
  const locations = useMemo(() => [...new Set(rows.map((r) => locationOf(r.agentEmail)))].sort(), [rows, agentsByEmail]);
  const activeRows = rows.filter((r) => !excluded.has(r.agentEmail.toLowerCase()));
  const drillRows = drillAgent ? rows.filter((r) => r.agentEmail.toLowerCase() === drillAgent).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const limitNote = BREAK_COLUMNS.filter((c) => c.limitSec !== undefined || c.limitPct !== undefined)
    .map((c) => `${c.label} ${c.limitSec !== undefined ? hms(c.limitSec) : `${c.limitPct!.toFixed(2)}%`}`)
    .join(' · ');

  const header = (
    <tr>
      <th className={th}>{'Location'}</th>
      <th className={`${th} text-right`}>Agents</th>
      <th className={`${th} text-right`}>Agent-days</th>
      {BREAK_COLUMNS.map((c) => (
        <th key={c.key} className={`${th} text-right`}>
          {c.label}
        </th>
      ))}
      <th className={`${th} text-right`}>Days Over a Limit</th>
    </tr>
  );

  return (
    <section className={card}>
      <SectionHeader
        icon={<Coffee className="w-4 h-4 text-amber-500" />}
        title="Breaks"
        note={`Per agent per day (hh:mm:ss), from the Breaks tab. Red above the daily limit: ${limitNote}.`}
      />
      {!hasData ? (
        <p className="px-5 pb-5 text-xs text-slate-500">
          No Breaks data yet. It arrives with the next sync after the updated Apps Script is pasted into the sheet.
        </p>
      ) : (
        <>
        <ExcludedNote count={excluded.size} onReset={reset} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">{header}</thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {locations.map((loc) => {
                const locRows = rows.filter((r) => locationOf(r.agentEmail) === loc);
                const a = breakAverages(locRows.filter((r) => !excluded.has(r.agentEmail.toLowerCase())));
                const open = openLoc === loc;
                return (
                  <React.Fragment key={loc}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setOpenLoc(open ? null : loc)}>
                      <td className={`${td} font-semibold text-slate-900 dark:text-white`}>
                        <span className="inline-flex items-center gap-1.5">
                          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          {loc}
                        </span>
                      </td>
                      <td className={`${td} text-right`}>{a.agents}</td>
                      <td className={`${td} text-right`}>{a.days}</td>
                      {BREAK_COLUMNS.map((c) => (
                        <React.Fragment key={c.key}>{breakCell(c.key, a[c.key])}</React.Fragment>
                      ))}
                      <td className={`${td} text-right`}>{a.daysOver}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={BREAK_COLUMNS.length + 5} className="bg-slate-50/70 dark:bg-slate-950/40 px-3 py-3">
                          <table className="w-full text-xs text-left bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-800">
                                <th className={th} title="Untick to leave an agent out of the averages">Include</th>
                                <th className={th}>Agent (click for daily data)</th>
                                <th className={`${th} text-right`}>Days</th>
                                {BREAK_COLUMNS.map((c) => (
                                  <th key={c.key} className={`${th} text-right`}>
                                    {c.label}
                                  </th>
                                ))}
                                <th className={`${th} text-right`}>Days Over a Limit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {[...new Set(locRows.map((r) => r.agentEmail.toLowerCase()))]
                                .map((email) => ({ email, avg: breakAverages(locRows.filter((r) => r.agentEmail.toLowerCase() === email)) }))
                                .sort((x, y) => y.avg.daysOver - x.avg.daysOver)
                                .map(({ email, avg }) => (
                                  <tr key={email} className={`hover:bg-amber-50/60 dark:hover:bg-slate-800/60 cursor-pointer ${excluded.has(email) ? 'opacity-50' : ''}`} onClick={() => setDrillAgent(email)}>
                                    <td className={td} onClick={(e) => e.stopPropagation()}>
                                      <input type="checkbox" checked={!excluded.has(email)} onChange={() => toggle(email)} aria-label={`Include ${agentsByEmail.get(email)?.name || email} in the averages`} className="w-3.5 h-3.5 accent-indigo-600" />
                                    </td>
                                    <td className={`${td} font-semibold text-indigo-700 dark:text-indigo-300 hover:underline`}>{agentsByEmail.get(email)?.name || email}</td>
                                    <td className={`${td} text-right`}>{avg.days}</td>
                                    {BREAK_COLUMNS.map((c) => (
                                      <React.Fragment key={c.key}>{breakCell(c.key, avg[c.key])}</React.Fragment>
                                    ))}
                                    <td className={`${td} text-right ${avg.daysOver > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}`}>{avg.daysOver}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {locations.length > 1 &&
                (() => {
                  const a = breakAverages(activeRows);
                  return (
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-bold">
                      <td className={`${td} text-slate-900 dark:text-white`}>All locations</td>
                      <td className={`${td} text-right`}>{a.agents}</td>
                      <td className={`${td} text-right`}>{a.days}</td>
                      {BREAK_COLUMNS.map((c) => (
                        <React.Fragment key={c.key}>{breakCell(c.key, a[c.key])}</React.Fragment>
                      ))}
                      <td className={`${td} text-right`}>{a.daysOver}</td>
                    </tr>
                  );
                })()}
              {locations.length === 0 && <EmptyRow cols={BREAK_COLUMNS.length + 4} text="No Breaks data for this range." />}
            </tbody>
          </table>
        </div>
        </>
      )}

      {drillAgent && (
        <DrillDown title={agentsByEmail.get(drillAgent)?.name || drillAgent} subtitle="Daily Breaks data" onClose={() => setDrillAgent(null)}>
          <DrillSummary
            items={(() => {
              const a = breakAverages(drillRows);
              return [
                { label: 'Days', value: String(a.days) },
                ...BREAK_COLUMNS.map((c) => ({ label: `Avg ${c.label}`, value: breakText(c.key, a[c.key]), red: overLimit(c.key, a[c.key]) })),
                { label: 'Days Over a Limit', value: String(a.daysOver) },
              ];
            })()}
          />
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Day Type</th>
                {BREAK_COLUMNS.map((c) => (
                  <th key={c.key} className={`${th} text-right`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {drillRows.map((r) => (
                <tr key={r.date}>
                  <td className={`${td}`}>{r.date}</td>
                  <td className={td}>{dayLabel(r.dayType)}</td>
                  {BREAK_COLUMNS.map((c) => (
                    <React.Fragment key={c.key}>
                      {breakCell(c.key, c.key === 'idleAcwPct' ? idleAcwPct(r.idleAcw, r.staffed) : (r as any)[c.key])}
                    </React.Fragment>
                  ))}
                </tr>
              ))}
              {drillRows.length === 0 && <EmptyRow cols={BREAK_COLUMNS.length + 2} text="No Breaks days in this range." />}
            </tbody>
          </table>
        </DrillDown>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 3. Period Targets and Achievement

export function TargetsSection({
  targets,
  agents,
  cycle,
}: {
  targets: TargetRow[];
  agents: TeamSummaryAgent[];
  cycle: TeamSummaryResponse['cycle'];
}) {
  const today = istToday();
  const totalDays = Math.round((Date.parse(cycle.endDate) - Date.parse(cycle.startDate)) / 86400000) + 1;
  const elapsed = Math.min(totalDays, Math.max(0, Math.round((Date.parse(today) - Date.parse(cycle.startDate)) / 86400000) + 1));
  const daysLeft = Math.max(0, totalDays - elapsed);
  const expectedPct = (elapsed / totalDays) * 100;

  // A TL's team location, from the agents who report to them; anyone else is an overall target
  const teamOf = (email: string) => {
    const locs = [...new Set(agents.filter((a) => (a.tlOfficialEmail || '').toLowerCase() === email.toLowerCase()).map((a) => a.location))];
    return locs.length ? locs.join(', ') : 'All teams';
  };

  return (
    <section className={card}>
      <SectionHeader
        icon={<Target className="w-4 h-4 text-emerald-500" />}
        title="Period Targets and Achievement"
        note={`${cycle.name}: ${cycle.startDate} to ${cycle.endDate}. Day ${elapsed} of ${totalDays}, ${daysLeft} day(s) left; on pace means at least ${expectedPct.toFixed(1)}% achieved. From the Targets tab.`}
      />
      {targets.length === 0 ? (
        <p className="px-5 pb-5 text-xs text-slate-500">No target found for you in the Targets tab yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 px-5 pb-5">
          {targets.map((t) => {
            const pct = t.target > 0 ? (t.sales / t.target) * 100 : 0;
            const remaining = Math.max(0, t.target - t.sales);
            const onPace = pct >= expectedPct;
            return (
              <div key={t.managerEmail} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{nameFromEmail(t.managerEmail)}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{teamOf(t.managerEmail)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${onPace ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'}`}>
                    {onPace ? 'On pace' : 'Behind pace'}
                  </span>
                </div>
                <p className={`text-2xl font-black font-mono mt-3 ${onPace ? 'text-slate-900 dark:text-white' : 'text-rose-600 dark:text-rose-400'}`}>{pct.toFixed(1)}%</p>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 mt-2 relative overflow-hidden" title={`Expected by today: ${expectedPct.toFixed(1)}%`}>
                  <div className={`h-full rounded-full ${onPace ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  <div className="absolute top-0 h-full w-0.5 bg-slate-900/60 dark:bg-white/70" style={{ left: `${Math.min(100, expectedPct)}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-[11px]">
                  <dt className="text-slate-500">Sales</dt>
                  <dd className="text-right font-mono font-semibold text-slate-900 dark:text-white">{formatCurrencyINR(t.sales)}</dd>
                  <dt className="text-slate-500">Target</dt>
                  <dd className="text-right font-mono text-slate-700 dark:text-slate-300">{formatCurrencyINR(t.target)}</dd>
                  <dt className="text-slate-500">Remaining</dt>
                  <dd className="text-right font-mono text-slate-700 dark:text-slate-300">{formatCurrencyINR(remaining)}</dd>
                  <dt className="text-slate-500">Needed per day</dt>
                  <dd className="text-right font-mono text-slate-700 dark:text-slate-300">{daysLeft > 0 ? formatCurrencyINR(remaining / daysLeft) : '-'}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ shared bits

function SectionHeader({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className="px-5 pt-5 pb-3">
      <h3 className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{note}</p>
    </div>
  );
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-8 text-center text-xs text-slate-500">
        {text}
      </td>
    </tr>
  );
}

function DrillDown({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 w-full sm:max-w-5xl max-h-[85vh] rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${title}: ${subtitle}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
            <p className="text-[11px] text-slate-500">{subtitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto">{children}</div>
      </div>
    </div>
  );
}
