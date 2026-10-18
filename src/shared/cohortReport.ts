/**
 * Talk Time Cohort report (Anirban_Ref tab). Private: only the emails in COHORT_REPORT_VIEWERS may see it.
 * Being a Manager, TL or Super Admin does not give access by itself.
 */
// Anirban signs in with his Gmail (the company address is kept in case it becomes a Google account);
// agha.h489@gmail.com (Super Admin) was added at the owner's request. Managers and TLs never see it.
export const COHORT_REPORT_VIEWERS = ['anirban.tsc@gmail.com', 'anirban@thesleepcompany.in', 'agha.h489@gmail.com'];

/** One row of the Anirban_Ref tab: one day, one sale category, one talk time cohort. */
export interface CohortRow {
  month: string; // 'YYYY-MM' (from Date)
  date?: string; // 'YYYY-MM-DD' (older saves have only month + day)
  label: string; // the sheet's Month text, e.g. 'Oct-2026'
  day: number; // Day_Number
  category: string; // e.g. '1. Shopify'
  cohort: string; // e.g. '01.1 Second Plus'
  orders: number;
  sales: number;
}

export const COHORT_CATEGORIES = [
  { key: 'shopify', match: 'shopify', label: 'Shopify' },
  { key: 'alt', match: 'another number', label: 'Alt' },
  { key: 'mp', match: 'marketplace', label: 'MP' },
  { key: 'pos', match: 'pos', label: 'POS OC' },
] as const;

export type CohortCategoryKey = (typeof COHORT_CATEGORIES)[number]['key'];

export interface CohortTableRow {
  cohort: string;
  byCategory: Record<CohortCategoryKey, { orders: number; revenue: number }>;
  orders: number;
  revenue: number;
  aov: number | null;
}

export function categoryKey(category: string): CohortCategoryKey | null {
  const c = category.toLowerCase();
  return COHORT_CATEGORIES.find((x) => c.includes(x.match))?.key ?? null;
}

/** The row's calendar date. */
export function rowDate(r: CohortRow): string {
  return r.date || `${r.month}-${String(r.day).padStart(2, '0')}`;
}

/**
 * One day of the Company_DOD tab (one row per day and channel there), added up: all company orders and
 * revenue, and the revenue of the Retail and Marketplace Main_Channel groups (Website is its own group too).
 */
export interface CompanyDay {
  date: string; // 'YYYY-MM-DD'
  orders: number;
  sales: number; // all channels
  retail?: number; // Main_Channel Retail (older saves have none)
  marketplace?: number; // Main_Channel Marketplace
  website?: number; // Main_Channel Website (older saves have none: the remainder is used)
}

export interface CompanyTotals {
  orders: number;
  revenue: number;
  retail: number;
  marketplace: number;
  website: number;
  aov: number | null;
  days: number;
}

/** Company orders and revenue over a period of dates. */
export function companyForPeriod(days: CompanyDay[], period: { from: string; to: string }): CompanyTotals {
  let orders = 0;
  let revenue = 0;
  let retail = 0;
  let marketplace = 0;
  let website = 0;
  let n = 0;
  for (const d of days) {
    if (d.date < period.from || d.date > period.to) continue;
    orders += d.orders;
    revenue += d.sales;
    retail += d.retail || 0;
    marketplace += d.marketplace || 0;
    website += d.website ?? Math.max(0, d.sales - (d.retail || 0) - (d.marketplace || 0));
    n++;
  }
  return { orders, revenue, retail, marketplace, website, aov: orders > 0 ? revenue / orders : null, days: n };
}

/**
 * Attributed revenue: the cumulative revenue of the "10 Seconds Plus" cohort, i.e. every order with 10 seconds
 * or more of talk time (the cohort and all longer ones). To count from another cohort, change this match.
 */
export const ATTRIBUTED_COHORT = /10\s*seconds/i;

export function attributedRevenue(table: CohortTableRow[]): number {
  return table.find((r) => ATTRIBUTED_COHORT.test(r.cohort))?.revenue ?? 0;
}

