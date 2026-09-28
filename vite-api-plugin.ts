import type { Plugin } from 'vite';
import { adminAuth, adminDb } from './server-firebase-admin';
import { ensureSeedData, processImport } from './server-import';
import { normalizeEmail } from './src/shared/incentive';
import { generateAiText, runBatchAiGeneration } from './server-ai';
import { defaultHOPlan, defaultSTOREPlan } from './src/shared/plans';
import { AgentRecord } from './src/shared/types';

export function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      // Initialize seed data on dev server start
      ensureSeedData().catch((err) => {
        console.error('Failed to initialize seed data in dev plugin:', err);
      });

      // Simple JSON body parser middleware for dev server
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (!url.startsWith('/api/')) {
          return next();
        }

        // Helper to send json
        const sendJson = (status: number, data: any) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        // Parse body if POST
        let body: any = null;
        if (req.method === 'POST') {
          try {
            const chunks: Uint8Array[] = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            const str = buffer.toString('utf-8');
            if (str) {
              body = JSON.parse(str);
            }
          } catch (e: any) {
            return sendJson(400, { error: 'Invalid JSON body: ' + e.message });
          }
        }

        try {
          // 1. GET /api/health
          if (url === '/api/health' && req.method === 'GET') {
            const nowTime = new Date().toISOString();
            const docRef = adminDb.collection('health').doc('ping');
            await docRef.set({ time: nowTime });

            const snap = await docRef.get();
            if (!snap.exists || snap.data()?.time !== nowTime) {
              return sendJson(500, {
                status: 'error',
                message: 'Health ping verify failed: time mismatch',
              });
            }
            return sendJson(200, { status: 'ok' });
          }

          // 2. POST /api/sync
          if (url === '/api/sync' && req.method === 'POST') {
            const syncKeyHeader = req.headers['x-sync-key'];
            const expectedSyncKey = process.env.SYNC_KEY;

            if (!expectedSyncKey || syncKeyHeader !== expectedSyncKey) {
              return sendJson(401, { error: 'Unauthorized: Invalid or missing X-Sync-Key' });
            }

            const { mainRows, qualityRows } = body || {};
            const result = await processImport('apps-script', mainRows || [], qualityRows || []);
            return sendJson(200, result);
          }

          // 3. POST /api/import
          if (url === '/api/import' && req.method === 'POST') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized: Missing or invalid Authorization header' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            let decodedToken;
            try {
              decodedToken = await adminAuth.verifyIdToken(token);
            } catch (authErr: any) {
              return sendJson(401, { error: `Invalid ID token: ${authErr.message}` });
            }

            const userEmail = normalizeEmail(decodedToken.email);
            if (!userEmail) {
              return sendJson(403, { error: 'Forbidden: No email associated with token' });
            }

            const { appConfig } = await ensureSeedData();
            const isSuperAdmin = appConfig.superAdmins
              .map(normalizeEmail)
              .includes(userEmail);

            if (!isSuperAdmin) {
              return sendJson(403, { error: 'Forbidden: User is not a Super Admin' });
            }

            const { mainRows, qualityRows, source } = body || {};
            const importSource = source === 'test' ? 'test' : 'import';
            const result = await processImport(importSource, mainRows || [], qualityRows || []);
            return sendJson(200, result);
          }

          // 4. POST /api/clear-test and /api/admin/clear-test-data
          if ((url === '/api/clear-test' || url === '/api/admin/clear-test-data') && req.method === 'POST') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
            }

            const cycleId = appConfig.activeCycleId;

            // Delete test agents
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

            // Delete test access records
            const accessSnap = await adminDb
              .collection('access')
              .where('isTest', '==', true)
              .get();

            let deletedAccessCount = 0;
            accessSnap.forEach((doc: any) => {
              batch.delete(doc.ref);
              deletedAccessCount++;
            });

            // Recalculate leaderboards
            const remainingAgentsSnap = await adminDb
              .collection('cycles')
              .doc(cycleId)
              .collection('agents')
              .get();

            const remainingNonTestAgents = remainingAgentsSnap.docs
              .map((d) => d.data())
              .filter((a) => !a.isTest);

            for (const loc of appConfig.locations) {
              const locAgents = remainingNonTestAgents.filter((a) => a.location === loc);
              locAgents.sort((a, b) => {
                if (b.result.total !== a.result.total) {
                  return b.result.total - a.result.total;
                }
                if (b.result.achievementPct !== a.result.achievementPct) {
                  return b.result.achievementPct - a.result.achievementPct;
                }
                return a.name.localeCompare(b.name);
              });

              const lbRef = adminDb
                .collection('cycles')
                .doc(cycleId)
                .collection('leaderboards')
                .doc(loc);

              batch.set(lbRef, {
                location: loc,
                updatedAt: new Date().toISOString(),
                rows: locAgents.map((a, idx) => ({
                  rank: idx + 1,
                  name: a.name,
                  officialEmail: a.officialEmail,
                  sales: a.totals.sales,
                  achievementPct: a.result.achievementPct,
                  className: a.result.className,
                  totalIncentive: a.result.total,
                })),
              });
            }

            await batch.commit();

            return sendJson(200, {
              status: 'ok',
              deletedAgents: deletedAgentsCount,
              deletedAccess: deletedAccessCount,
            });
          }

          // 5. GET /api/admin/sync-logs
          if (url === '/api/admin/sync-logs' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
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

            return sendJson(200, { logs });
          }

          // 5b. GET /api/admin/config
          if (url === '/api/admin/config' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
            }

            return sendJson(200, { config: appConfig });
          }

          // 5c. POST /api/admin/config
          if (url === '/api/admin/config' && req.method === 'POST') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
            }

            const { aiEnabled, aiTone, testMode, managers, superAdmins } = (req as any).body || {};
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

            return sendJson(200, { status: 'ok', config: appConfig });
          }

          // 5d. POST /api/admin/test-ai
          if (url === '/api/admin/test-ai' && req.method === 'POST') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig, cycle } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
            }

            const cycleId = appConfig.activeCycleId;
            let targetAgent: AgentRecord | null = null;
            const requestedEmail = (req as any).body?.officialEmail;

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
              return sendJson(404, {
                error: 'No agents found in active cycle. Import dummy data first.',
              });
            }

            const plan =
              cycle.plans?.[targetAgent.agentType] ||
              (targetAgent.agentType === 'HO' ? defaultHOPlan : defaultSTOREPlan);

            const aiResult = await generateAiText(targetAgent, plan, cycle, appConfig);

            return sendJson(200, {
              agentName: targetAgent.name,
              officialEmail: targetAgent.officialEmail,
              agentType: targetAgent.agentType,
              success: aiResult.success,
              headline: aiResult.aiSuggestions?.headline,
              report: aiResult.report,
              error: aiResult.error,
            });
          }

          // 5e. POST /api/admin/generate-ai-all
          if (url === '/api/admin/generate-ai-all' && req.method === 'POST') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig, cycle } = await ensureSeedData();
            if (!appConfig.superAdmins.map(normalizeEmail).includes(userEmail)) {
              return sendJson(403, { error: 'Forbidden' });
            }

            const cycleId = appConfig.activeCycleId;
            const agentsSnap = await adminDb
              .collection('cycles')
              .doc(cycleId)
              .collection('agents')
              .get();

            const agents = agentsSnap.docs.map((d) => d.data() as AgentRecord);

            if (agents.length === 0) {
              return sendJson(200, { okCount: 0, failedCount: 0, total: 0 });
            }

            const { okCount, failedCount, updatedAgents } = await runBatchAiGeneration(
              agents,
              cycle.plans.HO || defaultHOPlan,
              cycle.plans.STORE || defaultSTOREPlan,
              cycle,
              appConfig
            );

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

            return sendJson(200, {
              status: 'ok',
              okCount,
              failedCount,
              total: agents.length,
            });
          }

          // 6. GET /api/auth/session
          if (url === '/api/auth/session' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            let decodedToken;
            try {
              decodedToken = await adminAuth.verifyIdToken(token);
            } catch (e: any) {
              return sendJson(401, { error: 'Invalid token' });
            }

            const userEmail = normalizeEmail(decodedToken.email);
            if (!userEmail) {
              return sendJson(403, { error: 'No email found in token' });
            }

            const { appConfig } = await ensureSeedData();

            // 1. superAdmins
            const superAdmins = (appConfig.superAdmins || []).map(normalizeEmail);
            if (superAdmins.includes(userEmail)) {
              return sendJson(200, {
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
              return sendJson(200, {
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
                return sendJson(200, {
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
                return sendJson(200, {
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
            return sendJson(403, {
              role: null,
              error: 'Access denied. Contact your TL.',
            });
          }

          // 7. GET /api/agent-data
          if (url === '/api/agent-data' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            let decodedToken;
            try {
              decodedToken = await adminAuth.verifyIdToken(token);
            } catch (e: any) {
              return sendJson(401, { error: 'Invalid token' });
            }

            const userEmail = normalizeEmail(decodedToken.email);
            const queryParams = new URL(req.url || '', 'http://localhost').searchParams;
            const targetOfficialEmail = normalizeEmail(queryParams.get('officialEmail'));

            if (!targetOfficialEmail) {
              return sendJson(400, { error: 'Missing officialEmail parameter' });
            }

            const { appConfig, cycle } = await ensureSeedData();
            const cycleId = appConfig.activeCycleId;

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
                  if (normalizeEmail(accessData.officialEmail) === targetOfficialEmail) {
                    allowed = true;
                  }
                } else if (accessData?.role === 'tl') {
                  userRole = 'tl';
                  allowed = true;
                }
              }
            }

            if (!allowed) {
              return sendJson(403, { error: 'Access denied to this agent record.' });
            }

            const agentDoc = await adminDb
              .collection('cycles')
              .doc(cycleId)
              .collection('agents')
              .doc(targetOfficialEmail)
              .get();

            const agentRecord = agentDoc.exists ? agentDoc.data() : null;

            return sendJson(200, {
              agentRecord,
              cycle,
              appConfig,
              userRole,
            });
          }

          // 8. GET /api/allowed-agents
          if (url === '/api/allowed-agents' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            let decodedToken;
            try {
              decodedToken = await adminAuth.verifyIdToken(token);
            } catch (e: any) {
              return sendJson(401, { error: 'Invalid token' });
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
              return sendJson(403, { error: 'Access denied' });
            }

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

            return sendJson(200, { role, agents });
          }

          // 9. GET /api/admin/config-cycle
          if (url === '/api/admin/config-cycle' && req.method === 'GET') {
            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              return sendJson(401, { error: 'Unauthorized' });
            }

            const token = authHeader.split('Bearer ')[1].trim();
            const decodedToken = await adminAuth.verifyIdToken(token);
            const userEmail = normalizeEmail(decodedToken.email);

            const { appConfig, cycle } = await ensureSeedData();
            const isSuperAdmin = appConfig.superAdmins
              .map(normalizeEmail)
              .includes(userEmail);

            return sendJson(200, {
              isSuperAdmin,
              appConfig,
              cycle,
            });
          }

          // Unknown API route
          return sendJson(404, { error: 'Not Found' });
        } catch (apiErr: any) {
          console.error('API Error:', apiErr);
          return sendJson(500, { error: apiErr?.message || String(apiErr) });
        }
      });
    },
  };
}
