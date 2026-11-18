/**
 * Rostering (weekly offs and planned leave): the rules and shapes shared by the server and the pages.
 * Everything here is pure, so the server and the screens apply exactly the same rules.
 *
 * Decisions (see docs/ROSTERING_FINAL_PLAN.md):
 *  - All dates are IST calendar dates. A week runs Monday to Sunday.
 *  - Mon-Fri: an agent's first WO of the week is confirmed at once when the day is under the team's limit.
 *  - Sat/Sun WOs, a 2nd or later WO in a week, and every PL need the TL's approval.
 *  - WOs: this week plus the next 2 weeks. PL: up to 60 days ahead.
 *  - Limit = how many agents of a team may be inactive (WO + PL) on a day. Default on weekdays: team size / 5, rounded up.
 *  - Cut-off: agents until D-1 18:00, TLs until D 00:00, managers and the Super Admin any time (not for past days).
 */

export type RosterKind = 'WO' | 'PL';
export type RosterStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'revoked';
export type RosterRole = 'agent' | 'tl' | 'manager' | 'superAdmin';
export type RosterSource = 'self' | 'tl' | 'manager' | 'swap';

export const ROSTER_RULES = {
  /** Agents may change a day until this hour (IST) of the day before. */
  agentCutoffHour: 18,
  /** WOs: the current week plus this many more weeks. */
  woWeeksAhead: 2,
  /** PL: this many days from today. */
  plDaysAhead: 60,
  /** An agent may book or cancel at most this many times in a week. */
  maxChangesPerWeek: 3,
  /** Weekdays a WO may be taken on (Monday to Friday), used for the default limit. */
  weekdaysPerWeek: 5,
};

const IST_OFFSET_MS = 330 * 60000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ dates (IST)

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_RE.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

/** The IST calendar date of a moment. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function dayOfWeek(day: string): number {
  return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export const weekStart = (day: string) => addDays(day, -dayOfWeek(day));
export const weekEnd = (day: string) => addDays(weekStart(day), 6);
export const isWeekend = (day: string) => dayOfWeek(day) >= 5;

/** The UTC moment that an IST date begins. */
export function istMidnightMs(day: string): number {
  return Date.parse(day + 'T00:00:00Z') - IST_OFFSET_MS;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed 25 Nov". */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[dayOfWeek(day)]} ${d} ${MONTHS[m - 1]}`;
}

// ------------------------------------------------------------------ windows and cut-offs

/** The last day that may be booked: the Sunday two weeks after this week for WOs, 60 days out for PL. */
export function lastBookableDay(kind: RosterKind, today: string): string {
  return kind === 'PL' ? addDays(today, ROSTER_RULES.plDaysAhead) : addDays(weekEnd(today), ROSTER_RULES.woWeeksAhead * 7);
}

/** The moment after which a role may no longer change the given day (Infinity: never, for managers and the owner). */
export function cutoffMs(day: string, role: RosterRole): number {
  if (role === 'manager' || role === 'superAdmin') return Infinity;
  const midnight = istMidnightMs(day);
  return role === 'tl' ? midnight : midnight - (24 - ROSTER_RULES.agentCutoffHour) * 3600000;
}

/** Can this role still create, change or cancel an entry for the day, at this moment? Past days never. */
export function canChangeDay(day: string, role: RosterRole, nowMs: number): boolean {
  return day >= istDay(nowMs) && nowMs < cutoffMs(day, role);
}

/** The first day this role may still change. */
export function firstChangeableDay(role: RosterRole, nowMs: number): string {
  let d = istDay(nowMs);
  for (let i = 0; i < 4; i++, d = addDays(d, 1)) if (canChangeDay(d, role, nowMs)) return d;
  return d;
}

/** Why a booking for this day is refused (null = fine). Used by the server and the screens. */
export function dayProblem(kind: RosterKind, day: string, role: RosterRole, nowMs: number): string | null {
  if (!isDay(day)) return 'Pick a valid date.';
  const today = istDay(nowMs);
  if (day < today) return 'That day has already passed.';
  const last = lastBookableDay(kind, today);
  if (day > last) return kind === 'PL' ? `Planned leave can only be requested up to ${dayLabel(last)}.` : `Weekly offs can only be set up to ${dayLabel(last)}.`;
  if (!canChangeDay(day, role, nowMs)) {
    return role === 'tl' ? `Changes for ${dayLabel(day)} have closed (${dayLabel(day)} has started).` : `Changes for ${dayLabel(day)} closed at ${ROSTER_RULES.agentCutoffHour}:00 on the day before. Ask your TL.`;
  }
  return null;
}

