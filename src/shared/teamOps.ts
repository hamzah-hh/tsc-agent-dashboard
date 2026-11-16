import type { BusinessOverviewRow } from './businessOverview';
/**
 * Overall Team Summary and Targets: the rules and shapes shared by the server and the page.
 * All times are in seconds; the page shows them as hh:mm:ss.
 */

/** Average Productivity: a day is red below these (scaled by Day_Type, so a half day needs half). */
export const PRODUCTIVITY_RULES = {
  minUniqueConnectsPerDay: 135,
  minTalkSecondsPerDay: 2 * 3600 + 45 * 60, // 2h 45m
};

/** Breaks: red above these daily limits. Idle Time + ACW may be at most 2h 45m of a 9-hour shift. */
export const IDLE_ACW_MAX_PCT = ((2 * 3600 + 45 * 60) / (9 * 3600)) * 100; // 30.5555...%

export type BreakMetric = 'bio' | 'first' | 'lunch' | 'last' | 'total' | 'acw' | 'idle' | 'idleAcw' | 'staffed' | 'idleAcwPct';

export const BREAK_COLUMNS: Array<{ key: BreakMetric; label: string; limitSec?: number; limitPct?: number }> = [
  { key: 'bio', label: 'Bio or Misc Break', limitSec: 20 * 60 },
  { key: 'first', label: 'First Break', limitSec: 15 * 60 },
  { key: 'lunch', label: 'Lunch', limitSec: 30 * 60 },
  { key: 'last', label: 'Last Break', limitSec: 15 * 60 },
  { key: 'total', label: 'Total Daily Break', limitSec: 80 * 60 },
  { key: 'idleAcw', label: 'Total of Idle Time and ACW' },
  { key: 'staffed', label: 'Staffed Duration' },
  { key: 'idleAcwPct', label: 'Idle Time and ACW %', limitPct: IDLE_ACW_MAX_PCT },
];

/**
 * The agent's own Breaks page also shows Idle Time and After Call Work on their own (the Team Summary
 * tables keep the shorter set above).
 */
export const AGENT_BREAK_COLUMNS: Array<{ key: BreakMetric; label: string; limitSec?: number; limitPct?: number }> = [
  ...BREAK_COLUMNS.slice(0, 5),
  { key: 'acw', label: 'After Call Work (ACW)' },
  { key: 'idle', label: 'Idle Time' },
  ...BREAK_COLUMNS.slice(5),
];

/** One agent's day from the Breaks tab (seconds). */
export interface BreakDay {
  date: string;
  agentEmail: string;
  dayType: number; // 1 or 0.5
  bio: number;
  first: number;
  lunch: number;
  last: number;
  total: number;
  acw: number;
  idle: number;
  staffed: number;
  idleAcw: number;
}

/** One row of the Targets tab: a TL's or Manager's period target. */
export interface TargetRow {
  managerEmail: string;
  sales: number;
  target: number;
}

/** One agent's Dialer day (from the agent record's daily entries). */
export interface ProductivityDay {
  agentEmail: string;
  date: string;
  day: number;
  connects: number;
  talkSeconds: number;
}

export interface TeamSummaryAgent {
  officialEmail: string;
  name: string;
  location: string;
  agentType: string;
  tlOfficialEmail: string;
}

export interface TeamSummaryResponse {
  cycle: { id: string; name: string; startDate: string; endDate: string };
  agents: TeamSummaryAgent[];
  productivity: ProductivityDay[];
  breaks: BreakDay[];
  targets: TargetRow[];
  breaksUpdatedAt: string | null;
  /** Month by month and tier; a TL gets only their own tiers, and no all-tier rows. */
  businessOverview: BusinessOverviewRow[];
}

/**
 * Seconds as hh:mm:ss. Seconds are always shown: a value rounded to the minute could look equal to a
 * limit (02:45) while it is a few seconds past it and shown in red.
 */
export function hms(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
  const total = Math.round(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Idle Time + ACW as a share of Staffed Duration, in percent. */
export function idleAcwPct(idleAcw: number, staffed: number): number | null {
  return staffed > 0 ? (idleAcw / staffed) * 100 : null;
}

/** "zirgham.raza@thesleepcompany.in" -> "Zirgham Raza" (the sheet has no TL names). */
export function nameFromEmail(email: string): string {
  const local = String(email || '').split('@')[0] || '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

// ---- averages and limits (the Team Summary page and the agent's own Connects and Breaks page)

export interface ProdStats {
  agents: number;
  agentDays: number; // sum of Day_Type
  avgConnects: number | null;
  avgTalk: number | null;
  daysLowConnects: number;
  daysLowTalk: number;
}

export function prodStats(days: ProductivityDay[]): ProdStats {
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
export const lowConnects = (value: number | null, day = 1) => value !== null && value < PRODUCTIVITY_RULES.minUniqueConnectsPerDay * day;
// Times are compared in whole seconds, as shown (hh:mm:ss), so a red value never displays as equal to the limit
export const lowTalk = (value: number | null, day = 1) => value !== null && Math.round(value) < PRODUCTIVITY_RULES.minTalkSecondsPerDay * day;

export type BreakAverages = Record<BreakMetric, number | null> & { days: number; agents: number; daysOver: number };

export function overLimit(key: BreakMetric, value: number | null): boolean {
  const col = BREAK_COLUMNS.find((c) => c.key === key);
  if (!col || value === null) return false;
  if (col.limitSec !== undefined) return Math.round(value) > col.limitSec;
  if (col.limitPct !== undefined) return value > col.limitPct;
  return false;
}

export function dayOverAnyLimit(b: BreakDay): boolean {
  return (
    BREAK_COLUMNS.some((c) => c.limitSec !== undefined && overLimit(c.key, (b as any)[c.key])) ||
    overLimit('idleAcwPct', idleAcwPct(b.idleAcw, b.staffed))
  );
}

/** Averages per agent per day; Idle Time and ACW % is total idle + ACW over total staffed time. */
export function breakAverages(rows: BreakDay[]): BreakAverages {
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
    acw: avg('acw'),
    idle: avg('idle'),
    idleAcw: avg('idleAcw'),
    staffed: avg('staffed'),
    idleAcwPct: idleAcwPct(idleAcw, staffed),
    days: n,
    agents: new Set(rows.map((r) => r.agentEmail)).size,
    daysOver: rows.filter(dayOverAnyLimit).length,
  };
}

