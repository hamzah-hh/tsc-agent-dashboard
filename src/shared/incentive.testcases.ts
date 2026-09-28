import { calculateFromMetrics, metricsFromTotals } from './incentive';
import { defaultHOPlan, defaultSTOREPlan } from './plans';
import { Plan, ProcessedMetrics } from './types';

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
];
