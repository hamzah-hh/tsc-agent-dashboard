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

/**
 * One month up to a day number. Cohorts are cumulative, as in the original report: "05. 30 seconds Plus"
 * counts every order with 30 seconds or more of talk time (that cohort and all longer ones).
 */
export function cohortTable(rows: CohortRow[], month: string, tillDay: number): CohortTableRow[] {
  const cohorts = [...new Set(rows.map((r) => r.cohort))].sort();
  const per = new Map<string, Record<CohortCategoryKey, { orders: number; revenue: number }>>();
  const blank = () => ({ shopify: { orders: 0, revenue: 0 }, alt: { orders: 0, revenue: 0 }, mp: { orders: 0, revenue: 0 }, pos: { orders: 0, revenue: 0 } });
  for (const c of cohorts) per.set(c, blank());
  for (const r of rows) {
    if (r.month !== month || r.day > tillDay) continue;
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
