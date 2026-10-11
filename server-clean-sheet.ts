/**
 * The clean sheet layout: six input tabs, no formulas and no copied agent details.
 *
 *   Agents    one row per person  (Agent_Email_Official, Agent_Name, Agent_Email_Personal, Agent_Location,
 *                                  Agent_Tier, TL_Official_Email, TL_Personal_Email, Status)
 *   Orders    one row per order   (Order ID, Order Value, Date, Credited_Date, Order Time, phone, Agent,
 *                                  Talk Time Cohort, Category, Agent Category, Channel)
 *   Visits    one row per visit   (Visit Date Time, Phone, Agent_Email, Location, Talk_Time_(s), source)
 *   Dialer    agent per day       (Date, Agent_ID, Day_Type, Total_Unique_Connected_Calls, Total_Talk_Time_sec)
 *   PreSales  agent per day       (Date, Agent_ID, Calls, TT_Per_Call_(sec))
 *   Quality   one row per agent   (Agent_Email, Total_Audits, Average_Score)
 *
 * The daily values that MainSheet used to hold are built here from those tabs, and handed to the same
 * import as before (processImport), so every payout rule stays exactly where it was. The rules:
 *
 * - Only people in Agents count. Rows for anyone else are left out (one warning lists them).
 *   A Status other than "Active" excludes the person, like a row in Excluded_Agents did.
 * - An order counts on its Credited_Date; a blank Credited_Date means the order date.
 *   Orders credited outside the cycle are left out.
 * - Each agent gets an order once (same Order ID twice for one agent = once). An order under two
 *   agents counts in full for both.
 * - Each agent gets a phone number's visit once (the earliest one). A visit under two agents counts
 *   for both.
 * - A worked day comes from Dialer only (Day_Type 1 / 0.5, or "Full Day" / "Half Day"). A Pre Sales
 *   row with calls is one worked day (the existing blank-Day rule).
 * - Every active agent gets a login, even with no data yet (a roster row, Day 0).
 */
import { normalizeEmail } from './src/shared/incentive';

export interface CleanSheetTabs {
  agentsRows?: any[];
  ordersRows?: any[];
  visitsRows?: any[];
  dialerRows?: any[];
  preSalesRows?: any[];
  qualityRows?: any[];
}

export interface CleanSheetResult {
  mainRows: any[];
  qualityRows: any[];
  revenueRows: any[];
  leaderMappingRows: any[];
  excludedAgentsRows: any[];
  rawRevenueTabRows: any[];
  rawVisitRows: any[];
  warnings: string[];
}

/** True when a sync / import body uses the clean layout (it has an Agents tab). */
export function isCleanSheetPayload(body: any): boolean {
  return Array.isArray(body?.agentsRows) && body.agentsRows.length > 0;
}

