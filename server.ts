import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { adminAuth, adminDb } from './server-firebase-admin';
import { ensureSeedData, processImport } from './server-import';
import { normalizeEmail } from './src/shared/incentive';
import { generateAiText, runBatchAiGeneration } from './server-ai';
import { buildLocationRows } from './src/shared/leaderboard';
import { AgentRecord } from './src/shared/types';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// JSON body parser with generous limit for batch spreadsheet data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/**
 * Health check endpoint
 * With the Admin SDK, write health/ping { time }, read it back, and return {"status":"ok"} or {"status":"error","message":...}.
 */
app.get('/api/health', async (_req, res) => {
  try {
    const nowTime = new Date().toISOString();
    const docRef = adminDb.collection('health').doc('ping');
    await docRef.set({ time: nowTime });

    const snap = await docRef.get();
    if (!snap.exists || snap.data()?.time !== nowTime) {
      return res.status(500).json({
        status: 'error',
        message: 'Health ping verify failed: time mismatch',
      });
    }

    return res.json({ status: 'ok' });
  } catch (err: any) {
    console.error('Health check error:', err);
    return res.status(500).json({
      status: 'error',
      message: err?.message || String(err),
    });
  }
});

/**
 * Apps Script sync endpoint
 * POST /api/sync: header X-Sync-Key must equal the SYNC_KEY secret, else return 401.
 * Body { mainRows: object[], qualityRows: object[] }.
 */
app.post('/api/sync', async (req, res) => {
  try {
    const syncKeyHeader = req.headers['x-sync-key'];
    const expectedSyncKey = process.env.SYNC_KEY;

    if (!expectedSyncKey || syncKeyHeader !== expectedSyncKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing X-Sync-Key' });
    }

    const { mainRows, qualityRows } = req.body || {};
    const result = await processImport('apps-script', mainRows || [], qualityRows || []);
    return res.json(result);
  } catch (err: any) {
    console.error('Error in /api/sync:', err);
    return res.status(500).json({
      result: 'error',
      error: err?.message || String(err),
      warnings: [err?.message || String(err)],
    });
  }
});

/**
 * Super Admin import endpoint
 * POST /api/import: header Authorization: Bearer <Firebase ID token>.
 * Verify the token. The email must be in config/app.superAdmins, else 403.
 */
app.post('/api/import', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (authErr: any) {
      return res.status(401).json({ error: `Invalid ID token: ${authErr.message}` });
    }

    const userEmail = normalizeEmail(decodedToken.email);
    if (!userEmail) {
      return res.status(403).json({ error: 'Forbidden: No email associated with token' });
    }

    const { appConfig } = await ensureSeedData();
    const isSuperAdmin = appConfig.superAdmins
      .map(normalizeEmail)
      .includes(userEmail);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden: User is not a Super Admin' });
    }

    const { mainRows, qualityRows, source } = req.body || {};
    const importSource = source === 'test' ? 'test' : 'import';
    const result = await processImport(importSource, mainRows || [], qualityRows || []);
    return res.json(result);
  } catch (err: any) {
    console.error('Error in /api/import:', err);
    return res.status(500).json({
      result: 'error',
      error: err?.message || String(err),
      warnings: [err?.message || String(err)],
    });
  }
});

/**
 * Clear test data endpoint: deletes all agent, leaderboard, and access records with isTest = true in active cycle
 * Super Admin only
 */
