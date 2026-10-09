import { adminDb } from './server-firebase-admin';
import { loadEnv } from './server-env';
import {
  aggregateAgent,
  calculateFromMetrics,
  calculatePreSales,
  metricsFromTotals,
  normalizeEmail,
  parseToISTDateString,
  preSalesMetricsFromTotals,
  resolveAgentType,
} from './src/shared/incentive';
import {
  defaultHOPlan,
  defaultPreSalesPlan,
  defaultSTOREPlan,
  getPreSalesPlan,
} from './src/shared/plans';
import { buildLocationRows, isTestAgentIdentifier } from './src/shared/leaderboard';
import { buildTeamRevenue } from './src/shared/revenue';
import { aiFingerprint, aiTextIsCurrent } from './src/shared/aiText';
import {
  AgentRecord,
  AppConfig,
  Cycle,
  IncentiveResult,
  LeaderboardRecord,
  RawMainRow,
  RawQualityRow,
  SyncLogRecord,
} from './src/shared/types';
import { isAiConfigured, runBatchAiGeneration } from './server-ai';
import { DEFAULT_RAW_SHEET_URL, saveRawPayload, syncRawSheetData } from './server-raw-data';

const REQUIRED_MAIN_HEADERS = [
  'Date',
  'Agent_Name',
  'Agent_Email_Official',
  'Agent_Email_Personal',
  'Agent_Location',
  'Agent_Tier',
  'Count_of_Orders',
  'Sales',
  'Unique_Connects',
  'Talk_Time_Minutes',
  'Store_Visits',
  'Day',
];

const REQUIRED_QUALITY_HEADERS = [
  'Agent_Email_Official',
  'Total_Audits',
  'Average_Audit_Score',
];

/**
 * Canonicalizes raw spreadsheet header names into our standard keys,
 * forgiving whitespace, punctuation, casing, and common naming variations.
 */
export function canonicalizeMainHeader(rawHeader: string): string {
  const clean = String(rawHeader || '').trim();
  const normalized = clean.toLowerCase().replace(/[\s_\-\(\)\[\]\.\/\\]+/g, '');

  // Talk Time (all variations map directly to Talk_Time_Minutes with no conversion)
  if (
    normalized === 'talktimemins' ||
    normalized === 'talktimemin' ||
    normalized === 'talktimeminutes' ||
    normalized === 'talkminutes' ||
    normalized === 'talkmins' ||
    normalized === 'talkdurationmins' ||
    normalized === 'talkdurationminutes' ||
    normalized === 'totaltalktimemins' ||
    normalized === 'totaltalktimeminutes' ||
    normalized === 'talktimem' ||
    normalized === 'talktimeseconds' ||
    normalized === 'talktime' ||
    normalized === 'talkseconds' ||
    normalized === 'talktimesec' ||
    normalized === 'talktimesecs' ||
    normalized === 'talkduration' ||
    normalized === 'talkdurationseconds' ||
    normalized === 'totaltalktime' ||
    normalized === 'totaltalktimeseconds' ||
    normalized === 'talktimeinmins'
  ) {
    return 'Talk_Time_Minutes';
  }

  // TL Personal Email (Optional)
  if (
    normalized === 'tlpersonalemail' ||
    normalized === 'tlemailpersonal' ||
    normalized === 'tlpersonal' ||
    normalized === 'tlemail' ||
    normalized === 'teamleaderpersonalemail' ||
    normalized === 'teamleaderemail' ||
    normalized === 'teamleaderpersonal' ||
    normalized === 'tlgmail' ||
    normalized === 'tlpersonalmail'
  ) {
    return 'TL_Personal_Email';
  }

  // TL Official Email (Optional)
  if (
    normalized === 'tlofficialemail' ||
    normalized === 'tlemailofficial' ||
    normalized === 'tlofficial' ||
    normalized === 'teamleaderofficialemail' ||
    normalized === 'teamleaderofficial'
  ) {
    return 'TL_Official_Email';
  }

  // Store Visits
  if (
    normalized === 'storevisits' ||
    normalized === 'visits' ||
    normalized === 'storevisitsattributed' ||
    normalized === 'visitsattributed' ||
    normalized === 'attributedstorevisits' ||
    normalized === 'attributedvisits' ||
    normalized === 'storevisitsbooked' ||
    normalized === 'visitsbooked' ||
    normalized === 'bookedstorevisits' ||
    normalized === 'bookedvisits'
  ) {
    return 'Store_Visits';
  }

  // Agent Name
  if (
    normalized === 'agentname' ||
    normalized === 'name' ||
    normalized === 'agent'
  ) {
    return 'Agent_Name';
  }

  // Agent Email Official
  if (
    normalized === 'agentemailofficial' ||
    normalized === 'agentofficialemail' ||
    normalized === 'officialemail' ||
    normalized === 'workemail' ||
    normalized === 'companyemail' ||
    normalized === 'agentemail'
  ) {
    return 'Agent_Email_Official';
  }

  // Agent Email Personal
  if (
    normalized === 'agentemailpersonal' ||
    normalized === 'agentpersonalemail' ||
    normalized === 'personalemail' ||
    normalized === 'gmail' ||
    normalized === 'loginemail'
  ) {
    return 'Agent_Email_Personal';
  }

  // Agent Location
  if (
    normalized === 'agentlocation' ||
    normalized === 'location' ||
    normalized === 'branch' ||
    normalized === 'city'
  ) {
    return 'Agent_Location';
  }

  // Agent Tier
  if (
    normalized === 'agenttier' ||
    normalized === 'tier' ||
    normalized === 'lob' ||
    normalized === 'category' ||
    normalized === 'role'
  ) {
    return 'Agent_Tier';
  }

  // Count of Orders
  if (
    normalized === 'countoforders' ||
    normalized === 'orders' ||
    normalized === 'ordercount' ||
    normalized === 'totalorders'
  ) {
    return 'Count_of_Orders';
  }

  // Sales
  if (
    normalized === 'sales' ||
    normalized === 'revenue' ||
    normalized === 'netsales' ||
    normalized === 'totalsales' ||
    normalized === 'turnover'
  ) {
    return 'Sales';
  }

  // Average Order Value
  if (
    normalized === 'averageordervalue' ||
    normalized === 'aov' ||
    normalized === 'avgordervalue'
  ) {
    return 'Average_Order_Value';
  }

  // Unique Connects
  if (
    normalized === 'uniqueconnects' ||
    normalized === 'connects' ||
    normalized === 'totalconnects' ||
    normalized === 'callsconnected'
  ) {
    return 'Unique_Connects';
  }

  // Day
  if (
    normalized === 'day' ||
    normalized === 'workingday' ||
    normalized === 'active' ||
    normalized === 'workedday' ||
    normalized === 'activedays'
  ) {
    return 'Day';
  }

  // Month
  if (normalized === 'month') {
    return 'Month';
  }

  // Date
  if (normalized === 'date') {
    return 'Date';
  }

  // Pre Sales: Inbound Calls
  if (
    normalized === 'inboundcalls' ||
    normalized === 'calls' ||
    normalized === 'totalcalls' ||
    normalized === 'dailycalls'
  ) {
    return 'Inbound_Calls';
  }

  // Pre Sales: Avg TT per day
  if (
    normalized === 'avgttperday' ||
    normalized === 'avgtt' ||
    normalized === 'averagett' ||
    normalized === 'avgttsec' ||
    normalized === 'talktimepercall' ||
    normalized === 'averagetalktime' ||
    normalized === 'avgttseconds'
  ) {
    return 'Avg_TT_per_day';
  }

  return clean;
}

