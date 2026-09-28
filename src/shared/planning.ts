import { Plan } from './types';

/**
 * Pure planning and run-rate formulas according to the spec:
 *
 * 1. remainingWorkingDays = max(0, calendar days from lastDataDate to endDate) * workingDaysPerWeek / 7, 1 decimal.
 *    If there is no data, use calendar days from startDate - 1 to endDate.
 * 2. requiredPerDay(targetSales) = max(0, targetSales - sales) / remainingWorkingDays.
 * 3. minSalesForClass(className) = floor(target * abovePct / 100) + 1 (integer math).
 * 4. projection = current value + (current value / activeDays) * remainingWorkingDays, for sales and visitsAttributed.
 */

export function calculateCalendarDays(fromDateStr: string, toDateStr: string): number {
  if (!fromDateStr || !toDateStr) return 0;
  const from = new Date(fromDateStr + 'T00:00:00Z');
  const to = new Date(toDateStr + 'T00:00:00Z');
  const diffMs = to.getTime() - from.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function calculateRemainingWorkingDays(
  lastDataDate: string | null | undefined,
  startDate: string,
  endDate: string,
  workingDaysPerWeek: number
): number {
  let calendarDays: number;
  if (lastDataDate && lastDataDate.trim()) {
    // calendar days from lastDataDate to endDate
    calendarDays = calculateCalendarDays(lastDataDate, endDate);
  } else {
    // calendar days from startDate - 1 to endDate
    const start = new Date(startDate + 'T00:00:00Z');
    start.setDate(start.getDate() - 1);
    const dayBeforeStart = start.toISOString().split('T')[0];
    calendarDays = calculateCalendarDays(dayBeforeStart, endDate);
  }

  const rawWorkingDays = (Math.max(0, calendarDays) * workingDaysPerWeek) / 7;
  // 1 decimal place
  return Math.round(rawWorkingDays * 10) / 10;
}

export function minSalesForClass(plan: Plan, className: string): number {
  const planClass = plan.classes.find((c) => c.name === className);
  if (!planClass) return 0;
  // integer math: floor(target * abovePct / 100) + 1
  return Math.floor((plan.target * planClass.abovePct) / 100) + 1;
}

export function requiredPerDay(
  targetSales: number,
  currentSales: number,
  remainingWorkingDays: number
): number {
  if (remainingWorkingDays <= 0) return 0;
  const gap = Math.max(0, targetSales - currentSales);
  return gap / remainingWorkingDays;
}

export function calculateProjection(
  currentVal: number,
  activeDays: number,
  remainingWorkingDays: number
): number {
  if (activeDays <= 0) return currentVal;
  return currentVal + (currentVal / activeDays) * remainingWorkingDays;
}
