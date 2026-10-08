import {
  AgentDailyEntry,
  AgentRecord,
  AgentTotals,
  AgentType,
  BonusBandConfig,
  BonusResult,
  DeductionRule,
  IncentiveResult,
  MetricDeductionResult,
  Plan,
  PreSalesMetrics,
  PreSalesPlan,
  PreSalesTier,
  ProcessedMetrics,
  QualitySummary,
  RawMainRow,
  RawQualityRow,
} from './types';

/**
 * Clean and normalize email addresses: trim and lowercase
 */
export function normalizeEmail(email: any): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

/**
 * Format numbers in Indian number format (e.g. ₹1,50,00,000)
 */
export function formatCurrencyINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format numbers in Indian comma format (e.g. 1,50,000)
 */
export function formatNumberINR(amount: number, decimals: number = 0): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Round half up according to specification:
 * roundHalfUp(x) = Math.floor(x + 0.5 + 1e-9)
 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + 1e-9);
}

/**
 * Helper to safely extract number from raw input (blank / null / undefined = 0)
 */
function safeNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Convert Excel date serial or ISO or Date string to "YYYY-MM-DD" in IST
 */
export function parseToISTDateString(val: any): string {
  if (!val) return '';
  
  if (typeof val === 'number') {
    // Excel date serial number (days since 1899-12-30)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(val * 86400 * 1000);
    const d = new Date(excelEpoch.getTime() + ms);
    // Format to IST YYYY-MM-DD
    const istString = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return istString;
  }

  if (val instanceof Date) {
    return val.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  const str = String(val).trim();
  // Check if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Parse generic ISO or date string
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  return str;
}

/**
 * A) aggregateAgent(rows, qualityRow)
 * - Sum Sales, Count_of_Orders, Unique_Connects, Talk_Time_(seconds), Store_Visits_Booked, Store_Visits_Attributed, Day.
 * - activeDays = sum of Day (a half day is 0.5).
 * - A blank number is 0.
 * - Profile fields (name, emails, location, tier, TL) come from the row with the latest Date.
 * - daily = one entry for each date, sorted by date.
 * - lastDataDate = latest Date.
 * - quality = { audits: Total_Audits, score: Average_Audit_Score }. No quality row = audits 0.
 */
export function aggregateAgent(
  rows: RawMainRow[],
  qualityRow?: RawQualityRow | null
): {
  profile: {
    name: string;
    officialEmail: string;
    personalEmail: string;
    location: string;
    agentTierRaw: string;
    tlOfficialEmail: string;
    tlPersonalEmail: string;
  };
  totals: AgentTotals;
  daily: AgentDailyEntry[];
  quality: QualitySummary;
  lastDataDate: string;
} {
  // Sort rows by parsed date ascending
  const normalizedRows = rows.map((r) => {
    const dateStr = parseToISTDateString(r.Date);
    return {
      raw: r,
      date: dateStr,
      sales: safeNum(r.Sales),
      orders: safeNum(r.Count_of_Orders),
      connects: safeNum(r.Unique_Connects),
      talkSeconds: safeNum(r.Talk_Time_Minutes) * 60,
      visitsBooked: safeNum(r.Store_Visits),
      visitsAttributed: safeNum(r.Store_Visits),
      day: safeNum(r.Day),
      calls: safeNum(r.Inbound_Calls),
      avgTalkSec: safeNum(r.Avg_TT_per_day),
    };
  });

  normalizedRows.sort((a, b) => a.date.localeCompare(b.date));

  // Totals
  const totals: AgentTotals = {
    sales: 0,
    orders: 0,
    connects: 0,
    talkSeconds: 0,
    visitsBooked: 0,
    visitsAttributed: 0,
    activeDays: 0,
  };

  const dailyMap: Map<string, AgentDailyEntry> = new Map();

  // Pre Sales: Inbound_Calls is summed. Avg_TT_per_day is already a daily average, so it is
  // weighted by that day's Inbound_Calls (total talk time / total calls), and also kept as a
  // plain sum + count of worked days for the 'simple' method. A blank value means "no data".
  let psCalls = 0;
  let psWeightedSum = 0;
  let psWeightCalls = 0;
  let psSum = 0;
  let psRows = 0;
  const ttByDate = new Map<string, { num: number; calls: number; sum: number; n: number }>();

  for (const nr of normalizedRows) {
    totals.sales += nr.sales;
    totals.orders += nr.orders;
    totals.connects += nr.connects;
    totals.talkSeconds += nr.talkSeconds;
    totals.visitsBooked += nr.visitsBooked;
    totals.visitsAttributed += nr.visitsAttributed;
    totals.activeDays += nr.day;

    psCalls += nr.calls;
    if (nr.avgTalkSec > 0) {
      psWeightedSum += nr.avgTalkSec * nr.calls;
      psWeightCalls += nr.calls;
      if (nr.day > 0) {
        psSum += nr.avgTalkSec;
        psRows += 1;
      }
      const acc = ttByDate.get(nr.date) ?? { num: 0, calls: 0, sum: 0, n: 0 };
      acc.num += nr.avgTalkSec * nr.calls;
      acc.calls += nr.calls;
      acc.sum += nr.avgTalkSec;
      acc.n += 1;
      ttByDate.set(nr.date, acc);
    }

    if (dailyMap.has(nr.date)) {
      const existing = dailyMap.get(nr.date)!;
      existing.sales += nr.sales;
      existing.orders += nr.orders;
      existing.connects += nr.connects;
      existing.talkSeconds += nr.talkSeconds;
      existing.visitsBooked += nr.visitsBooked;
      existing.visitsAttributed += nr.visitsAttributed;
      existing.day += nr.day;
      existing.calls = (existing.calls ?? 0) + nr.calls;
    } else {
      dailyMap.set(nr.date, {
        date: nr.date,
        sales: nr.sales,
        orders: nr.orders,
        connects: nr.connects,
        talkSeconds: nr.talkSeconds,
        visitsBooked: nr.visitsBooked,
        visitsAttributed: nr.visitsAttributed,
        day: nr.day,
        calls: nr.calls,
      });
    }
  }

  totals.calls = psCalls;
  totals.ttWeightedSum = psWeightedSum;
  totals.ttWeightCalls = psWeightCalls;
  totals.ttSum = psSum;
  totals.ttRows = psRows;

  const daily = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  for (const entry of daily) {
    const acc = ttByDate.get(entry.date);
    if (acc) {
      const avg = acc.calls > 0 ? acc.num / acc.calls : acc.sum / acc.n;
      entry.avgTalkSec = Math.round(avg * 10) / 10;
    }
  }

  // Latest row for profile fields
  const latestRowItem =
    normalizedRows.length > 0 ? normalizedRows[normalizedRows.length - 1] : null;
  const latestRaw = latestRowItem ? latestRowItem.raw : {};

  const profile = {
    name: String(latestRaw.Agent_Name || '').trim(),
    officialEmail: normalizeEmail(latestRaw.Agent_Email_Official),
    personalEmail: normalizeEmail(latestRaw.Agent_Email_Personal),
    location: String(latestRaw.Agent_Location || '').trim(),
    agentTierRaw: String(latestRaw.Agent_Tier || '').trim(),
    tlOfficialEmail: normalizeEmail(latestRaw.TL_Official_Email),
    tlPersonalEmail: normalizeEmail(latestRaw.TL_Personal_Email),
  };

  const lastDataDate = latestRowItem ? latestRowItem.date : '';

  // Quality
  let quality: QualitySummary = { audits: 0, score: 0 };
  if (qualityRow) {
    quality = {
      audits: safeNum(qualityRow.Total_Audits),
      score: safeNum(qualityRow.Average_Audit_Score),
    };
  }

  return {
    profile,
    totals,
    daily,
    quality,
    lastDataDate,
  };
}

/**
 * B) metricsFromTotals(totals, quality, absentDays) returns { sales, avgConnects, avgTalkMinutes, qualityScore, visitsAttributed, absentDays }
 * - avgConnects = roundHalfUp(connects / activeDays). avgTalkMinutes = roundHalfUp(talkSeconds / 60 / activeDays). If activeDays = 0, both are 0.
 * - qualityScore = roundHalfUp(score). If audits = 0, qualityScore = null.
 */
export function metricsFromTotals(
  totals: AgentTotals,
  quality: QualitySummary,
  absentDays: number | null
): ProcessedMetrics {
  let avgConnects = 0;
  let avgTalkMinutes = 0;

  if (totals.activeDays > 0) {
    avgConnects = roundHalfUp(totals.connects / totals.activeDays);
    avgTalkMinutes = roundHalfUp(totals.talkSeconds / 60 / totals.activeDays);
  }

  let qualityScore: number | null = null;
  if (quality.audits > 0) {
    qualityScore = roundHalfUp(quality.score);
  }

  return {
    sales: totals.sales,
    avgConnects,
    avgTalkMinutes,
    qualityScore,
    visitsAttributed: totals.visitsAttributed,
    absentDays,
  };
}

/**
 * Evaluate single bonus metric band (Quality, Connects, TalkMinutes)
 */
function evaluateBonusBand(
  value: number | null,
  config: BonusBandConfig,
  className: string
): BonusResult {
  if (value === null) {
    return { value: null, band: 'None', amount: 0 };
  }

  let band: 'High' | 'Mid' | 'None' = 'None';
  if (value >= config.high) {
    band = 'High';
  } else if (value >= config.mid) {
    band = 'Mid';
  }

  let amount = 0;
  if (band !== 'None') {
    const classAmounts = config.amounts[className] || [0, 0];
    amount = band === 'High' ? classAmounts[0] : classAmounts[1];
  }

  return {
    value,
    band,
    amount,
  };
}

/**
 * Evaluate comparison operator
 */
function evaluateOp(val: number, op: DeductionRule['op'], threshold: number): boolean {
  switch (op) {
    case '<':
      return val < threshold;
    case '<=':
      return val <= threshold;
    case '>':
      return val > threshold;
    case '>=':
      return val >= threshold;
    case '=':
      return val === threshold;
    default:
      return false;
  }
}

/**
 * C) calculateFromMetrics(metrics, plan) returns result.
 * 1. Class: the LAST class in the list for which (sales * 100 > target * abovePct). Use integer math only. If no class passes, the class is NQ.
 * 2. achievementPct = sales / target * 100 (display only, 2 decimals).
 * 3. revenueIncentiveGross = roundHalfUp(sales * rate).
 * 4. Bands for quality, connects, talkMinutes: value >= high is "High"; value >= mid is "Mid"; else "None". Amount = amounts[className][0] for High, [1] for Mid, 0 for None. qualityScore null = band "None", amount 0. NQ agents also get bonuses.
 * 5. Rider: the highest tier with visitsAttributed >= min. None = 0.
 * 6. Deductions: for each rule where the metric value matches the comparison (skip absentDays rules if absentDays is null; skip qualityScore rules if qualityScore is null): fixed = value; percent = roundHalfUp(revenueIncentiveGross * value / 100). revenueIncentiveNet = max(0, gross - sum of deductions). Deductions never change the class or other amounts.
 * 7. total = revenueIncentiveNet + quality + connects + talk + rider.
 */
export function calculateFromMetrics(
  metrics: ProcessedMetrics,
  plan: Plan
): IncentiveResult {
  // 1. Class determination: last class for which (sales * 100 > target * abovePct)
  let activeClass = { name: 'NQ', abovePct: 0, rate: 0 };
  const target = Math.round(plan.target);
  const sales = Math.round(metrics.sales);

  for (const c of plan.classes) {
    // Note: integer math
    if (sales * 100 > target * c.abovePct) {
      activeClass = c;
    }
  }

  // 2. achievementPct = sales / target * 100 (display only, 2 decimals)
  const achievementPct =
    target > 0 ? Math.round((metrics.sales / target) * 10000) / 100 : 0;

  // 3. revenueIncentiveGross = roundHalfUp(sales * rate)
  const revenueIncentiveGross = roundHalfUp(metrics.sales * activeClass.rate);

  // 4. Bonuses
  const qualityBonus = evaluateBonusBand(
    metrics.qualityScore,
    plan.bonuses.quality,
    activeClass.name
  );
  const connectsBonus = evaluateBonusBand(
    metrics.avgConnects,
    plan.bonuses.connects,
    activeClass.name
  );
  const talkBonus = evaluateBonusBand(
    metrics.avgTalkMinutes,
    plan.bonuses.talkMinutes,
    activeClass.name
  );

  // 5. Rider: highest tier with visitsAttributed >= min
  let riderTier = 0;
  let riderAmount = 0;
  // Sort visit tiers by tier / min ascending
  const sortedVisitTiers = [...plan.visitTiers].sort((a, b) => a.min - b.min);
  for (const vt of sortedVisitTiers) {
    if (metrics.visitsAttributed >= vt.min) {
      riderTier = vt.tier;
      riderAmount = vt.payout;
    }
  }

  // 6. Deductions
  const deductions: MetricDeductionResult[] = [];
  let totalDeductionsAmount = 0;

  if (plan.deductionRules && plan.deductionRules.length > 0) {
    for (const rule of plan.deductionRules) {
      let metricVal: number | null = null;
      if (rule.metric === 'absentDays') {
        metricVal = metrics.absentDays;
      } else if (rule.metric === 'qualityScore') {
        metricVal = metrics.qualityScore;
      }

      // Skip if null
      if (metricVal === null) continue;

      if (evaluateOp(metricVal, rule.op, rule.threshold)) {
        let ruleAmount = 0;
        if (rule.type === 'fixed') {
          ruleAmount = rule.value;
        } else if (rule.type === 'percent') {
          ruleAmount = roundHalfUp((revenueIncentiveGross * rule.value) / 100);
        }
        deductions.push({ rule, amount: ruleAmount });
        totalDeductionsAmount += ruleAmount;
      }
    }
  }

  const revenueIncentiveNet = Math.max(0, revenueIncentiveGross - totalDeductionsAmount);

  // 7. Total
  const total =
    revenueIncentiveNet +
    qualityBonus.amount +
    connectsBonus.amount +
    talkBonus.amount +
    riderAmount;

  return {
    achievementPct,
    className: activeClass.name,
    rate: activeClass.rate,
    revenueIncentiveGross,
    deductions,
    revenueIncentiveNet,
    quality: qualityBonus,
    connects: connectsBonus,
    talk: talkBonus,
    rider: {
      tier: riderTier,
      amount: riderAmount,
    },
    total,
  };
}

/**
 * Lower-case and drop everything except letters and digits, so "PreSales", "Pre Sales" and
 * "pre-sales" all match the same Agent_Tier mapping.
 */
export function normalizeTierKey(value: any): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Maps the Agent_Tier text from the sheet to an Agent Type. Returns null for an unknown value. */
export function resolveAgentType(
  tierMap: Record<string, AgentType> | undefined,
  rawTier: string
): AgentType | null {
  const key = normalizeTierKey(rawTier);
  if (!tierMap || !key) return null;
  for (const [label, type] of Object.entries(tierMap)) {
    if (normalizeTierKey(label) === key) return type;
  }
  return null;
}

/**
 * Pre Sales metrics from the cycle totals.
 * - avgCalls = roundHalfUp(Inbound_Calls / activeDays)
 * - avgTalkSeconds: 'weighted' = roundHalfUp(sum(Avg_TT_per_day x Inbound_Calls) / sum(Inbound_Calls));
 *   'simple' = roundHalfUp(average of the daily values). Without call counts, the simple average is used.
 * - qualityScore = roundHalfUp(score); null when there are no audits (the quality gate is then not met).
 */
export function preSalesMetricsFromTotals(
  totals: AgentTotals,
  quality: QualitySummary,
  plan: PreSalesPlan
): PreSalesMetrics {
  const days = totals.activeDays;
  const avgCalls = days > 0 ? roundHalfUp((totals.calls ?? 0) / days) : 0;

  let avgTalkSeconds = 0;
  const weightCalls = totals.ttWeightCalls ?? 0;
  const rows = totals.ttRows ?? 0;
  if (plan.talkMethod === 'weighted' && weightCalls > 0) {
    avgTalkSeconds = roundHalfUp((totals.ttWeightedSum ?? 0) / weightCalls);
  } else if (rows > 0) {
    avgTalkSeconds = roundHalfUp((totals.ttSum ?? 0) / rows);
  }

  return {
    avgCalls,
    avgTalkSeconds,
    qualityScore: quality.audits > 0 ? roundHalfUp(quality.score) : null,
  };
}

/** Highest tier whose minimum is reached. tier 0 = below the first tier. */
export function pickPreSalesTier(
  tiers: PreSalesTier[],
  value: number
): { tier: number; payout: number } {
  let tier = 0;
  let payout = 0;
  [...tiers]
    .sort((a, b) => a.min - b.min)
    .forEach((t, i) => {
      if (value >= t.min) {
        tier = i + 1;
        payout = t.payout;
      }
    });
  return { tier, payout };
}

/**
 * Pre Sales incentive: two incentives (calls per day, talk time in seconds). BOTH are paid only
 * when the Quality Score is at least the gate; no audits or a score below the gate = Rs 0 for both.
 * Reuses IncentiveResult: the revenue fields are 0, className is 'PS', details are in `preSales`.
 */
export function calculatePreSales(metrics: PreSalesMetrics, plan: PreSalesPlan): IncentiveResult {
  const eligible = metrics.qualityScore !== null && metrics.qualityScore >= plan.qualityGate;
  const callsPick = pickPreSalesTier(plan.calls, metrics.avgCalls);
  const talkPick = pickPreSalesTier(plan.talkSeconds, metrics.avgTalkSeconds);
  const callsAmount = eligible ? callsPick.payout : 0;
  const talkAmount = eligible ? talkPick.payout : 0;

  return {
    achievementPct: 0,
    className: 'PS',
    rate: 0,
    revenueIncentiveGross: 0,
    deductions: [],
    revenueIncentiveNet: 0,
    quality: { value: metrics.qualityScore, band: 'None', amount: 0 },
    connects: { value: null, band: 'None', amount: 0 },
    talk: { value: null, band: 'None', amount: 0 },
    rider: { tier: 0, amount: 0 },
    total: callsAmount + talkAmount,
    preSales: {
      qualityScore: metrics.qualityScore,
      qualityGate: plan.qualityGate,
      eligible,
      calls: {
        value: metrics.avgCalls,
        tier: callsPick.tier,
        payout: callsPick.payout,
        amount: callsAmount,
      },
      talk: {
        value: metrics.avgTalkSeconds,
        tier: talkPick.tier,
        payout: talkPick.payout,
        amount: talkAmount,
      },
      potentialTotal: callsPick.payout + talkPick.payout,
    },
  };
}