function headerKey(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The first non-empty cell among the given column names (case, spaces and punctuation ignored), as it came. */
function cell(row: Record<string, any>, ...names: string[]): any {
  const values = new Map<string, any>();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey(k), v);
  for (const name of names) {
    const v = values.get(headerKey(name));
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

/** The same, as trimmed text. */
function pick(row: Record<string, any>, ...names: string[]): string {
  return String(cell(row, ...names)).trim();
}

/** A number from a cell ("1,999" and 1999 both work). null when the cell is blank or not a number (#VALUE!). */
function numberOf(text: string): number | null {
  if (text === '') return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The calendar day and time a cell shows, as 'YYYY-MM-DD' and 'YYYY-MM-DD HH:mm:ss'. Times are never
 * shifted between time zones: what the sheet shows is what counts.
 * - text: "2026-10-01", "2026/10/01 20:26:11", or day-first "01-10-2026" / "01/10/2026 1:17"
 * - an Excel date number (from an uploaded .xlsx)
 * - a Date (read in India time)
 */
export function sheetDateTime(value: any): { day: string; time: string } | null {
  if (value === undefined || value === null || value === '') return null;
  let y: number, mo: number, d: number, h = 0, mi = 0, s = 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400) * 1000);
    [y, mo, d, h, mi, s] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()];
  } else if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const t = new Date(value.getTime() + 330 * 60 * 1000); // India time
    [y, mo, d, h, mi, s] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()];
  } else {
    const str = String(value).trim();
    const time = '(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
    let m = new RegExp('^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})' + time).exec(str);
    if (m) {
      [y, mo, d] = [+m[1], +m[2], +m[3]];
    } else {
      m = new RegExp('^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})' + time).exec(str);
      if (!m) return null;
      [d, mo, y] = [+m[1], +m[2], +m[3]];
    }
    [h, mi, s] = [+(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  return { day, time: `${day} ${pad(h)}:${pad(mi)}:${pad(s)}` };
}

/** Orders tab Category -> the team revenue split. */
function revenueBucket(category: string): 'shopify' | 'bfan' | 'bfmp' | 'posoc' | null {
  const c = category.toLowerCase();
  if (c.includes('shopify')) return 'shopify';
  if (c.includes('another number') || c.includes('alternate')) return 'bfan';
  if (c.includes('marketplace')) return 'bfmp';
  if (c.includes('pos')) return 'posoc';
  return null;
}

/** Dialer Day_Type: 1 / 0.5 as numbers, or "Full Day" / "Half Day". */
function dayValue(text: string): number {
  const t = text.toLowerCase();
  if (t.includes('half')) return 0.5;
  if (t.includes('full')) return 1;
  return numberOf(text) ?? 0;
}

const NO_EMAIL = new Set(['', 'none', 'null', 'na', 'n/a', '-', '#n/a']);

/** "a, b, c and 4 more" */
function listOf(items: string[], max = 10): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
}

interface Person {
  official: string;
  name: string;
  personal: string;
  location: string;
  tier: string;
  tlOfficial: string;
  tlPersonal: string;
  active: boolean;
}

interface DayTotals {
  orders: number;
  sales: number;
  visits: number;
  connects: number;
  talkSec: number;
  day: number | null; // null: no Dialer row that day
  calls: number | null; // null: no PreSales row that day
  ttNum: number; // talk seconds per call x calls, to combine two PreSales rows for one day
  ttCalls: number;
}

export function buildFromCleanSheet(tabs: CleanSheetTabs, cycle: { startDate: string; endDate: string }): CleanSheetResult {
  const warnings: string[] = [];
  const inCycle = (day: string) => day >= cycle.startDate && day <= cycle.endDate;
  const empty = (
    [['Orders', tabs.ordersRows], ['Visits', tabs.visitsRows], ['Dialer', tabs.dialerRows], ['PreSales', tabs.preSalesRows], ['Quality', tabs.qualityRows]] as const
  )
    .filter(([, rows]) => !rows || rows.length === 0)
    .map(([name]) => name);
  if (empty.length) warnings.push(`Tab(s) missing or empty: ${empty.join(', ')}. Their numbers are 0 for everyone.`);

  // ---- Agents
  const people = new Map<string, Person>();
  const duplicates: string[] = [];
  for (const row of tabs.agentsRows || []) {
    const official = normalizeEmail(pick(row, 'Agent_Email_Official', 'Agent_Official_Email', 'Official_Email', 'Agent_Email'));
    if (!official) continue;
    if (people.has(official)) {
      duplicates.push(official);
      continue;
    }
    const personal = normalizeEmail(pick(row, 'Agent_Email_Personal', 'Agent_Personal_Email', 'Personal_Email', 'Agent_Gmail', 'Gmail', 'Login_Email'));
    const status = pick(row, 'Status').replace(/\s+/g, ' ').trim();
    people.set(official, {
      official,
      name: pick(row, 'Agent_Name', 'Name') || official,
      personal: NO_EMAIL.has(personal) ? '' : personal,
      location: pick(row, 'Agent_Location', 'Location'),
      tier: pick(row, 'Agent_Tier', 'Tier'),
      tlOfficial: normalizeEmail(pick(row, 'TL_Official_Email', 'TL_Email_Official', 'Leader_Official_Email')),
      tlPersonal: normalizeEmail(pick(row, 'TL_Personal_Email', 'TL_Email_Personal', 'Leader_Personal_Email', 'TL_Gmail')),
      active: status === '' || status.toLowerCase() === 'active',
    });
  }
  if (duplicates.length) warnings.push(`Agents: ${duplicates.length} email(s) appear twice; the first row is used: ${listOf(duplicates)}`);
  const noLogin = [...people.values()].filter((p) => p.active && !p.personal).map((p) => `${p.name} (${p.official})`);
  if (noLogin.length) warnings.push(`Agents: ${noLogin.length} active agent(s) have no personal email, so they cannot sign in: ${listOf(noLogin)}`);

  // Data rows of people who are not in Agents are left out; one warning names them
  const unknown = new Map<string, number>();
  const personOf = (email: string): Person | null => {
    const p = people.get(email);
    if (!p) {
      if (email) unknown.set(email, (unknown.get(email) || 0) + 1);
      return null;
    }
    return p.active ? p : null;
  };

  const totals = new Map<string, Map<string, DayTotals>>();
  const dayOf = (agent: string, day: string): DayTotals => {
    if (!totals.has(agent)) totals.set(agent, new Map());
    const byDay = totals.get(agent)!;
    if (!byDay.has(day)) {
      byDay.set(day, { orders: 0, sales: 0, visits: 0, connects: 0, talkSec: 0, day: null, calls: null, ttNum: 0, ttCalls: 0 });
    }
    return byDay.get(day)!;
  };
  const bad: string[] = [];

  // ---- Orders
  const rawRevenueTabRows: any[] = [];
  const revenueRows: any[] = [];
  const seenOrders = new Set<string>();
  let repeatOrders = 0;
  let outOfCycleOrders = 0;
  (tabs.ordersRows || []).forEach((row, i) => {
    const p = personOf(normalizeEmail(pick(row, 'Agent', 'Agent_Email', 'Agent Email', 'Agent_ID')));
    if (!p) return;
    const orderId = pick(row, 'Order ID', 'Order_ID', 'OrderID');
    const credited = sheetDateTime(cell(row, 'Credited_Date', 'Credited Date') || cell(row, 'Date', 'Order Date'));
    const value = numberOf(pick(row, 'Order Value', 'Order_Value'));
    if (!credited || value === null) {
      bad.push(`Orders row ${i + 2} (${orderId || 'no Order ID'}): ${!credited ? 'no valid date' : 'Order Value is not a number'}`);
      return;
    }
    if (!inCycle(credited.day)) {
      outOfCycleOrders++;
      return;
    }
    if (orderId) {
      const key = `${p.official}|${orderId}`;
      if (seenOrders.has(key)) {
        repeatOrders++;
        return;
      }
      seenOrders.add(key);
    }
    const t = dayOf(p.official, credited.day);
    t.orders += 1;
    t.sales += value;

    const category = pick(row, 'Category');
    const bucket = revenueBucket(category);
    if (bucket) revenueRows.push({ Location: p.location, Date: credited.day, Category: bucket, Orders: 1, Sales: value });
    rawRevenueTabRows.push({
      'Order ID': orderId,
      'Order Value': value,
      Date: credited.day,
      'Order Time': sheetDateTime(cell(row, 'Order Time', 'Order_Time'))?.time || '',
      'Order Phone / Alternate Phone': pick(row, 'Order Phone / Alternate Phone', 'Phone/Alternate Phone', 'Phone'),
      Agent: p.official,
      'Talk Time Cohort': pick(row, 'Talk Time Cohort'),
      Category: category,
      'Original Phone / Marketplace Name (for Alt/MP Orders)': pick(row, 'Original Phone / Marketplace Name (for Alt/MP Orders)', 'Original Phone/Marketplace Name'),
      'Agent Category': pick(row, 'Agent Category'),
      Channel: pick(row, 'Channel'),
      Location: p.location,
    });
  });
  if (repeatOrders) warnings.push(`Orders: ${repeatOrders} repeated row(s) (same Order ID for the same agent) counted once.`);
  if (outOfCycleOrders) warnings.push(`Orders: ${outOfCycleOrders} order(s) credited outside ${cycle.startDate} to ${cycle.endDate} left out.`);

  // ---- Visits: an agent gets each phone number once, the earliest visit
  const visits: Array<{ p: Person; when: { day: string; time: string }; phone: string; row: any }> = [];
  (tabs.visitsRows || []).forEach((row, i) => {
    const p = personOf(normalizeEmail(pick(row, 'Agent_Email', 'Agent Email', 'Agent ID', 'Agent')));
    if (!p) return;
    const when = sheetDateTime(cell(row, 'Visit Date Time', 'Visit_Date_Time', 'Date'));
    if (!when) {
      bad.push(`Visits row ${i + 2}: no valid Visit Date Time`);
      return;
    }
    if (!inCycle(when.day)) return;
    visits.push({ p, when, phone: pick(row, 'Phone', 'Phone Number', 'Phone_Number'), row });
  });
  visits.sort((a, b) => a.when.time.localeCompare(b.when.time));
  const seenVisits = new Set<string>();
  let repeatVisits = 0;
  const rawVisitRows: any[] = [];
  for (const v of visits) {
    if (v.phone) {
      const key = `${v.p.official}|${v.phone}`;
      if (seenVisits.has(key)) {
        repeatVisits++;
        continue;
      }
      seenVisits.add(key);
    }
    dayOf(v.p.official, v.when.day).visits += 1;
    rawVisitRows.push({
      'Visit Date Time': v.when.time,
      'Phone Number': v.phone,
      'Agent Email': v.p.official,
      Location: pick(v.row, 'Location') || v.p.location,
      'Talk Time (before Visit)': numberOf(pick(v.row, 'Talk_Time_(s)', 'Talk Time (before Visit)', 'Talk_Time_sec')) ?? 0,
      'Visit Source': pick(v.row, 'source', 'Visit Source'),
    });
  }
  if (repeatVisits) warnings.push(`Visits: ${repeatVisits} repeat visit(s) by a phone number already credited to the same agent counted once.`);

  // ---- Dialer
  const twiceDialer: string[] = [];
  (tabs.dialerRows || []).forEach((row, i) => {
    const p = personOf(normalizeEmail(pick(row, 'Agent_ID', 'Agent_Email', 'Agent Email', 'Agent')));
    if (!p) return;
    const when = sheetDateTime(cell(row, 'Date'));
    if (!when) {
      bad.push(`Dialer row ${i + 2}: no valid Date`);
      return;
    }
    if (!inCycle(when.day)) return;
    const t = dayOf(p.official, when.day);
    if (t.day !== null) twiceDialer.push(`${p.official} ${when.day}`);
    t.connects += numberOf(pick(row, 'Total_Unique_Connected_Calls', 'Unique_Connects')) ?? 0;
    t.talkSec += numberOf(pick(row, 'Total_Talk_Time_sec', 'Talk_Time_sec')) ?? 0;
    t.day = Math.max(t.day ?? 0, dayValue(pick(row, 'Day_Type', 'Day', 'Active_Day_Count')));
  });
  if (twiceDialer.length) warnings.push(`Dialer: ${twiceDialer.length} agent-day(s) appear twice; their numbers are added up: ${listOf(twiceDialer)}`);

  // ---- PreSales
  const twicePs: string[] = [];
  (tabs.preSalesRows || []).forEach((row, i) => {
    const p = personOf(normalizeEmail(pick(row, 'Agent_ID', 'Agent_Email', 'Agent Email', 'Agent')));
    if (!p) return;
    const when = sheetDateTime(cell(row, 'Date'));
    if (!when) {
      bad.push(`PreSales row ${i + 2}: no valid Date`);
      return;
    }
    if (!inCycle(when.day)) return;
    const calls = numberOf(pick(row, 'Calls', 'Inbound_Calls')) ?? 0;
    const ttText = pick(row, 'TT_Per_Call_(sec)', 'TT_Per_Call', 'Avg_TT_per_day');
    const tt = numberOf(ttText);
    if (ttText !== '' && tt === null) bad.push(`PreSales row ${i + 2} (${p.official}, ${when.day}): talk time '${ttText}' is not a number`);
    const t = dayOf(p.official, when.day);
    if (t.calls !== null) twicePs.push(`${p.official} ${when.day}`);
    t.calls = (t.calls ?? 0) + calls;
    if (tt !== null && tt > 0) {
      t.ttNum += tt * calls;
      t.ttCalls += calls;
    }
  });
  if (twicePs.length) warnings.push(`PreSales: ${twicePs.length} agent-day(s) appear twice; calls are added up: ${listOf(twicePs)}`);

  if (unknown.size) {
    const names = [...unknown.entries()].map(([e, n]) => `${e} (${n})`);
    warnings.push(`${unknown.size} email(s) have data but are not in Agents, so their rows are left out: ${listOf(names)}`);
  }
  if (bad.length) warnings.push(`${bad.length} row(s) could not be read and were left out: ${listOf(bad)}`);

  // ---- MainSheet rows, one per active agent and day
  const mainRows: any[] = [];
  for (const p of people.values()) {
    if (!p.active) continue;
    const profile = {
      Agent_Name: p.name,
      Agent_Email_Official: p.official,
      Agent_Email_Personal: p.personal,
      Agent_Location: p.location,
      Agent_Tier: p.tier,
      TL_Official_Email: p.tlOfficial,
      TL_Personal_Email: p.tlPersonal,
    };
    const byDay = totals.get(p.official);
    if (!byDay || byDay.size === 0) {
      // Roster row: the agent can sign in before their first data
      mainRows.push({ ...profile, Date: cycle.startDate, Count_of_Orders: '', Sales: '', Unique_Connects: '', Talk_Time_Minutes: '', Store_Visits: '', Day: 0, Inbound_Calls: '', Avg_TT_per_day: '' });
      continue;
    }
    for (const day of [...byDay.keys()].sort()) {
      const t = byDay.get(day)!;
      mainRows.push({
        ...profile,
        Date: day,
        Count_of_Orders: t.orders,
        Sales: t.sales,
        Average_Order_Value: t.orders > 0 ? Math.round(t.sales / t.orders) : 0,
        Unique_Connects: t.connects,
        Talk_Time_Minutes: t.talkSec / 60,
        Store_Visits: t.visits,
        // Blank Day + calls = one Pre Sales worked day; otherwise only a Dialer row makes a worked day
        Day: t.day ?? (t.calls ? '' : 0),
        Inbound_Calls: t.calls ?? '',
        Avg_TT_per_day: t.ttCalls > 0 ? t.ttNum / t.ttCalls : '',
      });
    }
  }

  const qualityRows = (tabs.qualityRows || [])
    .map((row) => ({
      Agent_Email_Official: normalizeEmail(pick(row, 'Agent_Email', 'Agent_Email_Official', 'Email')),
      Total_Audits: pick(row, 'Total_Audits', 'Audits'),
      Average_Audit_Score: pick(row, 'Average_Score', 'Average_Audit_Score', 'Score'),
    }))
    .filter((q) => q.Agent_Email_Official);

  const leaderMappingRows = [...people.values()]
    .filter((p) => p.active)
    .map((p) => ({
      Agent_Email_Official: p.official,
      Agent_Email_Personal: p.personal,
      TL_Official_Email: p.tlOfficial,
      TL_Personal_Email: p.tlPersonal,
      Status: 'Active',
    }));

  const excludedAgentsRows = [...people.values()]
    .filter((p) => !p.active)
    .map((p) => ({ Agent_Email_Official: p.official, Reason: 'Status in Agents is not Active', Excluded_Since: '', Active_Exclusion: 'TRUE' }));

  return { mainRows, qualityRows, revenueRows, leaderMappingRows, excludedAgentsRows, rawRevenueTabRows, rawVisitRows, warnings };
}