/** Header key with case, spaces and punctuation removed: " Agent Email (Personal) " -> "agentemailpersonal". */
function headerKey(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The first non-empty value among the given column names, matched by headerKey. Values may be numbers. */
function pickColumn(row: Record<string, any>, ...names: string[]): string {
  const values = new Map<string, any>();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey(k), v);
  for (const name of names) {
    const v = values.get(headerKey(name));
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function normalizeRawMainRow(row: Record<string, any>): RawMainRow {
  const normalized: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const canonical = canonicalizeMainHeader(k);
    normalized[canonical] = v;
  }
  // Safe defaults for optional fields
  if (normalized.Store_Visits === undefined) {
    normalized.Store_Visits = 0;
  }
  if (normalized.TL_Personal_Email === undefined) {
    normalized.TL_Personal_Email = '';
  }
  if (normalized.TL_Official_Email === undefined) {
    normalized.TL_Official_Email = '';
  }
  // Talk_Time is stored in MINUTES. Copy directly with no conversion.
  const rawTalk = normalized['Talk_Time_Minutes'];
  if (rawTalk !== undefined) {
    normalized['Talk_Time_Minutes'] = typeof rawTalk === 'number' ? rawTalk : parseFloat(String(rawTalk).replace(/[^0-9.-]+/g, '')) || 0;
  } else {
    normalized['Talk_Time_Minutes'] = 0;
  }
  if (normalized.Month === undefined && normalized.Date) {
    const d = new Date(normalized.Date);
    normalized.Month = !isNaN(d.getTime())
      ? d.toLocaleString('en-US', { month: 'short', year: '2-digit' })
      : '';
  }
  if (normalized.Average_Order_Value === undefined) {
    const s = Number(normalized.Sales) || 0;
    const o = Number(normalized.Count_of_Orders) || 0;
    normalized.Average_Order_Value = o > 0 ? Math.round(s / o) : 0;
  }
  return normalized as RawMainRow;
}

export function canonicalizeQualityHeader(rawHeader: string): string {
  const clean = String(rawHeader || '').trim();
  const normalized = clean.toLowerCase().replace(/[\s_\-\(\)\[\]\.\/\\]+/g, '');
  if (
    normalized === 'agentemailofficial' ||
    normalized === 'agentofficialemail' ||
    normalized === 'officialemail' ||
    normalized === 'agentemail' ||
    normalized === 'email'
  ) {
    return 'Agent_Email_Official';
  }
  if (
    normalized === 'totalaudits' ||
    normalized === 'audits' ||
    normalized === 'auditcount' ||
    normalized === 'countofaudits'
  ) {
    return 'Total_Audits';
  }
  if (
    normalized === 'averageauditscore' ||
    normalized === 'auditscore' ||
    normalized === 'avgscore' ||
    normalized === 'qualityscore' ||
    normalized === 'score' ||
    normalized === 'avgauditscore'
  ) {
    return 'Average_Audit_Score';
  }
  return clean;
}

export function normalizeRawQualityRow(row: Record<string, any>): RawQualityRow {
  const normalized: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const canonical = canonicalizeQualityHeader(k);
    normalized[canonical] = v;
  }
  return normalized as RawQualityRow;
}

// Pre Sales columns. Not required for the sheet as a whole (HO and Store rows leave them blank),
// but a Pre Sales agent cannot be calculated without them, so a missing column gives a warning.
const PRE_SALES_HEADERS = ['Inbound_Calls', 'Avg_TT_per_day'];

// The first Super Admin of a brand-new project. Override with SUPER_ADMIN_EMAILS (comma separated).
const DEFAULT_SUPER_ADMIN = 'agha.h489@gmail.com';

