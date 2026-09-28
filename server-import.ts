import { adminDb } from './server-firebase-admin';
import {
  aggregateAgent,
  calculateFromMetrics,
  metricsFromTotals,
  normalizeEmail,
  parseToISTDateString,
} from './src/shared/incentive';
import { defaultHOPlan, defaultSTOREPlan } from './src/shared/plans';
import {
  AgentRecord,
  AppConfig,
  Cycle,
  LeaderboardRecord,
  LeaderboardRow,
  RawMainRow,
  RawQualityRow,
  SyncLogRecord,
} from './src/shared/types';
import { runBatchAiGeneration } from './server-ai';

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

/**
 * Ensure seed data exists in config/app and cycles/diwali-2026
 */
export async function ensureSeedData(): Promise<{ appConfig: AppConfig; cycle: Cycle }> {
  const configRef = adminDb.collection('config').doc('app');
  const configSnap = await configRef.get();

  let appConfig: AppConfig;

  if (!configSnap.exists) {
    appConfig = {
      superAdmins: ['YOUR_PERSONAL_GMAIL', 'agha.h489@gmail.com'],
      managers: ['anirban.tsc@gmail.com'],
      activeCycleId: 'diwali-2026',
      tierMap: {
        'HO Callers': 'HO',
        'Store Callers': 'STORE',
      },
      locations: ['Dighe', 'Andheri', 'Bangalore'],
      testMode: true,
      aiEnabled: false,
      aiTone: 'english',
    };
    await configRef.set(appConfig);
  } else {
    appConfig = configSnap.data() as AppConfig;
    if (!appConfig.superAdmins) appConfig.superAdmins = [];
    if (!appConfig.managers) appConfig.managers = [];
    let modified = false;
    if (!appConfig.superAdmins.includes('agha.h489@gmail.com')) {
      appConfig.superAdmins.push('agha.h489@gmail.com');
      modified = true;
    }
    if (!appConfig.managers.includes('anirban.tsc@gmail.com')) {
      appConfig.managers.push('anirban.tsc@gmail.com');
      modified = true;
    }
    if (modified) {
      await configRef.set(appConfig, { merge: true });
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
      },
    };
    await cycleRef.set(cycle);
  } else {
    cycle = cycleSnap.data() as Cycle;
  }

  return { appConfig, cycle };
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
}

