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
import { buildLocationRows } from './src/shared/leaderboard';
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

const REQUIRED_MAIN_HEADERS = [
  'Date',
  'Month',
  'Agent_Name',
  'Agent_Email_Official',
  'Agent_Email_Personal',
  'Agent_Location',
  'Agent_Tier',
  'Count_of_Orders',
  'Sales',
  'Average_Order_Value',
  'Unique_Connects',
  'Talk_Time_(seconds)',
  'TL_Official_Email',
  'TL_Personal_Email',
  'Store_Visits_Booked',
  'Store_Visits_Attributed',
  'Day',
];

const REQUIRED_QUALITY_HEADERS = [
  'Agent_Email_Official',
  'Total_Audits',
  'Average_Audit_Score',
];

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
  return { 'HO Callers': 'HO', 'Store Callers': 'STORE', PreSales: 'PRE_SALES' };
}

/** config/app of a brand-new project. Managers are added in the Admin tab (or with MANAGER_EMAILS). */
export function defaultAppConfig(): AppConfig {
  const superAdmins = envEmails('SUPER_ADMIN_EMAILS');
  return {
    superAdmins: superAdmins.length > 0 ? superAdmins : [DEFAULT_SUPER_ADMIN],
    managers: envEmails('MANAGER_EMAILS'),
    activeCycleId: 'diwali-2026',
    tierMap: defaultTierMap(),
    locations: ['Dighe', 'Andheri', 'Bangalore'],
    testMode: true,
    aiEnabled: false,
    aiTone: 'english',
  };
}

/**
 * Makes sure config/app and the active cycle exist.
 * - A missing config/app is created once. After that, nobody's access is changed behind their back:
 *   a manager who is removed stays removed. Only an empty Super Admin list is repaired, so the
 *   app can never be left without an administrator.
 * - Documents from an older version are upgraded in place (Pre Sales tier and plan). Safe to repeat.
 */
export async function ensureSeedData(): Promise<{ appConfig: AppConfig; cycle: Cycle }> {
  const configRef = adminDb.collection('config').doc('app');
  const configSnap = await configRef.get();

  let appConfig: AppConfig;

  if (!configSnap.exists) {
    appConfig = defaultAppConfig();
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
    if (!appConfig.activeCycleId) {
      appConfig.activeCycleId = 'diwali-2026';
      patch.activeCycleId = appConfig.activeCycleId;
    }
    if (!Array.isArray(appConfig.locations) || appConfig.locations.length === 0) {
      appConfig.locations = ['Dighe', 'Andheri', 'Bangalore'];
      patch.locations = appConfig.locations;
    }
    if (!appConfig.tierMap) {
      appConfig.tierMap = { 'HO Callers': 'HO', 'Store Callers': 'STORE' };
      patch.tierMap = appConfig.tierMap;
    }
    // Older config documents: make sure the Pre Sales tier is mapped
    if (!Object.values(appConfig.tierMap).includes('PRE_SALES')) {
      appConfig.tierMap['PreSales'] = 'PRE_SALES';
      patch.tierMap = appConfig.tierMap;
    }
    if (Object.keys(patch).length > 0) {
      await configRef.set(patch, { merge: true });
    }
  }

  const cycleRef = adminDb.collection('cycles').doc(appConfig.activeCycleId || 'diwali-2026');
  const cycleSnap = await cycleRef.get();

  let cycle: Cycle;
  if (!cycleSnap.exists) {
    cycle = {
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
    await cycleRef.set(cycle);
  } else {
    cycle = cycleSnap.data() as Cycle;
    // Older cycle documents: add the default Pre Sales plan
    if (cycle.plans && !cycle.plans.PRE_SALES) {
      cycle.plans.PRE_SALES = defaultPreSalesPlan;
      await cycleRef.set({ plans: cycle.plans }, { merge: true });
    }
  }

  return { appConfig, cycle };
}

/** All agents of a cycle. */
export async function loadAgents(cycleId: string): Promise<AgentRecord[]> {
  const snap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
  return snap.docs.map((d) => d.data() as AgentRecord);
}

/**
 * One leaderboard per location: sorted by total desc, then achievementPct desc, then name A-Z.
 * Pre Sales agents are not revenue-ranked, and demo/test agents only rank while test mode is on
 * (see buildLocationRows).
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

  const [agentsSnap, accessSnap, logsSnap] = await Promise.all([
    adminDb.collection('cycles').doc(cycleId).collection('agents').where('isTest', '==', true).get(),
    adminDb.collection('access').where('isTest', '==', true).get(),
    adminDb.collection('syncLogs').where('source', '==', 'test').get(),
  ]);

  const batch = adminDb.batch();
  agentsSnap.forEach((d) => batch.delete(d.ref));
  accessSnap.forEach((d) => batch.delete(d.ref));
  logsSnap.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  await rebuildLeaderboards(appConfig);

  return {
    deletedAgents: agentsSnap.size,
    deletedAccess: accessSnap.size,
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
}

export interface ProcessImportOptions {
  /** How long the sync may spend on AI text after the data is saved. */
  aiBudgetMs?: number;
}