// ------------------------------------------------------------------ limits

/** The limit on a weekday when the TL has set none: team size / 5, rounded up. */
export function defaultWeekdayLimit(teamSize: number): number {
  return teamSize > 0 ? Math.ceil(teamSize / ROSTER_RULES.weekdaysPerWeek) : 0;
}

export type LimitSource = 'date' | 'all' | 'default' | 'none';

/**
 * The limit that applies to a day: the TL's limit for that date, else their all-days limit, else the weekday
 * default. Weekends have no default (the TL decides each request): limit null, source 'none'.
 */
export function effectiveLimit(day: string, dateLimit: number | null, allDaysLimit: number | null, teamSize: number): { limit: number | null; source: LimitSource } {
  if (dateLimit !== null && dateLimit !== undefined) return { limit: dateLimit, source: 'date' };
  if (allDaysLimit !== null && allDaysLimit !== undefined) return { limit: allDaysLimit, source: 'all' };
  if (isWeekend(day)) return { limit: null, source: 'none' };
  return { limit: defaultWeekdayLimit(teamSize), source: 'default' };
}

// ------------------------------------------------------------------ booking outcome

export interface BookingOutcome {
  /** Confirmed at once, or waiting for the TL. */
  status: 'approved' | 'pending';
  needsApproval: boolean;
  /** The day's limit is checked when the agent sends the request (weekdays only; the TL decides weekends). */
  enforceLimit: boolean;
  why: string;
}

/** What happens to an agent's own booking, given how many WOs they already have in that week. */
export function bookingOutcome(kind: RosterKind, day: string, weekWoCount: number): BookingOutcome {
  const weekend = isWeekend(day);
  if (kind === 'PL') return { status: 'pending', needsApproval: true, enforceLimit: !weekend, why: 'Planned leave always needs your TL\'s approval.' };
  if (weekend) return { status: 'pending', needsApproval: true, enforceLimit: false, why: 'A Saturday or Sunday off needs your TL\'s approval.' };
  if (weekWoCount >= 1) return { status: 'pending', needsApproval: true, enforceLimit: true, why: 'A second weekly off in the same week needs your TL\'s approval.' };
  return { status: 'approved', needsApproval: false, enforceLimit: true, why: 'Confirmed: your first weekly off of the week, within the team limit.' };
}

// ------------------------------------------------------------------ teams

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** The key a team is stored under: its TL's official email, else the TL's personal email, else the location. */
export function teamKeyOf(agent: { tlOfficialEmail?: string; tlPersonalEmail?: string; location?: string }): string {
  return norm(agent.tlOfficialEmail) || norm(agent.tlPersonalEmail) || `loc:${norm(agent.location)}`;
}

// ------------------------------------------------------------------ shapes shared with the screens

