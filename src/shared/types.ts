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

export interface AppConfig {
  superAdmins: string[];
  managers: string[];
  activeCycleId: string;
  tierMap: Record<string, 'HO' | 'STORE'>;
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
}

export interface AgentTotals {
  sales: number;
  orders: number;
  connects: number;
  talkSeconds: number;
  visitsBooked: number;
  visitsAttributed: number;
  activeDays: number;
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
}

export interface AgentRecord {
  name: string;
  officialEmail: string;
  personalEmail: string;
  location: string;
  agentType: 'HO' | 'STORE';
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
