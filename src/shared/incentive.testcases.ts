import {
  aggregateAgent,
  calculateFromMetrics,
  calculatePreSales,
  metricsFromTotals,
  preSalesMetricsFromTotals,
  resolveAgentType,
} from './incentive';
import { defaultHOPlan, defaultPreSalesPlan, defaultSTOREPlan } from './plans';
import { AgentRecord, AgentTotals, AgentType, Cycle, Plan, ProcessedMetrics } from './types';
import { buildSuggestions } from './suggestions';
import { calculateRemainingWorkingDays } from './planning';
import { classRank, classSteps, scaleMaxPct } from './classes';
import { aiFingerprint, aiTextIsCurrent } from './aiText';
import { buildLocationRows, rankRevenueRows } from './leaderboard';

// --- helpers for cases 25-28 ---
const testCycle: Cycle = {
  name: 'Test cycle',
  startDate: '2026-10-01',
  endDate: '2026-11-30',
  status: 'active',
  workingDaysPerWeek: 6,
  plans: { HO: defaultHOPlan, STORE: defaultSTOREPlan },
};

/** An HO agent with 10 steady days (Class NQ) and the given average audit score. */
function hoRecordWithQuality(score: number): AgentRecord {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    Date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    Agent_Email_Official: 'a@test.local',
    Agent_Location: 'Dighe',
    Agent_Tier: 'HO Callers',
    Sales: 200000,
    Count_of_Orders: 4,
    Unique_Connects: 150,
    'Talk_Time_(seconds)': 11000,
    Store_Visits_Attributed: 3,
    Day: 1,
  }));
  const agg = aggregateAgent(rows, { Agent_Email_Official: 'a@test.local', Total_Audits: 5, Average_Audit_Score: score });
  const result = calculateFromMetrics(metricsFromTotals(agg.totals, agg.quality, null), defaultHOPlan);
  return {
    name: 'A',
    officialEmail: 'a@test.local',
    personalEmail: '',
    location: 'Dighe',
    agentType: 'HO',
    tlOfficialEmail: '',
    tlPersonalEmail: '',
    totals: agg.totals,
    daily: agg.daily,
    quality: agg.quality,
    absentDays: null,
    lastDataDate: agg.lastDataDate,
    result,
    updatedAt: '',
  };
}

// --- Pre Sales helpers (cases 17-24) ---
function psTotal(avgCalls: number, avgTalkSeconds: number, qualityScore: number | null): number {
  return calculatePreSales({ avgCalls, avgTalkSeconds, qualityScore }, defaultPreSalesPlan).total;
}

function psTotals(partial: Partial<AgentTotals>): AgentTotals {
  return {
    sales: 0,
    orders: 0,
    connects: 0,
    talkSeconds: 0,
    visitsBooked: 0,
    visitsAttributed: 0,
    activeDays: 0,
    ...partial,
  };
}

export interface TestCaseDefinition {
  id: number;
  description: string;
  run: () => {
    passed: boolean;
    expected: string;
    actual: string;
    details?: string;
  };
}