export interface RosterEntryDTO {
  id: string;
  agentEmail: string;
  agentName?: string;
  day: string;
  kind: RosterKind;
  status: RosterStatus;
  needsApproval: boolean;
  source: RosterSource;
  reason?: string | null;
  overLimit: boolean;
  createdBy: string;
  createdAt: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

export interface RosterDayInfo {
  day: string;
  weekend: boolean;
  /** null: no limit applies (a weekend the TL has not opened) */
  limit: number | null;
  limitSource: LimitSource;
  /** agents holding a slot: approved, plus pending weekday requests (a pending weekend request holds none) */
  used: number;
  /** requests waiting for the TL on this day */
  pending: number;
  /** slots left on a weekday; null when there is no limit */
  left: number | null;
  /** the agent can no longer change this day */
  locked: boolean;
  /** more people are off than the limit allows (the limit was lowered after bookings) */
  overBooked: boolean;
}

export interface RosterStatusResponse {
  /** the Roster tab is shown to this person */
  enabled: boolean;
  /** the roster database could not be reached */
  unavailable?: boolean;
  role?: RosterRole;
  /** agents: unread notifications; TLs and managers: requests waiting for a decision */
  badge?: number;
}

export interface RosterMeResponse {
  today: string;
  /** first day the agent may still change, last day for WOs, last day for PL */
  firstDay: string;
  woLastDay: string;
  plLastDay: string;
  agentName: string;
  agentEmail: string;
  teamSize: number;
  entries: RosterEntryDTO[];
  days: RosterDayInfo[];
  /** WOs (pending or approved) per week start, for the weeks in view */
  weeks: Array<{ weekStart: string; woCount: number }>;
  changesThisWeek: number;
  unread: number;
}

export interface RosterTeamAgent {
  email: string;
  name: string;
  agentType: string;
  location: string;
}

export interface RosterTeamResponse {
  today: string;
  teamKeys: string[];
  teamSize: number;
  agents: RosterTeamAgent[];
  entries: RosterEntryDTO[];
  days: RosterDayInfo[];
  /** the all-days limit the TL set, if any */
  allDaysLimit: number | null;
  pending: number;
  /** per week start: agents with no WO yet */
  noWo: Array<{ weekStart: string; agents: string[] }>;
  /** a warning when the weekday limits cannot fit everyone's WO */
  feasibility?: string;
  unread: number;
}

export interface RosterNotificationDTO {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  entryId: string | null;
  createdAt: string;
  read: boolean;
}

/**
 * Weekday limits that cannot give everyone a weekly off: warns the TL ("17 agents, but the limits allow only
 * 15 weekday WOs this week"). `weekdayLimits` are the limits of Mon..Fri of one week.
 */
export function feasibilityWarning(teamSize: number, weekdayLimits: number[]): string | undefined {
  const capacity = weekdayLimits.reduce((a, b) => a + b, 0);
  if (teamSize > 0 && capacity < teamSize) {
    return `${teamSize} agents, but the limits allow only ${capacity} weekday weekly offs this week. Raise a limit or some agents cannot get a WO.`;
  }
  return undefined;
}

// ------------------------------------------------------------------ swaps (phase 2)

export type SwapStatus = 'awaiting_partner' | 'awaiting_tl' | 'applied' | 'declined' | 'rejected' | 'cancelled' | 'expired' | 'failed';
export const OPEN_SWAP_STATUSES: SwapStatus[] = ['awaiting_partner', 'awaiting_tl'];

export const ROSTER_SWAP = {
  /** An agent may send at most this many swap requests in a week. */
  maxRequestsPerWeek: 2,
  /** A swap request lapses after this long if nobody finishes it. */
  expiryHours: 72,
};

const normLoc = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const sameWeek = (a: string, b: string) => weekStart(a) === weekStart(b);

/**
 * Two agents may swap only when they are the same caller type, in the same location, under the same TL.
 * (A Dighe HO caller and a Dighe Pre Sales caller differ in both type and location; Andheri and Bangalore Store
 * callers differ in location.)
 */
export function swapEligible(
  a: { agentType?: string; location?: string; tlOfficialEmail?: string; tlPersonalEmail?: string },
  b: { agentType?: string; location?: string; tlOfficialEmail?: string; tlPersonalEmail?: string }
): boolean {
  return Boolean(a.agentType) && a.agentType === b.agentType && normLoc(a.location) === normLoc(b.location) && teamKeyOf(a) === teamKeyOf(b);
}

/** When a swap request lapses: when either day closes to agents, or after 72 hours, whichever is first. */
export function swapExpiryMs(dayA: string, dayB: string, nowMs: number): number {
  return Math.min(cutoffMs(dayA, 'agent'), cutoffMs(dayB, 'agent'), nowMs + ROSTER_SWAP.expiryHours * 3600000);
}

export interface RosterSwapDTO {
  id: string;
  requesterEmail: string;
  requesterName: string;
  partnerEmail: string;
  partnerName: string;
  /** the requester's WO date (they give it up) and the partner's WO date (the requester takes it) */
  requesterDay: string;
  partnerDay: string;
  requesterEntryId: string;
  partnerEntryId: string;
  status: SwapStatus;
  note?: string | null;
  decisionNote?: string | null;
  failReason?: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface SwapCandidateDTO {
  entryId: string;
  agentEmail: string;
  agentName: string;
  day: string;
}