export async function processImport(
  source: 'apps-script' | 'import' | 'test',
  mainRows: RawMainRow[],
  qualityRows: RawQualityRow[] = [],
  options: ProcessImportOptions = {}
): Promise<ProcessImportResult> {
  const warnings: string[] = [];

  try {
    // 1. Check headers
    if (!Array.isArray(mainRows) || mainRows.length === 0) {
      const err = 'No data rows found in MainSheet';
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    const sampleMain = mainRows[0] || {};
    const mainKeys = Object.keys(sampleMain);
    const missingMain = REQUIRED_MAIN_HEADERS.filter((h) => !mainKeys.includes(h));
    if (missingMain.length > 0) {
      const err = `Missing MainSheet headers: ${missingMain.join(', ')}`;
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    const preSalesColumnsMissing = PRE_SALES_HEADERS.filter((h) => !mainKeys.includes(h));
    let preSalesColumnsWarned = false;

    if (qualityRows && qualityRows.length > 0) {
      const sampleQuality = qualityRows[0] || {};
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

    // Demo users can only be created while test mode is on, so they never end up in a live database by accident
    if (source === 'test' && !appConfig.testMode) {
      const err = 'Test mode is off. Demo users can only be created while test mode is on (Admin tab > Go live / test mode).';
      await logSync(source, 'error', 0, 0, '', [err], err);
      return { result: 'error', warnings: [err], error: err };
    }

    // Build quality lookup map
    const qualityMap = new Map<string, RawQualityRow>();
    if (qualityRows) {
      for (const q of qualityRows) {
        const email = normalizeEmail(q.Agent_Email_Official);
        if (email) {
          qualityMap.set(email, q);
        }
      }
    }

    // 2. Filter rows between active cycle startDate and endDate
    // Group rows by Agent_Email_Official
    const groupedByAgent = new Map<string, RawMainRow[]>();
    let validRowCount = 0;

    for (const r of mainRows) {
      const istDate = parseToISTDateString(r.Date);
      if (!istDate || istDate < startDate || istDate > endDate) {
        continue;
      }

      const officialEmail = normalizeEmail(r.Agent_Email_Official);
      if (!officialEmail) {
        continue;
      }

      validRowCount++;
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

    // 3, 4, 5. Process each agent
    for (const [officialEmail, agentRows] of groupedByAgent.entries()) {
      const qualityRow = qualityMap.get(officialEmail) || null;
      const aggregated = aggregateAgent(agentRows, qualityRow);

      if (aggregated.lastDataDate > overallLastDate) {
        overallLastDate = aggregated.lastDataDate;
      }

      // Check tier mapping ("PreSales", "Pre Sales" and "pre-sales" all match the same tier)
      const mappedType = resolveAgentType(appConfig.tierMap, aggregated.profile.agentTierRaw);
      if (!mappedType) {
        warnings.push(
          `Agent ${aggregated.profile.name} (${officialEmail}): Unknown tier '${aggregated.profile.agentTierRaw}'. Skipped.`
        );
        continue;
      }

      // Check location
      if (!appConfig.locations.includes(aggregated.profile.location)) {
        warnings.push(
          `Agent ${aggregated.profile.name} (${officialEmail}): Unknown location '${aggregated.profile.location}'. Skipped.`
        );
        continue;
      }

      // Preserve absentDays
      const existing = existingAgentData.get(officialEmail);
      const absentDays =
        existing && existing.absentDays !== undefined
          ? existing.absentDays
          : null;

      // A row flagged isTest marks only that agent as a test agent, never the whole batch
      const agentIsTest = source === 'test' || agentRows.some((r) => r.isTest);

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

      const agentRecord: AgentRecord = {
        name: aggregated.profile.name,
        officialEmail,
        personalEmail: aggregated.profile.personalEmail,
        location: aggregated.profile.location,
        agentType: mappedType,
        tlOfficialEmail: aggregated.profile.tlOfficialEmail,
        tlPersonalEmail: aggregated.profile.tlPersonalEmail,
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

    // 6. Save the data FIRST. AI text comes afterwards (step 7), so Gemini can never delay or fail a sync.
    const batch = adminDb.batch();

    const agentsCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents');

    for (const agent of updatedAgents) {
      batch.set(agentsCollection.doc(agent.officialEmail), agent);
    }

    for (const entry of agentAccessEntries) {
      batch.set(adminDb.collection('access').doc(entry.email), entry.doc, { merge: true });
    }
    for (const entry of tlAccessEntries) {
      batch.set(adminDb.collection('access').doc(entry.email), entry.doc, { merge: true });
    }

    // One leaderboard per location from all current agents in the cycle (existing + updated)
    const allAgentsMap = new Map<string, AgentRecord>();
    existingAgentData.forEach((data, email) => {
      allAgentsMap.set(email, data as AgentRecord);
    });
    for (const agent of updatedAgents) {
      allAgentsMap.set(agent.officialEmail, agent);
    }

    const leaderboardCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('leaderboards');
    for (const doc of buildLeaderboardDocs(Array.from(allAgentsMap.values()), appConfig)) {
      batch.set(leaderboardCollection.doc(doc.location), doc);
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