export const testCases: TestCaseDefinition[] = [
  // 1. HO, sales 8100000 -> NQ, revenue incentive 0
  {
    id: 1,
    description: 'HO, sales 8100000 -> NQ, revenue incentive 0',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 8100000,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = res.className === 'NQ' && res.revenueIncentiveGross === 0;
      return {
        passed,
        expected: 'Class: NQ, Revenue: 0',
        actual: `Class: ${res.className}, Revenue: ${res.revenueIncentiveGross}`,
      };
    },
  },

  // 2. HO, sales 8100001 -> A, 12150
  {
    id: 2,
    description: 'HO, sales 8100001 -> A, 12150',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 8100001,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = res.className === 'A' && res.revenueIncentiveGross === 12150;
      return {
        passed,
        expected: 'Class: A, Revenue: 12150',
        actual: `Class: ${res.className}, Revenue: ${res.revenueIncentiveGross}`,
      };
    },
  },

  // 3. HO, sales 9000000 -> A, 13500
  {
    id: 3,
    description: 'HO, sales 9000000 -> A, 13500',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 9000000,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = res.className === 'A' && res.revenueIncentiveGross === 13500;
      return {
        passed,
        expected: 'Class: A, Revenue: 13500',
        actual: `Class: ${res.className}, Revenue: ${res.revenueIncentiveGross}`,
      };
    },
  },

  // 4. HO, sales 9000001 -> B, 27000
  {
    id: 4,
    description: 'HO, sales 9000001 -> B, 27000',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 9000001,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = res.className === 'B' && res.revenueIncentiveGross === 27000;
      return {
        passed,
        expected: 'Class: B, Revenue: 27000',
        actual: `Class: ${res.className}, Revenue: ${res.revenueIncentiveGross}`,
      };
    },
  },

  // 5. STORE, sales 15600001 -> C
  {
    id: 5,
    description: 'STORE, sales 15600001 -> C',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 15600001,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultSTOREPlan);
      const passed = res.className === 'C';
      return {
        passed,
        expected: 'Class: C',
        actual: `Class: ${res.className}`,
      };
    },
  },

  // 6. STORE, sales 20800001 -> D
  {
    id: 6,
    description: 'STORE, sales 20800001 -> D',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 20800001,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultSTOREPlan);
      const passed = res.className === 'D';
      return {
        passed,
        expected: 'Class: D',
        actual: `Class: ${res.className}`,
      };
    },
  },

  // 7. connects 289 in 2 active days -> avgConnects 145, High
  {
    id: 7,
    description: 'connects 289 in 2 active days -> avgConnects 145, High',
    run: () => {
      const metrics = metricsFromTotals(
        {
          sales: 9000000,
          orders: 0,
          connects: 289,
          talkSeconds: 0,
          visitsBooked: 0,
          visitsAttributed: 0,
          activeDays: 2,
        },
        { audits: 0, score: 0 },
        null
      );
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = metrics.avgConnects === 145 && res.connects.band === 'High';
      return {
        passed,
        expected: 'avgConnects: 145, Band: High',
        actual: `avgConnects: ${metrics.avgConnects}, Band: ${res.connects.band}`,
      };
    },
  },

  // 8. connects 288 in 2 active days -> 144, Mid
  {
    id: 8,
    description: 'connects 288 in 2 active days -> 144, Mid',
    run: () => {
      const metrics = metricsFromTotals(
        {
          sales: 9000000,
          orders: 0,
          connects: 288,
          talkSeconds: 0,
          visitsBooked: 0,
          visitsAttributed: 0,
          activeDays: 2,
        },
        { audits: 0, score: 0 },
        null
      );
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = metrics.avgConnects === 144 && res.connects.band === 'Mid';
      return {
        passed,
        expected: 'avgConnects: 144, Band: Mid',
        actual: `avgConnects: ${metrics.avgConnects}, Band: ${res.connects.band}`,
      };
    },
  },

  // 9. talk 21540 seconds in 2 active days -> 180 minutes, High
  {
    id: 9,
    description: 'talk 21540 seconds in 2 active days -> 180 minutes, High',
    run: () => {
      const metrics = metricsFromTotals(
        {
          sales: 9000000,
          orders: 0,
          connects: 0,
          talkSeconds: 21540,
          visitsBooked: 0,
          visitsAttributed: 0,
          activeDays: 2,
        },
        { audits: 0, score: 0 },
        null
      );
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = metrics.avgTalkMinutes === 180 && res.talk.band === 'High';
      return {
        passed,
        expected: 'avgTalkMinutes: 180, Band: High',
        actual: `avgTalkMinutes: ${metrics.avgTalkMinutes}, Band: ${res.talk.band}`,
      };
    },
  },

  // 10. connects 435, Day values 1, 1, 0.5, 0.5 -> 145, High
  {
    id: 10,
    description: 'connects 435, Day values 1, 1, 0.5, 0.5 -> 145, High',
    run: () => {
      const activeDays = 1 + 1 + 0.5 + 0.5; // 3 days
      const metrics = metricsFromTotals(
        {
          sales: 9000000,
          orders: 0,
          connects: 435,
          talkSeconds: 0,
          visitsBooked: 0,
          visitsAttributed: 0,
          activeDays,
        },
        { audits: 0, score: 0 },
        null
      );
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = metrics.avgConnects === 145 && res.connects.band === 'High';
      return {
        passed,
        expected: 'avgConnects: 145, Band: High',
        actual: `avgConnects: ${metrics.avgConnects}, Band: ${res.connects.band}`,
      };
    },
  },

  // 11. audits 0, score 95 -> quality amount 0
  {
    id: 11,
    description: 'audits 0, score 95 -> quality amount 0',
    run: () => {
      const metrics = metricsFromTotals(
        {
          sales: 9000000,
          orders: 0,
          connects: 0,
          talkSeconds: 0,
          visitsBooked: 0,
          visitsAttributed: 0,
          activeDays: 1,
        },
        { audits: 0, score: 95 },
        null
      );
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const passed = res.quality.amount === 0 && res.quality.band === 'None';
      return {
        passed,
        expected: 'quality amount: 0, band: None',
        actual: `quality amount: ${res.quality.amount}, band: ${res.quality.band}`,
      };
    },
  },

  // 12. STORE visits 289 -> tier 1, 2200; visits 290 -> tier 2, 4000
  {
    id: 12,
    description: 'STORE visits 289 -> tier 1, 2200; visits 290 -> tier 2, 4000',
    run: () => {
      const m1: ProcessedMetrics = {
        sales: 0,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 289,
        absentDays: null,
      };
      const res1 = calculateFromMetrics(m1, defaultSTOREPlan);

      const m2: ProcessedMetrics = {
        sales: 0,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 290,
        absentDays: null,
      };
      const res2 = calculateFromMetrics(m2, defaultSTOREPlan);

      const passed =
        res1.rider.tier === 1 &&
        res1.rider.amount === 2200 &&
        res2.rider.tier === 2 &&
        res2.rider.amount === 4000;

      return {
        passed,
        expected: 'v289: T1/2200, v290: T2/4000',
        actual: `v289: T${res1.rider.tier}/${res1.rider.amount}, v290: T${res2.rider.tier}/${res2.rider.amount}`,
      };
    },
  },

  // 13. gross 13500, deductions 10 percent and fixed 2000 -> net 10150
  {
    id: 13,
    description: 'gross 13500, deductions 10 percent and fixed 2000 -> net 10150',
    run: () => {
      const planWithDeductions: Plan = {
        ...defaultHOPlan,
        deductionRules: [
          { metric: 'absentDays', op: '>=', threshold: 2, type: 'percent', value: 10 },
          { metric: 'absentDays', op: '>=', threshold: 2, type: 'fixed', value: 2000 },
        ],
      };
      // HO sales 9000000 gives gross 13500 (Class A, rate 0.0015)
      const metrics: ProcessedMetrics = {
        sales: 9000000,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: 2,
      };
      const res = calculateFromMetrics(metrics, planWithDeductions);
      const passed =
        res.revenueIncentiveGross === 13500 && res.revenueIncentiveNet === 10150;
      return {
        passed,
        expected: 'Gross: 13500, Net: 10150',
        actual: `Gross: ${res.revenueIncentiveGross}, Net: ${res.revenueIncentiveNet}`,
      };
    },
  },

  // 14. gross 1000, deduction fixed 2000 -> net 0
  {
    id: 14,
    description: 'gross 1000, deduction fixed 2000 -> net 0',
    run: () => {
      const planWithDeduction: Plan = {
        ...defaultHOPlan,
        classes: [{ name: 'A', abovePct: 0, rate: 1 }], // artificial 100% rate for 1000 sales
        deductionRules: [
          { metric: 'absentDays', op: '>', threshold: 0, type: 'fixed', value: 2000 },
        ],
      };
      const metrics: ProcessedMetrics = {
        sales: 1000,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: null,
        visitsAttributed: 0,
        absentDays: 1,
      };
      const res = calculateFromMetrics(metrics, planWithDeduction);
      const passed =
        res.revenueIncentiveGross === 1000 && res.revenueIncentiveNet === 0;
      return {
        passed,
        expected: 'Gross: 1000, Net: 0',
        actual: `Gross: ${res.revenueIncentiveGross}, Net: ${res.revenueIncentiveNet}`,
      };
    },
  },

  // 15. NQ agent, quality 92, connects 146, talk 181 -> 1000 + 1100 + 1000
  {
    id: 15,
    description: 'NQ agent, quality 92, connects 146, talk 181 -> 1000 + 1100 + 1000',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 1000, // NQ
        avgConnects: 146, // High -> 1100
        avgTalkMinutes: 181, // High -> 1000
        qualityScore: 92, // High -> 1000
        visitsAttributed: 0,
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultHOPlan);
      const expectedTotal = 1000 + 1100 + 1000; // 3100
      const passed =
        res.className === 'NQ' &&
        res.quality.amount === 1000 &&
        res.connects.amount === 1100 &&
        res.talk.amount === 1000 &&
        res.total === expectedTotal;
      return {
        passed,
        expected: 'NQ, Quality: 1000, Connects: 1100, Talk: 1000, Total: 3100',
        actual: `${res.className}, Quality: ${res.quality.amount}, Connects: ${res.connects.amount}, Talk: ${res.talk.amount}, Total: ${res.total}`,
      };
    },
  },

  // 16. STORE, sales 15000000, quality 92, connects 142, talk 170, visits 300 -> B, 45000 + 1300 + 900 + 1000 + 4000 = total 52200
  {
    id: 16,
    description:
      'STORE, sales 15000000, quality 92, connects 142, talk 170, visits 300 -> B, 45000 + 1300 + 900 + 1000 + 4000 = total 52200',
    run: () => {
      const metrics: ProcessedMetrics = {
        sales: 15000000, // 15000000 > 13000000 * 100% -> B, rate 0.003 -> gross 45000
        avgConnects: 142, // Mid -> 900
        avgTalkMinutes: 170, // Mid -> 1000
        qualityScore: 92, // High -> 1300
        visitsAttributed: 300, // Tier 2 -> 4000
        absentDays: null,
      };
      const res = calculateFromMetrics(metrics, defaultSTOREPlan);
      const passed =
        res.className === 'B' &&
        res.revenueIncentiveNet === 45000 &&
        res.quality.amount === 1300 &&
        res.connects.amount === 900 &&
        res.talk.amount === 1000 &&
        res.rider.amount === 4000 &&
        res.total === 52200;
      return {
        passed,
        expected: 'Class B, Gross: 45000, Q: 1300, C: 900, T: 1000, R: 4000, Total: 52200',
        actual: `Class ${res.className}, Gross: ${res.revenueIncentiveNet}, Q: ${res.quality.amount}, C: ${res.connects.amount}, T: ${res.talk.amount}, R: ${res.rider.amount}, Total: ${res.total}`,
      };
    },
  },

  // 17. Pre Sales calls per day tiers (quality 90 so the gate is met, talk time below its first tier)
  {
    id: 17,
    description:
      'Pre Sales calls/day: 100 -> 0, 101 -> 500, 115 -> 500, 116 -> 1000, 130 -> 1000, 131 -> 2000',
    run: () => {
      const cases: Array<[number, number]> = [
        [100, 0],
        [101, 500],
        [115, 500],
        [116, 1000],
        [130, 1000],
        [131, 2000],
      ];
      const actual = cases.map(([calls]) => psTotal(calls, 0, 90));
      const expected = cases.map(([, pay]) => pay);
      return {
        passed: actual.every((v, i) => v === expected[i]),
        expected: expected.join(', '),
        actual: actual.join(', '),
      };
    },
  },

  // 18. Pre Sales talk time (seconds) tiers
  {
    id: 18,
    description:
      'Pre Sales talk time (s): 165 -> 0, 166 -> 500, 180 -> 500, 181 -> 1000, 210 -> 1000, 211 -> 2000',
    run: () => {
      const cases: Array<[number, number]> = [
        [165, 0],
        [166, 500],
        [180, 500],
        [181, 1000],
        [210, 1000],
        [211, 2000],
      ];
      const actual = cases.map(([talk]) => psTotal(0, talk, 90));
      const expected = cases.map(([, pay]) => pay);
      return {
        passed: actual.every((v, i) => v === expected[i]),
        expected: expected.join(', '),
        actual: actual.join(', '),
      };
    },
  },

  // 19. Quality gate: both incentives need a Quality Score of 85 or more
  {
    id: 19,
    description: 'Pre Sales quality gate: calls 131 + talk 211 -> score 84 = 0, score 85 = 4000, score 100 = 4000',
    run: () => {
      const below = psTotal(131, 211, 84);
      const atGate = psTotal(131, 211, 85);
      const top = psTotal(131, 211, 100);
      return {
        passed: below === 0 && atGate === 4000 && top === 4000,
        expected: 'score 84: 0, score 85: 4000, score 100: 4000',
        actual: `score 84: ${below}, score 85: ${atGate}, score 100: ${top}`,
      };
    },
  },

  // 20. No audits -> the gate is not met, even with a high score value and top tiers
  {
    id: 20,
    description: 'Pre Sales with Total_Audits 0 (score 95): both incentives 0',
    run: () => {
      const totals = psTotals({
        activeDays: 1,
        calls: 131,
        ttWeightedSum: 211 * 131,
        ttWeightCalls: 131,
        ttSum: 211,
        ttRows: 1,
      });
      const metrics = preSalesMetricsFromTotals(totals, { audits: 0, score: 95 }, defaultPreSalesPlan);
      const res = calculatePreSales(metrics, defaultPreSalesPlan);
      return {
        passed:
          metrics.qualityScore === null && res.total === 0 && res.preSales?.potentialTotal === 4000,
        expected: 'quality null, total 0, potential 4000',
        actual: `quality ${metrics.qualityScore}, total ${res.total}, potential ${res.preSales?.potentialTotal}`,
      };
    },
  },

  // 21. Rounding: 201 calls in 2 active days = 100.5 -> 101 (half rounds up) -> Tier 1
  {
    id: 21,
    description: 'Pre Sales: 201 calls in 2 active days (100.5) rounds to 101 -> 500',
    run: () => {
      const totals = psTotals({ activeDays: 2, calls: 201 });
      const metrics = preSalesMetricsFromTotals(totals, { audits: 3, score: 90 }, defaultPreSalesPlan);
      const res = calculatePreSales(metrics, defaultPreSalesPlan);
      return {
        passed: metrics.avgCalls === 101 && res.total === 500,
        expected: 'avgCalls 101, total 500',
        actual: `avgCalls ${metrics.avgCalls}, total ${res.total}`,
      };
    },
  },

  // 22. Talk time is weighted by Inbound_Calls (default) or a simple average (plan setting)
  {
    id: 22,
    description:
      'Pre Sales talk time: day 1 = 200 s on 100 calls, day 2 = 100 s on 300 calls -> weighted 125, simple 150',
    run: () => {
      const totals = psTotals({
        activeDays: 2,
        calls: 400,
        ttWeightedSum: 200 * 100 + 100 * 300,
        ttWeightCalls: 400,
        ttSum: 300,
        ttRows: 2,
      });
      const quality = { audits: 2, score: 90 };
      const weighted = preSalesMetricsFromTotals(totals, quality, { ...defaultPreSalesPlan, talkMethod: 'weighted' });
      const simple = preSalesMetricsFromTotals(totals, quality, { ...defaultPreSalesPlan, talkMethod: 'simple' });
      return {
        passed: weighted.avgTalkSeconds === 125 && simple.avgTalkSeconds === 150,
        expected: 'weighted 125, simple 150',
        actual: `weighted ${weighted.avgTalkSeconds}, simple ${simple.avgTalkSeconds}`,
      };
    },
  },

  // 23. Raw sheet rows -> aggregate -> incentive (Sunday row with blank values is ignored)
  {
    id: 23,
    description:
      'Pre Sales from sheet rows: calls 110 + 130, talk 180 s + 200 s (weighted 191), quality 88 -> 1000 + 1000 = 2000',
    run: () => {
      const base = {
        Agent_Email_Official: 'ps@test.local',
        Agent_Location: 'Dighe',
        Agent_Tier: 'PreSales',
      };
      const rows = [
        { ...base, Date: '2026-10-01', Inbound_Calls: 110, Avg_TT_per_day: 180, Day: 1 },
        { ...base, Date: '2026-10-02', Inbound_Calls: 130, Avg_TT_per_day: 200, Day: 1 },
        { ...base, Date: '2026-10-04', Inbound_Calls: '', Avg_TT_per_day: '', Day: 0 },
      ];
      const agg = aggregateAgent(rows, { Agent_Email_Official: 'ps@test.local', Total_Audits: 4, Average_Audit_Score: 88 });
      const metrics = preSalesMetricsFromTotals(agg.totals, agg.quality, defaultPreSalesPlan);
      const res = calculatePreSales(metrics, defaultPreSalesPlan);
      const passed =
        agg.totals.calls === 240 &&
        agg.totals.activeDays === 2 &&
        agg.daily.length === 3 &&
        metrics.avgCalls === 120 &&
        metrics.avgTalkSeconds === 191 &&
        res.total === 2000;
      return {
        passed,
        expected: 'calls 240, active days 2, 3 daily rows, avgCalls 120, avgTalk 191, total 2000',
        actual: `calls ${agg.totals.calls}, active days ${agg.totals.activeDays}, ${agg.daily.length} daily rows, avgCalls ${metrics.avgCalls}, avgTalk ${metrics.avgTalkSeconds}, total ${res.total}`,
      };
    },
  },

  // 24. Agent_Tier text: "PreSales" (as in the sheet), "Pre Sales", and messy spellings all map to Pre Sales
  {
    id: 24,
    description: "Agent_Tier 'PreSales', 'Pre Sales' and ' pre-sales ' -> PRE_SALES; unknown or blank -> not mapped",
    run: () => {
      const map: Record<string, AgentType> = {
        'HO Callers': 'HO',
        'Store Callers': 'STORE',
        PreSales: 'PRE_SALES',
      };
      const got = [
        resolveAgentType(map, 'PreSales'),
        resolveAgentType(map, 'Pre Sales'),
        resolveAgentType(map, ' pre-sales '),
        resolveAgentType(map, 'HO Callers'),
        resolveAgentType(map, 'store callers'),
        resolveAgentType(map, 'Trainee'),
        resolveAgentType(map, ''),
      ];
      const want = ['PRE_SALES', 'PRE_SALES', 'PRE_SALES', 'HO', 'STORE', null, null];
      return {
        passed: got.every((v, i) => v === want[i]),
        expected: want.join(', '),
        actual: got.join(', '),
      };
    },
  },

  // 25. Quality warning: "within 1 point of a band limit" (design section 8.1), not only exactly at it
  {
    id: 25,
    description: 'Quality warning shows at a band limit and 1 point above it (85, 86, 90, 91), not at 84, 87, 89 or 92',
    run: () => {
      const warns = (score: number) =>
        buildSuggestions(hoRecordWithQuality(score), defaultHOPlan, testCycle).some((s) => s.id === 'warning-quality');
      const got: Record<number, boolean> = {};
      for (const s of [84, 85, 86, 87, 89, 90, 91, 92]) got[s] = warns(s);
      const want: Record<number, boolean> = { 84: false, 85: true, 86: true, 87: false, 89: false, 90: true, 91: true, 92: false };
      return {
        passed: Object.keys(want).every((k) => got[+k] === want[+k]),
        expected: JSON.stringify(want),
        actual: JSON.stringify(got),
      };
    },
  },

  // 26. Working days left with no data yet: 61 calendar days x 6 / 7, the same in every time zone
  {
    id: 26,
    description: 'No data yet: remaining working days from 30 Sep to 30 Nov = 61 x 6/7 = 52.3',
    run: () => {
      const days = calculateRemainingWorkingDays('', '2026-10-01', '2026-11-30', 6);
      const afterData = calculateRemainingWorkingDays('2026-11-15', '2026-10-01', '2026-11-30', 6);
      return {
        passed: days === 52.3 && afterData === 12.9,
        expected: '52.3 and 12.9',
        actual: `${days} and ${afterData}`,
      };
    },
  },

  // 27. Screens read the class ladder from the plan (limits, rates, first rupee of each class)
  {
    id: 27,
    description: 'Class ladder from the plan: A/B/C/D at 90/100/120/160%, rates 0.15/0.30/0.45/0.60%, HO class A starts at Rs 81,00,001',
    run: () => {
      const steps = classSteps(defaultHOPlan);
      const custom: Plan = {
        ...defaultHOPlan,
        classes: [
          { name: 'NQ', abovePct: 0, rate: 0 },
          { name: 'S', abovePct: 95, rate: 0.002 },
          { name: 'G', abovePct: 130, rate: 0.005 },
        ],
      };
      const cs = classSteps(custom);
      const passed =
        steps.map((s) => `${s.name}${s.abovePct}`).join() === 'A90,B100,C120,D160' &&
        steps.map((s) => s.ratePct).join() === '0.15,0.30,0.45,0.60' &&
        steps[0].minSales === 8100001 &&
        steps[3].isTop === true &&
        scaleMaxPct(defaultHOPlan) === 180 &&
        classRank(defaultHOPlan, 'NQ') === 0 &&
        classRank(defaultHOPlan, 'D') === 4 &&
        cs.map((s) => `${s.name}${s.abovePct}`).join() === 'S95,G130' &&
        cs[1].isTop === true &&
        classRank(custom, 'G') === 2;
      return {
        passed,
        expected: 'A90,B100,C120,D160 | 0.15,0.30,0.45,0.60 | 8100001 | scale 180 | custom plan S95,G130',
        actual: `${steps.map((s) => `${s.name}${s.abovePct}`).join()} | ${steps.map((s) => s.ratePct).join()} | ${steps[0]?.minSales} | scale ${scaleMaxPct(defaultHOPlan)} | ${cs.map((s) => `${s.name}${s.abovePct}`).join()}`,
      };
    },
  },

  // 28. AI text is only shown for the exact numbers it was written for
  {
    id: 28,
    description: 'AI text fingerprint: valid for the same numbers, dropped when sales or the audit score change',
    run: () => {
      const a = hoRecordWithQuality(88);
      const withText: AgentRecord = {
        ...a,
        aiSuggestions: { lastDataDate: a.lastDataDate, fingerprint: aiFingerprint(a), headline: 'Keep going' },
      };
      const changedSales: AgentRecord = { ...withText, totals: { ...withText.totals, sales: withText.totals.sales + 1000 } };
      const changedQuality: AgentRecord = { ...withText, quality: { ...withText.quality, score: 90 } };
      const oldStyle: AgentRecord = { ...a, aiSuggestions: { lastDataDate: a.lastDataDate, headline: 'x' } };
      const oldStyleNewDate: AgentRecord = { ...oldStyle, lastDataDate: '2026-10-11' };
      const got = [
        aiTextIsCurrent(withText),
        aiTextIsCurrent(changedSales),
        aiTextIsCurrent(changedQuality),
        aiTextIsCurrent(a),
        aiTextIsCurrent(oldStyle),
        aiTextIsCurrent(oldStyleNewDate),
      ];
      const want = [true, false, false, false, true, false];
      return {
        passed: got.every((v, i) => v === want[i]),
        expected: want.join(', '),
        actual: got.join(', '),
      };
    },
  },
  // 29. Revenue leaderboards rank by revenue, not by the bucketed incentive payout
  {
    id: 29,
    description: 'Leaderboard: Dighe/Andheri/Bangalore rank by revenue (top seller #1 even with a smaller incentive); Pre Sales keeps its incentive order',
    run: () => {
      const rev = (name: string, location: string, agentType: AgentType, sales: number, total: number) =>
        ({
          name,
          officialEmail: `${name.toLowerCase().replace(/ /g, '.')}@test.local`,
          location,
          agentType,
          isTest: false,
          totals: { sales },
          result: { total, achievementPct: 0, className: 'B' },
        }) as unknown as AgentRecord;
      const agents: AgentRecord[] = [
        rev('Big Bucket', 'Dighe', 'HO', 600000, 9000),
        rev('Huned Shaikh', 'Dighe', 'HO', 874473, 4000),
        rev('Mid Seller', 'Dighe', 'HO', 700000, 9000),
        rev('Store Two', 'Andheri', 'STORE', 300000, 5000),
        rev('Store One', 'Andheri', 'STORE', 450000, 1000),
        { ...rev('PS Low Incentive', 'Dighe (Pre Sales)', 'PRE_SALES', 0, 500), result: { total: 500 } } as unknown as AgentRecord,
        { ...rev('PS High Incentive', 'Dighe (Pre Sales)', 'PRE_SALES', 0, 2000), result: { total: 2000 } } as unknown as AgentRecord,
      ];
      const dighe = buildLocationRows(agents, 'Dighe', false).map((r) => `${r.rank}:${r.name}`).join(', ');
      const andheri = buildLocationRows(agents, 'Andheri', false).map((r) => `${r.rank}:${r.name}`).join(', ');
      const ps = buildLocationRows(agents, 'Dighe (Pre Sales)', false).map((r) => `${r.rank}:${r.name}`).join(', ');
      // A board stored by older code (incentive order) is re-ranked by revenue when served.
      const stale = [
        { rank: 1, name: 'Big Bucket', sales: 600000 },
        { rank: 2, name: 'Mid Seller', sales: 700000 },
        { rank: 3, name: 'Huned Shaikh', sales: 874473 },
      ];
      const reranked = rankRevenueRows(stale, 'Dighe').map((r) => `${r.rank}:${r.name}`).join(', ');
      const psUntouched = rankRevenueRows(stale, 'Dighe (Pre Sales)') === stale;
      const actual = `${dighe} | ${andheri} | ${ps} | ${reranked} | ps rows untouched ${psUntouched}`;
      const expected =
        '1:Huned Shaikh, 2:Mid Seller, 3:Big Bucket | 1:Store One, 2:Store Two | 1:PS High Incentive, 2:PS Low Incentive | ' +
        '1:Huned Shaikh, 2:Mid Seller, 3:Big Bucket | ps rows untouched true';
      return { passed: actual === expected, expected, actual };
    },
  },
];