export async function processImport(
  source: 'apps-script' | 'import' | 'test',
  mainRows: RawMainRow[],
  qualityRows: RawQualityRow[] = []
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

    // Fetch existing agents in cycle to preserve absentDays
    const existingAgentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .get();

    const existingAgentData = new Map<string, any>();
    existingAgentsSnap.forEach((doc: any) => {
      existingAgentData.set(doc.id, doc.data());
    });

    const isTestBatch = source === 'test' || mainRows.some((r) => r.isTest);
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

      // Check tier mapping
      const mappedType = appConfig.tierMap[aggregated.profile.agentTierRaw];
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

      // Select plan
      const plan = cycle.plans[mappedType];
      if (!plan) {
        warnings.push(
          `Agent ${aggregated.profile.name} (${officialEmail}): No plan found for tier '${mappedType}'. Skipped.`
        );
        continue;
      }

      const metrics = metricsFromTotals(
        aggregated.totals,
        aggregated.quality,
        absentDays
      );
      const result = calculateFromMetrics(metrics, plan);

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
        isTest: isTestBatch,
        updatedAt: new Date().toISOString(),
      };

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
            isTest: isTestBatch,
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
            isTest: isTestBatch,
          },
        });
      }
    }

    // 6. If AI is enabled, generate AI suggestions for each updated agent
    let aiOkCount = 0;
    let aiFailedCount = 0;

    if (appConfig.aiEnabled && updatedAgents.length > 0) {
      try {
        const aiResult = await runBatchAiGeneration(
          updatedAgents,
          cycle.plans.HO || defaultHOPlan,
          cycle.plans.STORE || defaultSTOREPlan,
          cycle,
          appConfig
        );
        aiOkCount = aiResult.okCount;
        aiFailedCount = aiResult.failedCount;
      } catch (aiErr: any) {
        console.error('Error running AI generation in import:', aiErr);
        warnings.push(`AI text generation failed: ${aiErr?.message || String(aiErr)}`);
      }
    }

    // 7. Write with batched writes (max 400 each)
    const batches: any[] = [adminDb.batch()];
    let opCount = 0;

    function addBatchOp(fn: (batch: any) => void) {
      if (opCount >= 400) {
        batches.push(adminDb.batch());
        opCount = 0;
      }
      const currentBatch = batches[batches.length - 1];
      fn(currentBatch);
      opCount++;
    }

    // Write agent records
    const agentsCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents');

    for (const agent of updatedAgents) {
      const ref = agentsCollection.doc(agent.officialEmail);
      addBatchOp((b) => b.set(ref, agent));
    }

    // Write access records
    for (const entry of agentAccessEntries) {
      const ref = adminDb.collection('access').doc(entry.email);
      addBatchOp((b) => b.set(ref, entry.doc, { merge: true }));
    }

    for (const entry of tlAccessEntries) {
      const ref = adminDb.collection('access').doc(entry.email);
      addBatchOp((b) => b.set(ref, entry.doc, { merge: true }));
    }

    // Build 1 leaderboard for each location: sorted by total desc, then achievementPct desc, then name A-Z
    const locationAgentsMap = new Map<string, AgentRecord[]>();
    for (const loc of appConfig.locations) {
      locationAgentsMap.set(loc, []);
    }

    // Fetch all current agents in the cycle to have a complete leaderboard
    // (combining existing + updated)
    const allAgentsMap = new Map<string, AgentRecord>();
    existingAgentData.forEach((data, email) => {
      allAgentsMap.set(email, data as AgentRecord);
    });
    for (const agent of updatedAgents) {
      allAgentsMap.set(agent.officialEmail, agent);
    }

    for (const agent of allAgentsMap.values()) {
      if (locationAgentsMap.has(agent.location)) {
        locationAgentsMap.get(agent.location)!.push(agent);
      }
    }

    const leaderboardCollection = adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('leaderboards');

    for (const [location, agents] of locationAgentsMap.entries()) {
      // Sort agents
      agents.sort((a, b) => {
        if (b.result.total !== a.result.total) {
          return b.result.total - a.result.total;
        }
        if (b.result.achievementPct !== a.result.achievementPct) {
          return b.result.achievementPct - a.result.achievementPct;
        }
        return a.name.localeCompare(b.name);
      });

      const rows: LeaderboardRow[] = agents.map((a, index) => ({
        rank: index + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        sales: a.totals.sales,
        achievementPct: a.result.achievementPct,
        className: a.result.className,
        totalIncentive: a.result.total,
      }));

      const leaderboardDoc: LeaderboardRecord = {
        location,
        updatedAt: new Date().toISOString(),
        rows,
      };

      const ref = leaderboardCollection.doc(location);
      addBatchOp((b) => b.set(ref, leaderboardDoc));
    }

    // Sync log doc
    const syncLogRef = adminDb.collection('syncLogs').doc();
    const syncLogDoc: SyncLogRecord = {
      time: new Date().toISOString(),
      source,
      result: 'ok',
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings,
      aiOk: appConfig.aiEnabled ? aiOkCount : undefined,
      aiFailed: appConfig.aiEnabled ? aiFailedCount : undefined,
    };
    addBatchOp((b) => b.set(syncLogRef, syncLogDoc));

    // Commit all batches
    for (const b of batches) {
      await b.commit();
    }

    return {
      result: 'ok',
      rows: validRowCount,
      agents: updatedAgents.length,
      lastDataDate: overallLastDate,
      warnings,
      aiOk: appConfig.aiEnabled ? aiOkCount : undefined,
      aiFailed: appConfig.aiEnabled ? aiFailedCount : undefined,
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