app.post(['/api/clear-test', '/api/admin/clear-test-data'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cycleId = appConfig.activeCycleId;

    // 1. Delete test agents in active cycle
    const agentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .where('isTest', '==', true)
      .get();

    let deletedAgentsCount = 0;
    const batch = adminDb.batch();
    agentsSnap.forEach((doc: any) => {
      batch.delete(doc.ref);
      deletedAgentsCount++;
    });

    // 2. Delete test access records
    const accessSnap = await adminDb
      .collection('access')
      .where('isTest', '==', true)
      .get();

    let deletedAccessCount = 0;
    accessSnap.forEach((doc: any) => {
      batch.delete(doc.ref);
      deletedAccessCount++;
    });

    // 2b. Delete the sync log entries written by test runs (real Apps Script syncs are kept)
    const testLogsSnap = await adminDb
      .collection('syncLogs')
      .where('source', '==', 'test')
      .get();

    let deletedSyncLogsCount = 0;
    testLogsSnap.forEach((doc: any) => {
      batch.delete(doc.ref);
      deletedSyncLogsCount++;
    });

    // 3. Clear/recalculate leaderboards
    // Re-read remaining non-test agents
    const remainingAgentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .get();

    const remainingNonTestAgents = remainingAgentsSnap.docs
      .map((d) => d.data())
      .filter((a) => !a.isTest);

    for (const loc of appConfig.locations) {
      const lbRef = adminDb
        .collection('cycles')
        .doc(cycleId)
        .collection('leaderboards')
        .doc(loc);

      batch.set(lbRef, {
        location: loc,
        updatedAt: new Date().toISOString(),
        rows: buildLocationRows(remainingNonTestAgents as AgentRecord[], loc, false),
      });
    }

    await batch.commit();

    return res.json({
      status: 'ok',
      deletedAgents: deletedAgentsCount,
      deletedAccess: deletedAccessCount,
      deletedSyncLogs: deletedSyncLogsCount,
    });
  } catch (err: any) {
    console.error('Error in /api/admin/clear-test-data:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Get sync logs
 */
app.get('/api/admin/sync-logs', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const logsSnap = await adminDb
      .collection('syncLogs')
      .orderBy('time', 'desc')
      .limit(30)
      .get();

    const logs = logsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ logs });
  } catch (err: any) {
    console.error('Error fetching sync logs:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Get config/app
 */
app.get('/api/admin/config', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json({ config: appConfig });
  } catch (err: any) {
    console.error('Error getting app config:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Update config/app (aiEnabled, aiTone, etc.)
 */
app.post('/api/admin/config', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { aiEnabled, aiTone, testMode, managers, superAdmins } = req.body;
    const updates: Partial<typeof appConfig> = {};
    if (typeof aiEnabled === 'boolean') updates.aiEnabled = aiEnabled;
    if (aiTone === 'english' || aiTone === 'hinglish') updates.aiTone = aiTone;
    if (typeof testMode === 'boolean') updates.testMode = testMode;
    if (Array.isArray(managers)) {
      updates.managers = managers.map(normalizeEmail).filter(Boolean);
    }
    if (Array.isArray(superAdmins)) {
      updates.superAdmins = superAdmins.map(normalizeEmail).filter(Boolean);
    }

    await adminDb.collection('config').doc('app').set(updates, { merge: true });
    Object.assign(appConfig, updates);

    return res.json({ status: 'ok', config: appConfig });
  } catch (err: any) {
    console.error('Error updating app config:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Test AI text: pick 1 dummy agent, call generateAiText, and return 3 columns:
 * defaultText, Gemini text, and check result (passed / dropped with reason).
 * Does NOT save to database.
 */
app.post('/api/admin/test-ai', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig, cycle } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cycleId = appConfig.activeCycleId;

    // Pick target agent: specific one or first available
    let targetAgent: AgentRecord | null = null;
    const requestedEmail = req.body?.officialEmail;

    if (requestedEmail) {
      const snap = await adminDb
        .collection('cycles')
        .doc(cycleId)
        .collection('agents')
        .doc(requestedEmail)
        .get();
      if (snap.exists) targetAgent = snap.data() as AgentRecord;
    }

    if (!targetAgent) {
      // Pick first agent from active cycle
      const agentsSnap = await adminDb
        .collection('cycles')
        .doc(cycleId)
        .collection('agents')
        .limit(1)
        .get();

      if (!agentsSnap.empty) {
        targetAgent = agentsSnap.docs[0].data() as AgentRecord;
      }
    }

    if (!targetAgent) {
      return res.status(404).json({
        error: 'No agents found in active cycle. Import dummy data first.',
      });
    }

    // Call generateAiText (it picks the HO, Store or Pre Sales rules from the agent's type)
    const aiResult = await generateAiText(targetAgent, cycle, appConfig);

    return res.json({
      agentName: targetAgent.name,
      officialEmail: targetAgent.officialEmail,
      agentType: targetAgent.agentType,
      success: aiResult.success,
      headline: aiResult.aiSuggestions?.headline,
      report: aiResult.report,
      error: aiResult.error,
    });
  } catch (err: any) {
    console.error('Error testing AI text:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Generate AI text for all agents:
 * Runs generateAiText for all agents in the active cycle and saves to Firestore.
 */
app.post('/api/admin/generate-ai-all', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userEmail = normalizeEmail(decodedToken.email);

    const { appConfig, cycle } = await ensureSeedData();
    if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cycleId = appConfig.activeCycleId;

    const agentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .get();

    const agents = agentsSnap.docs.map((d) => d.data() as AgentRecord);

    if (agents.length === 0) {
      return res.json({ okCount: 0, failedCount: 0, total: 0 });
    }

    const { okCount, failedCount, updatedAgents } = await runBatchAiGeneration(
      agents,
      cycle,
      appConfig
    );

    // Save updated agent records
    const agentsCol = adminDb.collection('cycles').doc(cycleId).collection('agents');
    const batches: any[] = [adminDb.batch()];
    let opCount = 0;

    function addBatchOp(fn: (b: any) => void) {
      if (opCount >= 400) {
        batches.push(adminDb.batch());
        opCount = 0;
      }
      fn(batches[batches.length - 1]);
      opCount++;
    }

    for (const agent of updatedAgents) {
      if (agent.aiSuggestions) {
        const ref = agentsCol.doc(agent.officialEmail);
        addBatchOp((b) => b.set(ref, agent));
      }
    }

    for (const b of batches) {
      await b.commit();
    }

    return res.json({
      status: 'ok',
      okCount,
      failedCount,
      total: agents.length,
    });
  } catch (err: any) {
    console.error('Error generating AI text for all agents:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Resolve session role and access:
 * 1. superAdmin: in config/app.superAdmins
 * 2. manager: in config/app.managers
 * 3. tl: access/{email} with role "tl"
 * 4. agent: access/{email} with role "agent"
 * 5. none: null -> Access denied
 */
app.get('/api/auth/session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (e: any) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userEmail = normalizeEmail(decodedToken.email);
    if (!userEmail) {
      return res.status(403).json({ error: 'No email found in token' });
    }

    const { appConfig } = await ensureSeedData();

    // 1. superAdmins
    const superAdmins = (appConfig.superAdmins || []).map(normalizeEmail);
    if (superAdmins.includes(userEmail)) {
      return res.json({
        email: userEmail,
        role: 'superAdmin',
        officialEmail: userEmail,
        name: decodedToken.name || userEmail,
        activeCycleId: appConfig.activeCycleId,
        testMode: appConfig.testMode,
      });
    }

    // 2. managers
    const managers = (appConfig.managers || []).map(normalizeEmail);
    if (managers.includes(userEmail)) {
      return res.json({
        email: userEmail,
        role: 'manager',
        officialEmail: userEmail,
        name: decodedToken.name || userEmail,
        activeCycleId: appConfig.activeCycleId,
        testMode: appConfig.testMode,
      });
    }

    // 3 & 4. access/{email}
    const accessDoc = await adminDb.collection('access').doc(userEmail).get();
    if (accessDoc.exists) {
      const data = accessDoc.data();
      if (data && data.role === 'tl') {
        return res.json({
          email: userEmail,
          role: 'tl',
          officialEmail: data.officialEmail || userEmail,
          name: data.name || decodedToken.name || userEmail,
          location: data.location,
          activeCycleId: appConfig.activeCycleId,
          testMode: appConfig.testMode,
        });
      }
      if (data && data.role === 'agent') {
        return res.json({
          email: userEmail,
          role: 'agent',
          officialEmail: data.officialEmail,
          name: data.name || decodedToken.name || userEmail,
          location: data.location,
          activeCycleId: appConfig.activeCycleId,
          testMode: appConfig.testMode,
        });
      }
    }

    // 5. No match
    return res.status(403).json({
      role: null,
      error: 'Access denied. Contact your TL.',
    });
  } catch (err: any) {
    console.error('Error in /api/auth/session:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * Get Agent Screen Data (agent record, cycle, and appConfig)
 * Enforces access permissions:
 * - agent: can ONLY open their own record (officialEmail must match their access doc)
 * - superAdmin / manager: can open any agent
 * - tl: can open agents under their team or location
 */
app.get('/api/agent-data', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (e: any) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userEmail = normalizeEmail(decodedToken.email);
    const targetOfficialEmail = normalizeEmail(req.query.officialEmail as string);

    if (!targetOfficialEmail) {
      return res.status(400).json({ error: 'Missing officialEmail parameter' });
    }

    const { appConfig, cycle } = await ensureSeedData();
    const cycleId = appConfig.activeCycleId;

    // Resolve user's permissions
    const isSuperAdmin = (appConfig.superAdmins || [])
      .map(normalizeEmail)
      .includes(userEmail);
    const isManager = (appConfig.managers || [])
      .map(normalizeEmail)
      .includes(userEmail);

    let allowed = isSuperAdmin || isManager;
    let userRole = isSuperAdmin ? 'superAdmin' : isManager ? 'manager' : null;

    if (!allowed) {
      const accessDoc = await adminDb.collection('access').doc(userEmail).get();
      if (accessDoc.exists) {
        const accessData = accessDoc.data();
        if (accessData?.role === 'agent') {
          userRole = 'agent';
          // Agents can only open their own officialEmail
          if (normalizeEmail(accessData.officialEmail) === targetOfficialEmail) {
            allowed = true;
          }
        } else if (accessData?.role === 'tl') {
          userRole = 'tl';
          // TL can open agents in their location / team
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Access denied to this agent record.' });
    }

    // Fetch the agent document
    const agentDoc = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .doc(targetOfficialEmail)
      .get();

    const agentRecord = agentDoc.exists ? agentDoc.data() : null;

    return res.json({
      agentRecord,
      cycle,
      appConfig,
      userRole,
    });
  } catch (err: any) {
    console.error('Error in /api/agent-data:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

/**
 * List agents allowed for current user (placeholder helper for Step 2)
 */
app.get('/api/allowed-agents', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (e: any) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userEmail = normalizeEmail(decodedToken.email);
    const { appConfig } = await ensureSeedData();
    const cycleId = appConfig.activeCycleId;

    const isSuperAdmin = (appConfig.superAdmins || [])
      .map(normalizeEmail)
      .includes(userEmail);
    const isManager = (appConfig.managers || [])
      .map(normalizeEmail)
      .includes(userEmail);

    let role = isSuperAdmin ? 'superAdmin' : isManager ? 'manager' : null;
    let tlLocation = '';

    if (!role) {
      const accessDoc = await adminDb.collection('access').doc(userEmail).get();
      if (accessDoc.exists) {
        const ad = accessDoc.data();
        if (ad?.role === 'tl') {
          role = 'tl';
          tlLocation = ad.location || '';
        } else if (ad?.role === 'agent') {
          role = 'agent';
        }
      }
    }

    if (!role) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Fetch all agents in active cycle
    const agentsSnap = await adminDb
      .collection('cycles')
      .doc(cycleId)
      .collection('agents')
      .get();

    let agents = agentsSnap.docs.map((d: any) => {
      const data = d.data();
      return {
        officialEmail: data.officialEmail,
        name: data.name,
        location: data.location,
        agentType: data.agentType,
        total: data.result?.total || 0,
        className: data.result?.className || 'NQ',
        sales: data.totals?.sales || 0,
        isTest: data.isTest || false,
      };
    });

    if (role === 'tl' && tlLocation) {
      agents = agents.filter((a) => a.location === tlLocation);
    }

    return res.json({ role, agents });
  } catch (err: any) {
    console.error('Error in /api/allowed-agents:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// In production, serve Vite built static assets
const distPath = path.resolve(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Initialize seed data on startup
ensureSeedData()
  .then(() => {
    console.log('Seed data checked and ready.');
  })
  .catch((err) => {
    console.error('Error ensuring seed data:', err);
  });

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
