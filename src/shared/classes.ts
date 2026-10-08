import { Plan, PlanClass } from './types';
import { minSalesForClass } from './planning';

/**
 * Screens show the revenue classes from the cycle's plan, never a fixed 90 / 100 / 120 / 160.
 * When the Super Admin changes the class limits in the cycle record, every label follows.
 */

export interface ClassStep {
  name: string; // "A"
  abovePct: number; // 90 = revenue must be MORE than 90% of the target
  rate: number; // 0.0015
  ratePct: string; // "0.15"
  minSales: number; // smallest revenue that reaches the class (strictly above the limit)
  isFirst: boolean;
  isTop: boolean;
}

/** The qualifying classes (everything above the 0% "not qualified" entry), lowest first. */
export function qualifyingClasses(plan: Plan): PlanClass[] {
  return [...(plan.classes || [])].filter((c) => c.abovePct > 0).sort((a, b) => a.abovePct - b.abovePct);
}

export function classSteps(plan: Plan): ClassStep[] {
  const list = qualifyingClasses(plan);
  return list.map((c, i) => ({
    name: c.name,
    abovePct: c.abovePct,
    rate: c.rate,
    ratePct: (c.rate * 100).toFixed(2),
    minSales: minSalesForClass(plan, c.name),
    isFirst: i === 0,
    isTop: i === list.length - 1,
  }));
}

/** Position of a class in the plan (the "not qualified" class is 0). */
export function classRank(plan: Plan, className: string): number {
  const i = (plan.classes || []).findIndex((c) => c.name === className);
  return i < 0 ? 0 : i;
}

/** The right-hand end of the percentage scales: the top limit plus a margin, rounded up to 10. */
export function scaleMaxPct(plan: Plan): number {
  const top = classSteps(plan).at(-1)?.abovePct ?? 100;
  return Math.ceil((top + top * 0.125) / 10) * 10;
}