/** No new AI call is started after this long in a sync, so Gemini can never hold up a sync. */
const DEFAULT_AI_SYNC_BUDGET_MS = 35000;

function envEmails(name: string): string[] {
  loadEnv();
  return (process.env[name] || '')
    .split(/[,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function defaultTierMap(): AppConfig['tierMap'] {
  return {
    'HO Callers': 'HO',
    'Store Callers': 'STORE',
    PreSales: 'PRE_SALES',
    'Pre Sales': 'PRE_SALES',
    'Dighe (Pre Sales)': 'PRE_SALES',
  };
}

/** config/app of a brand-new project. Managers are added in the Admin tab (or with MANAGER_EMAILS). */
export function defaultAppConfig(): AppConfig {
  const superAdmins = envEmails('SUPER_ADMIN_EMAILS');
  const managers = envEmails('MANAGER_EMAILS');
  return {
    superAdmins: superAdmins.length > 0 ? superAdmins : [DEFAULT_SUPER_ADMIN],
    managers,
    activeCycleId: 'diwali-2026',
    tierMap: defaultTierMap(),
    locations: ['Dighe (Pre Sales)', 'Dighe', 'Andheri', 'Bangalore'],
    testMode: true,
    aiEnabled: false,
    aiTone: 'english',
    googleSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing',
    legacyManagerMigrated: true,
  };
}

// Was given Manager access in the code itself. Moved once into config/app.managers so that the
// Admin tab can remove the access like anyone else's.
const LEGACY_CODE_MANAGER = 'snehatsc@gmail.com';

/**
 * Makes sure config/app and the active cycle exist.
 * - A missing config/app is created once. After that, nobody's access is changed behind their back:
 *   a manager who is removed stays removed. Only an empty Super Admin list is repaired, so the
 *   app can never be left without an administrator.
 * - Documents from an older version are upgraded in place (Pre Sales tier and plan). Safe to repeat.
 */
// Per-server-instance read cache. Every page load used to re-read config/app, the cycle and the whole
// agents collection, which runs into Firestore's free daily read quota. Entries live CACHE_TTL_MS and are
// dropped by invalidateReadCache() after any write this server makes (sync, import, Admin changes).
// Another instance may serve data up to CACHE_TTL_MS old.
const CACHE_TTL_MS = 30000;
let seedCache: { at: number; value: { appConfig: AppConfig; cycle: Cycle } } | null = null;
const agentsCache = new Map<string, { at: number; value: AgentRecord[] }>();

export function invalidateReadCache(): void {
  seedCache = null;
  agentsCache.clear();
}

/** Makes sure config/app and the active cycle exist (cached for a few seconds, see CACHE_TTL_MS). */
export async function ensureSeedData(): Promise<{ appConfig: AppConfig; cycle: Cycle }> {
  if (seedCache && Date.now() - seedCache.at < CACHE_TTL_MS) {
    // Copies, so a caller that changes the objects cannot change the cache
    return structuredClone(seedCache.value);
  }
  const value = await ensureSeedDataUncached();
  seedCache = { at: Date.now(), value: structuredClone(value) };
  return value;
}

async function ensureSeedDataUncached(): Promise<{ appConfig: AppConfig; cycle: Cycle }> {
  let appConfig: AppConfig = defaultAppConfig();

  try {
    const configRef = adminDb.collection('config').doc('app');
    const configSnap = await configRef.get();

    if (!configSnap.exists) {
      await configRef.set(appConfig);
    } else {
      appConfig = configSnap.data() as AppConfig;
      const patch: Partial<AppConfig> = {};

      if (!Array.isArray(appConfig.superAdmins) || appConfig.superAdmins.length === 0) {
        appConfig.superAdmins = defaultAppConfig().superAdmins;
        patch.superAdmins = appConfig.superAdmins;
      }
      if (!Array.isArray(appConfig.managers)) {
        appConfig.managers = [];
        patch.managers = appConfig.managers;
      }
      if (!appConfig.legacyManagerMigrated) {
        if (!appConfig.managers.map(normalizeEmail).includes(LEGACY_CODE_MANAGER)) {
          appConfig.managers = [...appConfig.managers, LEGACY_CODE_MANAGER];
          patch.managers = appConfig.managers;
        }
        appConfig.legacyManagerMigrated = true;
        patch.legacyManagerMigrated = true;
      }
      if (!appConfig.activeCycleId) {
        appConfig.activeCycleId = 'diwali-2026';
        patch.activeCycleId = appConfig.activeCycleId;
      }
      if (!Array.isArray(appConfig.locations) || appConfig.locations.length === 0) {
        appConfig.locations = ['Dighe (Pre Sales)', 'Dighe', 'Andheri', 'Bangalore'];
        patch.locations = appConfig.locations;
      } else if (!appConfig.locations.includes('Dighe (Pre Sales)')) {
        appConfig.locations.unshift('Dighe (Pre Sales)');
        patch.locations = appConfig.locations;
      }
      if (!appConfig.tierMap) {
        appConfig.tierMap = defaultTierMap();
        patch.tierMap = appConfig.tierMap;
      }
      // Older config documents: make sure the Pre Sales tier is mapped
      if (!Object.values(appConfig.tierMap).includes('PRE_SALES')) {
        appConfig.tierMap['PreSales'] = 'PRE_SALES';
        appConfig.tierMap['Pre Sales'] = 'PRE_SALES';
        patch.tierMap = appConfig.tierMap;
      }
      if (!appConfig.googleSpreadsheetUrl) {
        appConfig.googleSpreadsheetUrl = 'https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing';
        patch.googleSpreadsheetUrl = appConfig.googleSpreadsheetUrl;
      }
      if (Object.keys(patch).length > 0) {
        await configRef.set(patch, { merge: true });
      }
    }
  } catch (err: any) {
    console.warn('[ensureSeedData] Firestore read/write for config/app not accessible:', err?.message || err);
    throw err;
  }

  let cycle: Cycle = {
    name: 'Diwali 2026',
    startDate: '2026-10-01',
    endDate: '2026-11-30',
    status: 'active',
    workingDaysPerWeek: 6,
    plans: {
      HO: defaultHOPlan,
      STORE: defaultSTOREPlan,
      PRE_SALES: defaultPreSalesPlan,
    },
  };

  try {
    const cycleRef = adminDb.collection('cycles').doc(appConfig.activeCycleId || 'diwali-2026');
    const cycleSnap = await cycleRef.get();

    if (!cycleSnap.exists) {
      await cycleRef.set(cycle);
    } else {
      cycle = cycleSnap.data() as Cycle;
      // Older cycle documents: add the default Pre Sales plan
      if (cycle.plans && !cycle.plans.PRE_SALES) {
        cycle.plans.PRE_SALES = defaultPreSalesPlan;
        await cycleRef.set({ plans: cycle.plans }, { merge: true });
      }
    }
  } catch (err: any) {
    console.warn('[ensureSeedData] Firestore read/write for active cycle not accessible:', err?.message || err);
    throw err;
  }

  return { appConfig, cycle };
}

/** All agents of a cycle. */
export async function loadAgents(cycleId: string): Promise<AgentRecord[]> {
  const hit = agentsCache.get(cycleId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return structuredClone(hit.value);
  const snap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
  const agents = snap.docs.map((d) => d.data() as AgentRecord);
  agentsCache.set(cycleId, { at: Date.now(), value: structuredClone(agents) });
  return agents;
}

/**
 * One leaderboard per location. Revenue locations (Dighe, Andheri, Bangalore) are sorted by revenue
 * desc, then name A-Z; Pre Sales is sorted by total incentive, then calls, then talk time. Demo/test
 * agents only rank while test mode is on (see buildLocationRows).
 */
export function buildLeaderboardDocs(agents: AgentRecord[], appConfig: AppConfig): LeaderboardRecord[] {
  const updatedAt = new Date().toISOString();
  return appConfig.locations.map((location) => ({
    location,
    updatedAt,
    rows: buildLocationRows(agents, location, Boolean(appConfig.testMode)),
  }));
}

/** Rewrites the location leaderboards from the agents now stored (after a mode change or a clean-up). */
export async function rebuildLeaderboards(appConfig: AppConfig): Promise<void> {
  const cycleId = appConfig.activeCycleId;
  const agents = await loadAgents(cycleId);
  const col = adminDb.collection('cycles').doc(cycleId).collection('leaderboards');
  const batch = adminDb.batch();
  for (const doc of buildLeaderboardDocs(agents, appConfig)) {
    batch.set(col.doc(doc.location), doc);
  }
  await batch.commit();
}

/**
 * Deletes every test record of the active cycle: demo agents, their access records and the sync log
 * entries written by test runs. Real agents and real sync logs are not touched.
 */
export async function clearTestData(
  appConfig: AppConfig
): Promise<{ deletedAgents: number; deletedAccess: number; deletedSyncLogs: number }> {
  const cycleId = appConfig.activeCycleId;

  const [allAgentsSnap, allAccessSnap, logsSnap] = await Promise.all([
    adminDb.collection('cycles').doc(cycleId).collection('agents').get(),
    adminDb.collection('access').get(),
    adminDb.collection('syncLogs').where('source', '==', 'test').get(),
  ]);

  const batch = adminDb.batch();
  let deletedAgents = 0;
  allAgentsSnap.forEach((d) => {
    const data = d.data();
    if (
      data.isTest ||
      isTestAgentIdentifier(d.id, data.name) ||
      isTestAgentIdentifier(data.officialEmail, data.name)
    ) {
      batch.delete(d.ref);
      deletedAgents++;
    }
  });

  let deletedAccess = 0;
  allAccessSnap.forEach((d) => {
    const data = d.data();
    if (
      data.isTest ||
      isTestAgentIdentifier(d.id, data.name) ||
      isTestAgentIdentifier(data.officialEmail, data.name)
    ) {
      batch.delete(d.ref);
      deletedAccess++;
    }
  });

  logsSnap.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  await rebuildLeaderboards(appConfig);

  return {
    deletedAgents,
    deletedAccess,
    deletedSyncLogs: logsSnap.size,
  };
}

/** Saves new AI text on the agent records. Only the aiSuggestions field is written. */
export async function saveAiText(cycleId: string, agents: AgentRecord[]): Promise<void> {
  const col = adminDb.collection('cycles').doc(cycleId).collection('agents');
  const batch = adminDb.batch();
  for (const agent of agents) {
    if (agent.aiSuggestions) {
      batch.set(col.doc(agent.officialEmail), { aiSuggestions: agent.aiSuggestions }, { merge: true });
    }
  }
  await batch.commit();
}

export interface ProcessImportResult {
  result: 'ok' | 'error';
  rows?: number;
  agents?: number;
  lastDataDate?: string;
  warnings: string[];
  error?: string;
  aiOk?: number;
  aiFailed?: number;
  aiSkipped?: number;
  aiPending?: number;
  /** Raw_Revenue / Raw_Visit outcome; error is set when the raw data could not be saved. */
  rawData?: { ordersCount: number; visitsCount: number; error?: string };
}

export interface ProcessImportOptions {
  /** How long the sync may spend on AI text after the data is saved. */
  aiBudgetMs?: number;
  revenueRows?: any[];
  leaderMappingRows?: any[];
  excludedAgentsRows?: any[];
  rawVisitRows?: any[];
  rawRevenueTabRows?: any[];
}

export async function processImport(
  source: 'apps-script' | 'import' | 'test',
  mainRows: RawMainRow[],
  qualityRows: RawQualityRow[] = [],
  options: ProcessImportOptions = {}
): Promise<ProcessImportResult> {
  const warnings: string[] = [];
  const revenueRows = options.revenueRows || [];
  let rawData: ProcessImportResult['rawData'];

  try {
    // 1. Check and normalize rows
    if (!Array.isArray(mainRows) || mainRows.length === 0) {
      const err = 'No data rows found in MainSheet';
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    const normalizedMainRows = mainRows.map(normalizeRawMainRow);
    const normalizedQualityRows = (qualityRows || []).map(normalizeRawQualityRow);

    const sampleMain = normalizedMainRows[0] || {};
    const mainKeys = Object.keys(sampleMain);
    const missingMain = REQUIRED_MAIN_HEADERS.filter((h) => !mainKeys.includes(h));
    if (missingMain.length > 0) {
      const err = `Missing MainSheet headers: ${missingMain.join(', ')}`;
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    const preSalesColumnsMissing = PRE_SALES_HEADERS.filter((h) => !mainKeys.includes(h));
    let preSalesColumnsWarned = false;

    if (normalizedQualityRows && normalizedQualityRows.length > 0) {
      const sampleQuality = normalizedQualityRows[0] || {};
      const qualityKeys = Object.keys(sampleQuality);
      const missingQuality = REQUIRED_QUALITY_HEADERS.filter(
        (h) => !qualityKeys.includes(h)
      );
      if (missingQuality.length > 0) {
        const err = `Missing Quality headers: ${missingQuality.join(', ')}`;
        await logSync(source, 'error', 0, 0, '', [err], err);
        return { result: 'error', warnings: [err], error: err };
      }
    }

    // Load active config and cycle
    const { appConfig, cycle } = await ensureSeedData();
    const cycleId = appConfig.activeCycleId;
    const startDate = cycle.startDate;
    const endDate = cycle.endDate;

    // Load and store Excluded_Agents
    const excludedEmails = new Set<string>();
    let excludedAgentsList: { agentEmail: string; reason: string; excludedSince: string; active: boolean }[] = [];

    // Load existing excludes first
    try {
      const excludesSnap = await adminDb.collection('cycles').doc(cycleId).collection('data').doc('excludedAgents').get();
      if (excludesSnap.exists) {
        const data = excludesSnap.data();
        if (Array.isArray(data?.list)) {
          data.list.forEach((item: any) => {
            if (item.active && item.agentEmail) {
              excludedEmails.add(normalizeEmail(item.agentEmail));
            }
            excludedAgentsList.push(item);
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load existing excluded agents:', e);
    }

    // Merge new excludes if provided
    if (options.excludedAgentsRows && options.excludedAgentsRows.length > 0) {
      excludedEmails.clear();
      excludedAgentsList = [];
      for (const row of options.excludedAgentsRows) {
        const rawEmail = row['Agent_Email_Official'] || row['agentofficialemail'] || row['Agent Email Official'] || '';
        const email = normalizeEmail(rawEmail);
        if (!email) continue;
        const activeVal = String(row['Active_Exclusion'] || row['activeexclusion'] || row['Active Exclusion'] || '').trim().toLowerCase();
        const active = activeVal === 'true' || activeVal === 'yes' || activeVal === '1';
        
        excludedAgentsList.push({
          agentEmail: email,
          reason: row['Reason'] || row['reason'] || '',
          excludedSince: row['Excluded_Since'] || row['excludedsince'] || '',
          active,
        });

        if (active) {
          excludedEmails.add(email);
        }
      }
      await adminDb.collection('cycles').doc(cycleId).collection('data').doc('excludedAgents').set({
        list: excludedAgentsList,
        updatedAt: new Date().toISOString(),
      });
    }

    // Save raw visits and raw revenue detailed tables
    const hasRawPayload =
      (options.rawVisitRows && options.rawVisitRows.length > 0) ||
      (options.rawRevenueTabRows && options.rawRevenueTabRows.length > 0);

    // A raw-data failure must not block the incentive data, but it is no longer silent: the reason
    // goes into the sync result and sync log (warnings) and into rawRecordsStatus for the Raw Data view.
    try {
      if (hasRawPayload) {
        rawData = await saveRawPayload(cycleId, options.rawRevenueTabRows || [], options.rawVisitRows || [], excludedEmails);
      } else {
        // Fallback: no raw rows in the payload (an Apps Script older than the Raw_Visit / Raw_Revenue
        // reader), so read the tabs from the sheet's public CSV export.
        console.log('[Import] No raw rows in payload. Syncing raw sheet directly from', appConfig.googleSpreadsheetUrl);
        rawData = await syncRawSheetData(cycleId, appConfig.googleSpreadsheetUrl || DEFAULT_RAW_SHEET_URL);
      }
    } catch (err: any) {
      const reason = err?.message || String(err);
      rawData = { ordersCount: 0, visitsCount: 0, error: reason };
      warnings.push(`Raw data (Raw_Revenue / Raw_Visit) not saved: ${reason}`);
    }

    // Load and parse Leader_Mapping
    const leaderMappingDict = new Map<string, {
      personalEmail: string;
      tlOfficialEmail: string;
      tlPersonalEmail: string;
      status: string;
    }>();

    const rawMappings = options.leaderMappingRows || [];
    for (const row of rawMappings) {
      // Headers are matched ignoring case, spaces and punctuation, like MainSheet
      // ("Agent Personal Email", "agent_email_personal" and "Agent_Gmail_Mail" all work)
      const official = normalizeEmail(
        pickColumn(row, 'Agent_Email_Official', 'Agent_Official_Email', 'Official_Email', 'Agent_Official_Mail', 'Agent_Email')
      );
      if (!official) continue;

      const personal = normalizeEmail(
        pickColumn(row, 'Agent_Email_Personal', 'Agent_Personal_Email', 'Personal_Email', 'Agent_Gmail_Mail', 'Agent_Gmail', 'Gmail', 'Login_Email')
      );
      const tlOfficial = normalizeEmail(
        pickColumn(row, 'TL_Official_Email', 'TL_Email_Official', 'Leader_Official_Mail', 'Leader_Official_Email', 'Team_Leader_Official_Email')
      );
      const tlPersonal = normalizeEmail(
        pickColumn(row, 'TL_Personal_Email', 'TL_Email_Personal', 'Leader_Gmail_Mail', 'Leader_Personal_Email', 'TL_Gmail', 'Team_Leader_Personal_Email')
      );
      const status = pickColumn(row, 'Status') || 'Active';

      leaderMappingDict.set(official, {
        personalEmail: personal,
        tlOfficialEmail: tlOfficial,
        tlPersonalEmail: tlPersonal,
        status,
      });
    }

    // Demo users can only be created while test mode is on, so they never end up in a live database by accident
    if (source === 'test' && !appConfig.testMode) {
      const err = 'Test mode is off. Demo users can only be created while test mode is on (Admin tab > Go live / test mode).';
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    // Build quality lookup map
    const qualityMap = new Map<string, RawQualityRow>();
    if (normalizedQualityRows) {
      for (const q of normalizedQualityRows) {
        const email = normalizeEmail(q.Agent_Email_Official);
        if (email) {
          qualityMap.set(email, q);
        }
      }
    }

    // 2. Filter rows between active cycle startDate and endDate
    // Group rows by Agent_Email_Official
    const groupedByAgent = new Map<string, RawMainRow[]>();
    const validMainRows: RawMainRow[] = [];
    let validRowCount = 0;

    for (const r of normalizedMainRows) {
      const istDate = parseToISTDateString(r.Date);
      if (!istDate || istDate < startDate || istDate > endDate) {
        continue;
      }

      const officialEmail = normalizeEmail(r.Agent_Email_Official);
      if (!officialEmail) {
        continue;
      }

      validRowCount++;
      validMainRows.push(r);
      if (!groupedByAgent.has(officialEmail)) {
        groupedByAgent.set(officialEmail, []);
      }
      groupedByAgent.get(officialEmail)!.push(r);
    }

    if (groupedByAgent.size === 0) {
      const warningMsg = `No rows matched cycle date range (${startDate} to ${endDate}).`;
      warnings.push(warningMsg);
      await logSync(source, 'ok', validRowCount, 0, '', warnings);
      return {
        result: 'ok',
        rows: validRowCount,
        agents: 0,
        lastDataDate: '',
        warnings,
        rawData,
      };
    }

    // Fetch existing agents in cycle to preserve absentDays and still-valid AI text
    const existingAgentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .get();

    const existingAgentData = new Map<string, any>();
    existingAgentsSnap.forEach((doc: any) => {
      existingAgentData.set(doc.id, doc.data());
    });

    const updatedAgents: AgentRecord[] = [];
    let overallLastDate = '';

    const agentAccessEntries: Array<{ email: string; doc: any }> = [];
    const tlAccessEntries: Array<{ email: string; doc: any }> = [];

    // Preload known TL access mappings so agents with TL_Official_Email automatically link to the TL's login email
    const knownTlAccessSnap = await adminDb.collection('access').get();
    const tlOfficialToPersonal = new Map<string, string>();
    knownTlAccessSnap.forEach((d: any) => {
      const data = d.data();
      if (data?.role === 'tl' && data.officialEmail) {
        tlOfficialToPersonal.set(normalizeEmail(data.officialEmail), d.id);
      }
    });

    const emailsToDelete = new Set<string>();

    // 3, 4, 5. Process each agent
    for (const [officialEmail, agentRows] of groupedByAgent.entries()) {
      if (excludedEmails.has(officialEmail)) {
        emailsToDelete.add(officialEmail);
        continue;
      }

      const qualityRow = qualityMap.get(officialEmail) || null;
      const aggregated = aggregateAgent(agentRows, qualityRow);

      // Enrich profile from leader mapping tab if present
      const lmInfo = leaderMappingDict.get(officialEmail);
      if (lmInfo) {
        // Leader_Mapping is the sheet for login mappings, so its Gmail wins over the one in MainSheet
        if (lmInfo.personalEmail) {
          const fromMain = normalizeEmail(aggregated.profile.personalEmail);
          if (fromMain && fromMain !== lmInfo.personalEmail) {
            warnings.push(
              `Agent ${aggregated.profile.name} (${officialEmail}): MainSheet has Gmail '${fromMain}' but Leader_Mapping has '${lmInfo.personalEmail}'. Using Leader_Mapping.`
            );
          }
          aggregated.profile.personalEmail = lmInfo.personalEmail;
        }
        if (lmInfo.tlOfficialEmail && !aggregated.profile.tlOfficialEmail) {
          aggregated.profile.tlOfficialEmail = lmInfo.tlOfficialEmail;
        }
        if (lmInfo.tlPersonalEmail && !aggregated.profile.tlPersonalEmail) {
          aggregated.profile.tlPersonalEmail = lmInfo.tlPersonalEmail;
        }
      }

      if (aggregated.lastDataDate > overallLastDate) {
        overallLastDate = aggregated.lastDataDate;
      }

      // Check tier mapping ("PreSales", "Pre Sales" and "pre-sales" all match the same tier)
      let mappedType = resolveAgentType(appConfig.tierMap, aggregated.profile.agentTierRaw);
      const rawLoc = aggregated.profile.location.trim();
      if (!mappedType && rawLoc.toLowerCase().includes('pre sales')) {
        mappedType = 'PRE_SALES';
      }
      if (!mappedType) {
        warnings.push(
          `Agent ${aggregated.profile.name} (${officialEmail}): Unknown tier '${aggregated.profile.agentTierRaw}'. Skipped.`
        );
        continue;
      }

      // Check and normalize location (support "Dighe (Pre Sales)" and "Dighe")
      let loc = rawLoc;
      if (mappedType === 'PRE_SALES' && (loc.toLowerCase() === 'dighe' || loc.toLowerCase().includes('pre sales'))) {
        loc = 'Dighe (Pre Sales)';
        aggregated.profile.location = loc;
      }

      if (!appConfig.locations.includes(loc)) {
        const match = appConfig.locations.find((l) => l.toLowerCase() === loc.toLowerCase());
        if (match) {
          loc = match;
          aggregated.profile.location = loc;
        } else {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): Unknown location '${aggregated.profile.location}'. Skipped.`
          );
          continue;
        }
      }

      // Preserve absentDays
      const existing = existingAgentData.get(officialEmail);
      const absentDays =
        existing && existing.absentDays !== undefined
          ? existing.absentDays
          : null;

      // A row flagged isTest marks only that agent as a test agent, never the whole batch
      const agentIsTest =
        source === 'test' ||
        agentRows.some((r) => r.isTest) ||
        isTestAgentIdentifier(officialEmail, aggregated.profile.name);

      // Calculate with the plan for this Agent Type
      let result: IncentiveResult;
      if (mappedType === 'PRE_SALES') {
        if (preSalesColumnsMissing.length > 0 && !preSalesColumnsWarned) {
          warnings.push(
            `MainSheet is missing Pre Sales columns: ${preSalesColumnsMissing.join(', ')}. Pre Sales incentives stay at 0 until they are added.`
          );
          preSalesColumnsWarned = true;
        }
        if ((aggregated.totals.calls ?? 0) === 0 && aggregated.totals.activeDays > 0) {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): Pre Sales agent has no Inbound_Calls in this cycle.`
          );
        }
        const psPlan = getPreSalesPlan(cycle);
        result = calculatePreSales(
          preSalesMetricsFromTotals(aggregated.totals, aggregated.quality, psPlan),
          psPlan
        );
      } else {
        const plan = cycle.plans[mappedType];
        if (!plan) {
          warnings.push(
            `Agent ${aggregated.profile.name} (${officialEmail}): No plan found for tier '${mappedType}'. Skipped.`
          );
          continue;
        }
        const metrics = metricsFromTotals(aggregated.totals, aggregated.quality, absentDays);
        result = calculateFromMetrics(metrics, plan);
      }

      let effectiveTlPersonalEmail = aggregated.profile.tlPersonalEmail;
      if (!effectiveTlPersonalEmail && aggregated.profile.tlOfficialEmail) {
        effectiveTlPersonalEmail =
          tlOfficialToPersonal.get(normalizeEmail(aggregated.profile.tlOfficialEmail)) || '';
      }

      const agentRecord: AgentRecord = {
        name: aggregated.profile.name,
        officialEmail,
        personalEmail: aggregated.profile.personalEmail,
        location: aggregated.profile.location,
        agentType: mappedType,
        tlOfficialEmail: aggregated.profile.tlOfficialEmail,
        tlPersonalEmail: effectiveTlPersonalEmail,
        totals: aggregated.totals,
        daily: aggregated.daily,
        quality: aggregated.quality,
        absentDays,
        lastDataDate: aggregated.lastDataDate,
        result,
        isTest: agentIsTest,
        updatedAt: new Date().toISOString(),
      };

      // Keep the AI text of an agent whose numbers did not change (the record is rewritten in full below)
      if (
        appConfig.aiEnabled &&
        existing?.aiSuggestions?.fingerprint &&
        existing.aiSuggestions.fingerprint === aiFingerprint(agentRecord)
      ) {
        agentRecord.aiSuggestions = existing.aiSuggestions;
      }

      updatedAgents.push(agentRecord);

      // Access records
      if (agentRecord.personalEmail) {
        agentAccessEntries.push({
          email: agentRecord.personalEmail,
          doc: {
            role: 'agent',
            officialEmail,
            name: agentRecord.name,
            location: agentRecord.location,
            isTest: agentIsTest,
          },
        });
      }

      if (agentRecord.tlPersonalEmail) {
        tlAccessEntries.push({
          email: agentRecord.tlPersonalEmail,
          doc: {
            role: 'tl',
            officialEmail: agentRecord.tlOfficialEmail,
            name: 'Team Leader',
            location: agentRecord.location,
            isTest: agentIsTest,
          },
        });
      }
    }

    // Mapped agents without a MainSheet row in this cycle get no login yet: say so, or it looks like a bug
    const notInMain = Array.from(leaderMappingDict.entries())
      .filter(([official, info]) => !groupedByAgent.has(official) && !excludedEmails.has(official) && !/inactive|left|exit/i.test(info.status))
      .map(([official, info]) => (info.personalEmail ? `${official} (${info.personalEmail})` : official));
    if (notInMain.length > 0) {
      warnings.push(
        `${notInMain.length} agent(s) in Leader_Mapping have no MainSheet rows between ${startDate} and ${endDate}, so they cannot sign in yet: ${notInMain.slice(0, 20).join(', ')}${notInMain.length > 20 ? ', ...' : ''}`
      );
    }

    // 6. Save the data FIRST. AI text comes afterwards (step 7), so Gemini can never delay or fail a sync.
    const batch = adminDb.batch();

    const agentsCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents');

    for (const agent of updatedAgents) {
      batch.set(agentsCollection.doc(agent.officialEmail), agent);
    }

    for (const email of emailsToDelete) {
      batch.delete(agentsCollection.doc(email));
    }

    for (const entry of agentAccessEntries) {
      batch.set(adminDb.collection('access').doc(entry.email), entry.doc, { merge: true });
    }
    const tlMap = new Map<string, any>();
    for (const entry of tlAccessEntries) {
      const existing = tlMap.get(entry.email);
      if (!existing) {
        tlMap.set(entry.email, entry.doc);
      } else {
        if (existing.location.includes('(') && !entry.doc.location.includes('(')) {
          tlMap.set(entry.email, entry.doc);
        }
      }
    }

    for (const [email, doc] of tlMap.entries()) {
      batch.set(adminDb.collection('access').doc(email), doc, { merge: true });
    }

    // One leaderboard per location from all current agents in the cycle (existing + updated)
    const allAgentsMap = new Map<string, AgentRecord>();
    existingAgentData.forEach((data, email) => {
      if (!excludedEmails.has(normalizeEmail(email))) {
        allAgentsMap.set(email, data as AgentRecord);
      }
    });
    for (const agent of updatedAgents) {
      if (!excludedEmails.has(normalizeEmail(agent.officialEmail))) {
        allAgentsMap.set(agent.officialEmail, agent);
      }
    }
    for (const email of emailsToDelete) {
      allAgentsMap.delete(email);
    }

    const leaderboardCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('leaderboards');
    for (const doc of buildLeaderboardDocs(Array.from(allAgentsMap.values()), appConfig)) {
      batch.set(leaderboardCollection.doc(doc.location), doc);
    }

    // Save team revenue breakdown for revenue branches (Dighe, Andheri, Bangalore)
    const teamRevenueCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('teamRevenue');
    const filteredMainRows = validMainRows.filter(r => !excludedEmails.has(normalizeEmail(r.Agent_Email_Official)));
    for (const loc of ['Dighe', 'Andheri', 'Bangalore']) {
      const revDoc = buildTeamRevenue(loc, cycleId, filteredMainRows, revenueRows);
      batch.set(teamRevenueCollection.doc(loc), revDoc);
    }

    // Sync log doc (completed with the AI numbers below when AI is on)
    const syncLogRef = adminDb.collection('syncLogs').doc();
    const syncLogDoc: SyncLogRecord = {
      time: new Date().toISOString(),
      source,
      result: 'ok',
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings,
    };
    batch.set(syncLogRef, syncLogDoc);

    await batch.commit();

    // 7. AI text, best effort, within a time budget. The data above is already saved.
    const ai = { ok: 0, failed: 0, skipped: 0, pending: 0 };
    if (appConfig.aiEnabled && updatedAgents.length > 0) {
      const need = updatedAgents.filter((a) => !aiTextIsCurrent(a));
      ai.skipped = updatedAgents.length - need.length;

      if (need.length > 0) {
        if (!isAiConfigured()) {
          ai.failed = need.length;
          warnings.push(
            'AI text is switched on, but GEMINI_API_KEY is not set on the server. Agents see the rule-based text.'
          );
        } else {
          try {
            const budget =
              options.aiBudgetMs ?? (Number(process.env.AI_SYNC_BUDGET_MS) || DEFAULT_AI_SYNC_BUDGET_MS);
            const run = await runBatchAiGeneration(need, cycle, appConfig, { budgetMs: budget });
            ai.ok = run.okCount;
            ai.failed = run.failedCount;
            ai.pending = run.pendingCount;
            await saveAiText(cycleId, run.generatedAgents);
          } catch (aiErr: any) {
            console.error('AI text step failed after the data was saved:', aiErr);
            warnings.push(`AI text generation failed: ${aiErr?.message || String(aiErr)}`);
            ai.failed = need.length - ai.ok;
          }
        }
      }

      // Complete the sync log entry (its warnings array is the same one the response returns)
      try {
        await syncLogRef.set(
          { warnings, aiOk: ai.ok, aiFailed: ai.failed, aiSkipped: ai.skipped, aiPending: ai.pending },
          { merge: true }
        );
      } catch (logErr) {
        console.error('Failed to complete the sync log entry:', logErr);
      }
    }

    return {
      result: 'ok',
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings,
      rawData,
      ...(appConfig.aiEnabled
        ? { aiOk: ai.ok, aiFailed: ai.failed, aiSkipped: ai.skipped, aiPending: ai.pending }
        : {}),
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    warnings.push(errorMsg);
    await logSync(source, 'error', 0, 0, '', warnings, errorMsg);
    return {
      result: 'error',
      warnings,
      error: errorMsg,
    };
  }
}

async function logSync(
  source: 'apps-script' | 'import' | 'test',
  result: 'ok' | 'error',
  rows: number,
  agents: number,
  lastDataDate: string,
  warnings: string[],
  error?: string
) {
  try {
    await adminDb.collection('syncLogs').add({
      time: new Date().toISOString(),
      source,
      result,
      rows,
      agents,
      lastDataDate,
      warnings,
      ...(error ? { error } : {}),
    });
  } catch (e) {
    console.error('Failed to write sync log:', e);
  }
}
