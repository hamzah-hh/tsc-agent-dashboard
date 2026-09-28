export interface PlanClass {
  name: string;
  abovePct: number;
  rate: number;
}

export interface BonusBandConfig {
  high: number;
  mid: number;
  amounts: Record<string, [number, number]>; // className -> [HighAmount, MidAmount]
}

export interface VisitTier {
  tier: number;
  min: number;
  payout: number;
}

export interface DeductionRule {
  metric: 'absentDays' | 'qualityScore';
  op: '<' | '<=' | '>' | '>=' | '=';
  threshold: number;
  type: 'fixed' | 'percent';
  value: number;
}

export interface Plan {
  target: number;
  classes: PlanClass[];
  bonuses: {
    quality: BonusBandConfig;
    connects: BonusBandConfig;
    talkMinutes: BonusBandConfig;
  };
  visitTiers: VisitTier[];
  deductionRules: DeductionRule[];
}

export type AgentType = 'HO' | 'STORE' | 'PRE_SALES';

/** One payout step of a Pre Sales incentive. The value must be at least `min` (inclusive). */
export interface PreSalesTier {
  min: number;
  payout: number;
}

/**
 * Pre Sales plan: two incentives (inbound calls per day, average talk time in seconds).
 * Both are paid only when the Quality Score is at least `qualityGate`.
 */
export interface PreSalesPlan {
  qualityGate: number;
  calls: PreSalesTier[];
  talkSeconds: PreSalesTier[];
  // 'weighted' = total talk time / total calls (Inbound_Calls weights each day's average)
  // 'simple'   = plain average of the daily values
  talkMethod: 'weighted' | 'simple';
}

export interface PreSalesMetrics {
  avgCalls: number;
  avgTalkSeconds: number;
  qualityScore: number | null;
}

export interface PreSalesLineResult {
  value: number; // whole-number metric used to pick the tier
  tier: number; // 0 = below the first tier
  payout: number; // tier payout before the quality gate
  amount: number; // amount actually paid (0 when the quality gate is not met)
}

export interface PreSalesResult {
  qualityScore: number | null;
  qualityGate: number;
  eligible: boolean;
  calls: PreSalesLineResult;
  talk: PreSalesLineResult;
  potentialTotal: number; // what both tiers would pay if the quality gate were met
}

export interface AppConfig {
  superAdmins: string[];
  managers: string[];
  activeCycleId: string;
  tierMap: Record<string, AgentType>;
  locations: string[];
  testMode: boolean;
  aiEnabled: boolean;
  aiTone: 'english' | 'hinglish';
}

export interface AccessRecord {
  role: 'agent' | 'tl';
  officialEmail: string;
  name: string;
  location: string;
  isTest?: boolean;
}

export interface Cycle {
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
  workingDaysPerWeek: number;
  plans: {
    HO: Plan;
    STORE: Plan;
    PRE_SALES?: PreSalesPlan;
  };
}

export interface AgentDailyEntry {
  date: string;
  sales: number;
  orders: number;
  connects: number;
  talkSeconds: number;
  visitsBooked: number;
  visitsAttributed: number;
  day: number;
  // Pre Sales only
  calls?: number;
  avgTalkSec?: number;
}

export interface AgentTotals {
  sales: number;
  orders: number;
  connects: number;
  talkSeconds: number;
  visitsBooked: number;
  visitsAttributed: number;
  activeDays: number;
  // Pre Sales only (optional, so existing HO / Store records stay valid)
  calls?: number; // sum of Inbound_Calls
  ttWeightedSum?: number; // sum of Avg_TT_per_day x Inbound_Calls
  ttWeightCalls?: number; // sum of Inbound_Calls on rows that have an Avg_TT_per_day value
  ttSum?: number; // sum of Avg_TT_per_day over worked days
  ttRows?: number; // number of worked days that have an Avg_TT_per_day value
}

export interface QualitySummary {
  audits: number;
  score: number;
}

export interface MetricDeductionResult {
  rule: DeductionRule;
  amount: number;
}

export interface BonusResult {
  value: number | null;
  band: 'High' | 'Mid' | 'None';
  amount: number;
}

export interface IncentiveResult {
  achievementPct: number;
  className: string;
  rate: number;
  revenueIncentiveGross: number;
  deductions: MetricDeductionResult[];
  revenueIncentiveNet: number;
  quality: BonusResult;
  connects: BonusResult;
  talk: BonusResult;
  rider: {
    tier: number;
    amount: number;
  };
  total: number;
  // Present only for Pre Sales agents (className is 'PS' and the revenue fields are 0)
  preSales?: PreSalesResult;
}

export interface AgentRecord {
  name: string;
  officialEmail: string;
  personalEmail: string;
  location: string;
  agentType: AgentType;
  tlOfficialEmail: string;
  tlPersonalEmail: string;
  totals: AgentTotals;
  daily: AgentDailyEntry[];
  quality: QualitySummary;
  absentDays: number | null;
  lastDataDate: string;
  result: IncentiveResult;
  isTest?: boolean;
  updatedAt: string;
  aiSuggestions?: {
    lastDataDate: string;
    headline?: string;
    items?: Array<{ id: string; text: string }>;
  };
}

export interface Suggestion {
  id: string;
  type:
    | 'nextClass'
    | 'ordersNeeded'
    | 'fastestBonus'
    | 'storeVisits'
    | 'projection'
    | 'warning'
    | 'streak'
    | 'milestone'
    | 'headline';
  priority: number;
  gainRupees: number;
  numbers: Record<string, number>;
  defaultText: string;
  difficult: boolean;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  officialEmail: string;
  sales: number;
  achievementPct: number;
  className: string;
  totalIncentive: number;
}

export interface LeaderboardRecord {
  location: string;
  updatedAt: string;
  rows: LeaderboardRow[];
}

export interface SyncLogRecord {
  time: string;
  source: 'apps-script' | 'import' | 'test';
  result: 'ok' | 'error';
  rows?: number;
  agents?: number;
  lastDataDate?: string;
  warnings?: string[];
  error?: string;
  aiOk?: number;
  aiFailed?: number;
}

export interface RawMainRow {
  Date?: any;
  Month?: any;
  Agent_Name?: any;
  Agent_Email_Official?: any;
  Agent_Email_Personal?: any;
  Agent_Location?: any;
  Agent_Tier?: any;
  Count_of_Orders?: any;
  Sales?: any;
  Average_Order_Value?: any;
  Unique_Connects?: any;
  'Talk_Time_(seconds)'?: any;
  TL_Official_Email?: any;
  TL_Personal_Email?: any;
  Store_Visits_Booked?: any;
  Store_Visits_Attributed?: any;
  Day?: any;
  Inbound_Calls?: any; // Pre Sales
  Avg_TT_per_day?: any; // Pre Sales (average talk time, seconds)
  [key: string]: any;
}

export interface RawQualityRow {
  Agent_Email_Official?: any;
  Total_Audits?: any;
  Average_Audit_Score?: any;
  [key: string]: any;
}

export interface ProcessedMetrics {
  sales: number;
  avgConnects: number;
  avgTalkMinutes: number;
  qualityScore: number | null;
  visitsAttributed: number;
  absentDays: number | null;
}
