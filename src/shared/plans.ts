import { Plan } from './types';

export const standardClasses = [
  { name: 'NQ', abovePct: 0, rate: 0 },
  { name: 'A', abovePct: 90, rate: 0.0015 },
  { name: 'B', abovePct: 100, rate: 0.003 },
  { name: 'C', abovePct: 120, rate: 0.0045 },
  { name: 'D', abovePct: 160, rate: 0.006 },
];

export const standardBonuses = {
  quality: {
    high: 90,
    mid: 85,
    amounts: {
      NQ: [1000, 800] as [number, number],
      A: [1300, 1000] as [number, number],
      B: [1300, 1000] as [number, number],
      C: [1500, 1100] as [number, number],
      D: [2500, 1500] as [number, number],
    },
  },
  connects: {
    high: 145,
    mid: 140,
    amounts: {
      NQ: [1100, 800] as [number, number],
      A: [1300, 900] as [number, number],
      B: [1300, 900] as [number, number],
      C: [1500, 1100] as [number, number],
      D: [2500, 1500] as [number, number],
    },
  },
  talkMinutes: {
    high: 180,
    mid: 165,
    amounts: {
      NQ: [1000, 700] as [number, number],
      A: [1500, 1000] as [number, number],
      B: [1500, 1000] as [number, number],
      C: [1800, 1250] as [number, number],
      D: [3000, 1800] as [number, number],
    },
  },
};

export const defaultHOPlan: Plan = {
  target: 9000000,
  classes: standardClasses,
  bonuses: standardBonuses,
  visitTiers: [
    { tier: 1, min: 110, payout: 2200 },
    { tier: 2, min: 160, payout: 4000 },
    { tier: 3, min: 200, payout: 5000 },
    { tier: 4, min: 220, payout: 7000 },
  ],
  deductionRules: [],
};

export const defaultSTOREPlan: Plan = {
  target: 13000000,
  classes: standardClasses,
  bonuses: standardBonuses,
  visitTiers: [
    { tier: 1, min: 225, payout: 2200 },
    { tier: 2, min: 290, payout: 4000 },
    { tier: 3, min: 360, payout: 5000 },
    { tier: 4, min: 420, payout: 7000 },
  ],
  deductionRules: [],
};