/** A period of dates, both ends included ('YYYY-MM-DD'). */
export interface CohortPeriod {
  from: string;
  to: string;
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The same day n months away, kept inside that month (31 Mar - 1 month = 28/29 Feb). */
export function shiftMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, '0')}`;
}

/** Month to date: the 1st of the month of `latest` up to `latest`. */
export function monthToDate(latest: string): CohortPeriod {
  return { from: `${latest.slice(0, 7)}-01`, to: latest };
}

/**
 * SDLM, same days last month: 1 Oct - 12 Oct becomes 1 Sep - 12 Sep. A period that ends on the last day
 * of its month ends on the last day of the earlier month too (1-31 Oct -> 1-30 Sep).
 */
export function sameDaysMonthsBack(p: CohortPeriod, months = 1): CohortPeriod {
  const [y, m, d] = p.to.split('-').map(Number);
  const endsMonth = d === daysInMonth(y, m);
  let to = shiftMonths(p.to, -months);
  if (endsMonth) to = `${to.slice(0, 7)}-${String(daysInMonth(Number(to.slice(0, 4)), Number(to.slice(5, 7)))).padStart(2, '0')}`;
  return { from: shiftMonths(p.from, -months), to };
}

/**
 * The cohort table for a period of dates. Cohorts are cumulative, as in the original report:
 * "05. 30 seconds Plus" counts every order with 30 seconds or more of talk time (that cohort and all
 * longer ones).
 */
export function cohortTableForPeriod(rows: CohortRow[], period: CohortPeriod): CohortTableRow[] {
  return buildTable(rows, (r) => {
    const d = rowDate(r);
    return d >= period.from && d <= period.to;
  });
}

/** One month up to a day number (the original report's "TILL dd-mm-yyyy"). */
export function cohortTable(rows: CohortRow[], month: string, tillDay: number): CohortTableRow[] {
  return buildTable(rows, (r) => r.month === month && r.day <= tillDay);
}

function buildTable(rows: CohortRow[], include: (r: CohortRow) => boolean): CohortTableRow[] {
  const cohorts = [...new Set(rows.map((r) => r.cohort))].sort();
  const per = new Map<string, Record<CohortCategoryKey, { orders: number; revenue: number }>>();
  const blank = () => ({ shopify: { orders: 0, revenue: 0 }, alt: { orders: 0, revenue: 0 }, mp: { orders: 0, revenue: 0 }, pos: { orders: 0, revenue: 0 } });
  for (const c of cohorts) per.set(c, blank());
  for (const r of rows) {
    if (!include(r)) continue;
    const k = categoryKey(r.category);
    if (!k) continue;
    per.get(r.cohort)![k].orders += r.orders;
    per.get(r.cohort)![k].revenue += r.sales;
  }
  return cohorts.map((cohort, i) => {
    const byCategory = blank();
    for (const c of cohorts.slice(i)) {
      for (const k of Object.keys(byCategory) as CohortCategoryKey[]) {
        byCategory[k].orders += per.get(c)![k].orders;
        byCategory[k].revenue += per.get(c)![k].revenue;
      }
    }
    const orders = Object.values(byCategory).reduce((s, v) => s + v.orders, 0);
    const revenue = Object.values(byCategory).reduce((s, v) => s + v.revenue, 0);
    return { cohort, byCategory, orders, revenue, aov: orders > 0 ? revenue / orders : null };
  });
}

/** (current / earlier) - 1, or null when there is nothing to compare with. */
export function growth(current: number | null, earlier: number | null): number | null {
  if (current === null || earlier === null || earlier === 0) return null;
  return current / earlier - 1;
}

/** One day of the Diwali_Projection tab: the company's projection against what was achieved. */
export interface DiwaliDay {
  date: string; // 'YYYY-MM-DD'
  dow: string;
  weekFlag: string; // Weekday / Weekend
  salePct: number | null; // 0..1
  projection: number;
  actual: number;
  attributed: number;
  threeMin: number;
}

export interface DiwaliTotals {
  days: number; // days with an actual
  projectionAll: number;
  projectionToDate: number;
  actual: number;
  attributed: number;
  threeMin: number;
  remainingProjection: number;
  remainingDays: number;
}

/** Days with an actual above 0 count as played; the rest are still ahead. */
export function diwaliTotals(days: DiwaliDay[]): DiwaliTotals {
  const t: DiwaliTotals = { days: 0, projectionAll: 0, projectionToDate: 0, actual: 0, attributed: 0, threeMin: 0, remainingProjection: 0, remainingDays: 0 };
  for (const d of days) {
    t.projectionAll += d.projection;
    if (d.actual > 0) {
      t.days++;
      t.projectionToDate += d.projection;
      t.actual += d.actual;
      t.attributed += d.attributed;
      t.threeMin += d.threeMin;
    } else {
      t.remainingDays++;
      t.remainingProjection += d.projection;
    }
  }
  return t;
}
