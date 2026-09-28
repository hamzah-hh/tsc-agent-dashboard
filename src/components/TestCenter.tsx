import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Upload,
  Database,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Play,
  FileSpreadsheet,
  Clock,
  ShieldCheck,
  UserCheck,
  ShieldAlert,
  Flame,
  Sparkles,
  Bot,
} from 'lucide-react';
import { testCases } from '../shared/incentive.testcases';
import { AppConfig, Cycle, RawMainRow, RawQualityRow, SyncLogRecord } from '../shared/types';
import { formatCurrencyINR, formatNumberINR, normalizeEmail } from '../shared/incentive';

interface TestCenterProps {
  userEmail: string;
  getIdToken: () => Promise<string>;
}

export const TestCenter: React.FC<TestCenterProps> = ({ userEmail, getIdToken }) => {
  // 1. Health check state
  const [healthStatus, setHealthStatus] = useState<{
    loading: boolean;
    result?: 'ok' | 'error';
    message?: string;
  }>({ loading: false });

  // 2. Calculation tests state
  const [testResults, setTestResults] = useState<
    Array<{
      id: number;
      description: string;
      passed: boolean;
      expected: string;
      actual: string;
    }>
  >([]);
  const [testsRan, setTestsRan] = useState(false);

  // 3. Import file state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileStats, setFileStats] = useState<{
    mainCount: number;
    qualityCount: number;
    mainRows: RawMainRow[];
    qualityRows: RawQualityRow[];
  } | null>(null);
  const [importStatus, setImportStatus] = useState<{
    loading: boolean;
    result?: 'ok' | 'error';
    summary?: any;
    error?: string;
  }>({ loading: false });

  // 4. Generate dummy data state
  const [dummyForm, setDummyForm] = useState({
    digheEmail: 'agent.dighe@test.com',
    andheriEmail: 'agent.andheri@test.com',
    bangaloreEmail: 'agent.bangalore@test.com',
    tlDigheEmail: 'tl.dighe@test.com',
    managerEmail: 'testmanager.tsc@gmail.com',
    dataUpTo: '2026-10-20',
  });
  const [newManagerInput, setNewManagerInput] = useState('');
  const [savingManagers, setSavingManagers] = useState(false);
  const [managerSaveMsg, setManagerSaveMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [dummyStatus, setDummyStatus] = useState<{
    loading: boolean;
    result?: 'ok' | 'error';
    summary?: any;
  }>({ loading: false });

  // 5. Clear test data state
  const [clearStatus, setClearStatus] = useState<{
    loading: boolean;
    result?: string;
  }>({ loading: false });

  // 6. Sync logs state
  const [syncLogs, setSyncLogs] = useState<SyncLogRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Active config and cycle data
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [cycle, setCycle] = useState<Cycle | null>(null);

  // AI Settings & Testing State
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiTone, setAiTone] = useState<'english' | 'hinglish'>('english');
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [testAiLoading, setTestAiLoading] = useState(false);
  const [testAiReport, setTestAiReport] = useState<{
    agentName?: string;
    headline?: string;
    items?: Array<{
      id: string;
      defaultText: string;
      geminiText: string;
      status: 'passed' | 'dropped';
      reason?: string;
    }>;
    error?: string;
  } | null>(null);

  const [generateAllLoading, setGenerateAllLoading] = useState(false);
  const [generateAllResult, setGenerateAllResult] = useState<{
    okCount?: number;
    failedCount?: number;
    total?: number;
    error?: string;
  } | null>(null);

  const handleAddManager = async () => {
    if (!newManagerInput.trim() || !appConfig) return;
    const emailToAdd = normalizeEmail(newManagerInput);
    if (!emailToAdd) return;
    const current = appConfig.managers || [];
    if (current.map(normalizeEmail).includes(emailToAdd)) {
      setManagerSaveMsg({ type: 'error', text: `${emailToAdd} is already in the managers list.` });
      return;
    }
    const updated = [...current, emailToAdd];
    setSavingManagers(true);
    setManagerSaveMsg(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ managers: updated }),
      });
      if (res.ok) {
        setAppConfig({ ...appConfig, managers: updated });
        setNewManagerInput('');
        setManagerSaveMsg({ type: 'ok', text: `Granted Manager access to ${emailToAdd}!` });
      } else {
        const d = await res.json();
        setManagerSaveMsg({ type: 'error', text: d.error || 'Failed to update managers' });
      }
    } catch (e: any) {
      setManagerSaveMsg({ type: 'error', text: e.message || 'Network error' });
    } finally {
      setSavingManagers(false);
    }
  };

  const handleRemoveManager = async (emailToRemove: string) => {
    if (!appConfig) return;
    const updated = (appConfig.managers || []).filter(
      (m) => normalizeEmail(m) !== normalizeEmail(emailToRemove)
    );
    setSavingManagers(true);
    setManagerSaveMsg(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ managers: updated }),
      });
      if (res.ok) {
        setAppConfig({ ...appConfig, managers: updated });
        setManagerSaveMsg({ type: 'ok', text: `Removed Manager access from ${emailToRemove}.` });
      }
    } catch (e: any) {
      setManagerSaveMsg({ type: 'error', text: e.message || 'Network error' });
    } finally {
      setSavingManagers(false);
    }
  };

  // Fetch initial config & sync logs
  const loadConfigAndLogs = async () => {
    try {
      setLogsLoading(true);
      const token = await getIdToken();
      const [cfgRes, logsRes] = await Promise.all([
        fetch('/api/admin/config-cycle', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/sync-logs', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (cfgRes.ok) {
        const data = await cfgRes.json();
        setAppConfig(data.appConfig);
        setCycle(data.cycle);
        if (data.appConfig) {
          setAiEnabled(Boolean(data.appConfig.aiEnabled));
          setAiTone(data.appConfig.aiTone || 'english');
        }
      }

      if (logsRes.ok) {
        const data = await logsRes.json();
        setSyncLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Error loading config/logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const updateAiConfig = async (newEnabled: boolean, newTone: 'english' | 'hinglish') => {
    setSavingAiConfig(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          aiEnabled: newEnabled,
          aiTone: newTone,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAppConfig(data.config);
        setAiEnabled(Boolean(data.config.aiEnabled));
        setAiTone(data.config.aiTone || 'english');
      }
    } catch (e: any) {
      console.error('Failed to update AI config:', e);
    } finally {
      setSavingAiConfig(false);
    }
  };

  const handleTestAi = async () => {
    setTestAiLoading(true);
    setTestAiReport(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/test-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestAiReport({
          agentName: data.agentName,
          headline: data.headline,
          items: data.report || [],
        });
      } else {
        setTestAiReport({
          error: data.error || 'Failed to generate test AI text',
        });
      }
    } catch (e: any) {
      setTestAiReport({ error: e.message });
    } finally {
      setTestAiLoading(false);
    }
  };

  const handleGenerateAiAll = async () => {
    setGenerateAllLoading(true);
    setGenerateAllResult(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/generate-ai-all', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setGenerateAllResult({
          okCount: data.okCount,
          failedCount: data.failedCount,
          total: data.total,
        });
      } else {
        setGenerateAllResult({
          error: data.error || 'Failed to generate AI suggestions',
        });
      }
    } catch (e: any) {
      setGenerateAllResult({ error: e.message });
    } finally {
      setGenerateAllLoading(false);
    }
  };

  useEffect(() => {
    loadConfigAndLogs();
  }, []);

  // 1. Run Health Check
  const runHealthCheck = async () => {
    setHealthStatus({ loading: true });
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setHealthStatus({ loading: false, result: 'ok', message: 'Admin SDK write/read ping verified successfully.' });
      } else {
        setHealthStatus({
          loading: false,
          result: 'error',
          message: data.message || 'Health check returned error',
        });
      }
    } catch (err: any) {
      setHealthStatus({
        loading: false,
        result: 'error',
        message: err.message || 'Network error reaching /api/health',
      });
    }
  };

  // 2. Run Calculation Tests
  const runCalculationTests = () => {
    const results = testCases.map((tc) => {
      const outcome = tc.run();
      return {
        id: tc.id,
        description: tc.description,
        passed: outcome.passed,
        expected: outcome.expected,
        actual: outcome.actual,
      };
    });
    setTestResults(results);
    setTestsRan(true);
  };

  // 3. File upload & parsing with SheetJS
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });

        let mainRows: RawMainRow[] = [];
        let qualityRows: RawQualityRow[] = [];

        // Check for MainSheet
        if (workbook.SheetNames.includes('MainSheet')) {
          const sheet = workbook.Sheets['MainSheet'];
          mainRows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as RawMainRow[];
        }

        // Check for D-1_QualityAudit_Summary
        if (workbook.SheetNames.includes('D-1_QualityAudit_Summary')) {
          const qSheet = workbook.Sheets['D-1_QualityAudit_Summary'];
          qualityRows = XLSX.utils.sheet_to_json(qSheet, { defval: '' }) as RawQualityRow[];
        }

        setFileStats({
          mainCount: mainRows.length,
          qualityCount: qualityRows.length,
          mainRows,
          qualityRows,
        });
      } catch (err: any) {
        alert('Failed to parse excel file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const submitImport = async () => {
    if (!fileStats) return;
    setImportStatus({ loading: true });
    try {
      const token = await getIdToken();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mainRows: fileStats.mainRows,
          qualityRows: fileStats.qualityRows,
          source: 'import',
        }),
      });

      const data = await res.json();
      if (res.ok && data.result === 'ok') {
        setImportStatus({
          loading: false,
          result: 'ok',
          summary: data,
        });
        loadConfigAndLogs();
      } else {
        setImportStatus({
          loading: false,
          result: 'error',
          error: data.error || (data.warnings && data.warnings.join(', ')) || 'Import failed',
          summary: data,
        });
      }
    } catch (err: any) {
      setImportStatus({
        loading: false,
        result: 'error',
        error: err.message || 'Import error',
      });
    }
  };

  // 4. Generate dummy test data
  const generateDummyData = async () => {
    setDummyStatus({ loading: true });
    try {
      const startDate = cycle?.startDate || '2026-10-01';
      const endDate = dummyForm.dataUpTo || '2026-10-20';

      // 9 agents: 3 for each location (Dighe, Andheri, Bangalore)
      // First agent of each location uses user's provided test email
      // TL for Dighe uses provided tlDigheEmail; others get fake TL emails
      const agentConfigs = [
        // Dighe (HO Callers)
        {
          name: 'Dighe Agent One (D-Tier)',
          official: 'dighe.agent1@test.local',
          personal: normalizeEmail(dummyForm.digheEmail) || 'agent1.dighe@test.local',
          location: 'Dighe',
          tier: 'HO Callers',
          tlOfficial: 'tl.dighe@test.local',
          tlPersonal: normalizeEmail(dummyForm.tlDigheEmail) || 'tl.dighe@test.local',
          profileRate: {
            salesPerDay: 850000, // Very high -> Class D
            ordersPerDay: 18,
            connectsPerDay: 155, // High band
            talkSecPerDay: 11500, // ~191 min -> High band
            visitsBooked: 14,
            visitsAttributed: 13,
            audits: 12,
            qualityScore: 94,
          },
        },
        {
          name: 'Dighe Agent Two (B-Tier)',
          official: 'dighe.agent2@test.local',
          personal: 'dummy2.dighe@example.com',
          location: 'Dighe',
          tier: 'HO Callers',
          tlOfficial: 'tl.dighe@test.local',
          tlPersonal: normalizeEmail(dummyForm.tlDigheEmail) || 'tl.dighe@test.local',
          profileRate: {
            salesPerDay: 580000, // Class B
            ordersPerDay: 12,
            connectsPerDay: 142, // Mid band
            talkSecPerDay: 10200, // ~170 min -> Mid band
            visitsBooked: 10,
            visitsAttributed: 9,
            audits: 10,
            qualityScore: 88,
          },
        },
        {
          name: 'Dighe Agent Three (NQ-Tier)',
          official: 'dighe.agent3@test.local',
          personal: 'dummy3.dighe@example.com',
          location: 'Dighe',
          tier: 'HO Callers',
          tlOfficial: 'tl.dighe@test.local',
          tlPersonal: normalizeEmail(dummyForm.tlDigheEmail) || 'tl.dighe@test.local',
          profileRate: {
            salesPerDay: 200000, // Low -> NQ
            ordersPerDay: 4,
            connectsPerDay: 110,
            talkSecPerDay: 6000,
            visitsBooked: 2,
            visitsAttributed: 2,
            audits: 0, // One agent has 0 audits!
            qualityScore: 0,
          },
        },

        // Andheri (Store Callers)
        {
          name: 'Andheri Agent One (C-Tier)',
          official: 'andheri.agent1@test.local',
          personal: normalizeEmail(dummyForm.andheriEmail) || 'agent1.andheri@test.local',
          location: 'Andheri',
          tier: 'Store Callers',
          tlOfficial: 'tl.andheri@test.local',
          tlPersonal: 'tl.andheri@test.local',
          profileRate: {
            salesPerDay: 950000, // Class C
            ordersPerDay: 15,
            connectsPerDay: 147, // High
            talkSecPerDay: 11000, // High
            visitsBooked: 22,
            visitsAttributed: 20,
            audits: 15,
            qualityScore: 91,
          },
        },
        {
          name: 'Andheri Agent Two (A-Tier)',
          official: 'andheri.agent2@test.local',
          personal: 'dummy5.andheri@example.com',
          location: 'Andheri',
          tier: 'Store Callers',
          tlOfficial: 'tl.andheri@test.local',
          tlPersonal: 'tl.andheri@test.local',
          profileRate: {
            salesPerDay: 680000, // Class A
            ordersPerDay: 11,
            connectsPerDay: 141, // Mid
            talkSecPerDay: 10000, // Mid
            visitsBooked: 14,
            visitsAttributed: 13,
            audits: 8,
            qualityScore: 86,
          },
        },
        {
          name: 'Andheri Agent Three (B-Tier)',
          official: 'andheri.agent3@test.local',
          personal: 'dummy6.andheri@example.com',
          location: 'Andheri',
          tier: 'Store Callers',
          tlOfficial: 'tl.andheri@test.local',
          tlPersonal: 'tl.andheri@test.local',
          profileRate: {
            salesPerDay: 780000, // Class B
            ordersPerDay: 13,
            connectsPerDay: 144, // Mid
            talkSecPerDay: 10100, // Mid
            visitsBooked: 18,
            visitsAttributed: 17,
            audits: 12,
            qualityScore: 92,
          },
        },

        // Bangalore (Store Callers)
        {
          name: 'Bangalore Agent One (B-Tier)',
          official: 'bangalore.agent1@test.local',
          personal: normalizeEmail(dummyForm.bangaloreEmail) || 'agent1.bangalore@test.local',
          location: 'Bangalore',
          tier: 'Store Callers',
          tlOfficial: 'tl.bangalore@test.local',
          tlPersonal: 'tl.bangalore@test.local',
          profileRate: {
            salesPerDay: 750000, // Class B
            ordersPerDay: 12,
            connectsPerDay: 146, // High
            talkSecPerDay: 11200, // High
            visitsBooked: 19,
            visitsAttributed: 18,
            audits: 14,
            qualityScore: 93,
          },
        },
        {
          name: 'Bangalore Agent Two (C-Tier)',
          official: 'bangalore.agent2@test.local',
          personal: 'dummy8.bangalore@example.com',
          location: 'Bangalore',
          tier: 'Store Callers',
          tlOfficial: 'tl.bangalore@test.local',
          tlPersonal: 'tl.bangalore@test.local',
          profileRate: {
            salesPerDay: 960000, // Class C
            ordersPerDay: 16,
            connectsPerDay: 148, // High
            talkSecPerDay: 11400, // High
            visitsBooked: 21,
            visitsAttributed: 20,
            audits: 15,
            qualityScore: 95,
          },
        },
        {
          name: 'Bangalore Agent Three (NQ-Tier)',
          official: 'bangalore.agent3@test.local',
          personal: 'dummy9.bangalore@example.com',
          location: 'Bangalore',
          tier: 'Store Callers',
          tlOfficial: 'tl.bangalore@test.local',
          tlPersonal: 'tl.bangalore@test.local',
          profileRate: {
            salesPerDay: 350000, // NQ
            ordersPerDay: 6,
            connectsPerDay: 120,
            talkSecPerDay: 7500,
            visitsBooked: 8,
            visitsAttributed: 7,
            audits: 6,
            qualityScore: 82,
          },
        },
      ];

      // Generate date list from startDate to dataUpTo
      const cur = new Date(startDate);
      const end = new Date(endDate);
      const dateStrings: string[] = [];

      while (cur <= end) {
        dateStrings.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
      }

      const generatedMainRows: RawMainRow[] = [];
      const generatedQualityRows: RawQualityRow[] = [];

      agentConfigs.forEach((agent, agentIdx) => {
        // Quality row
        generatedQualityRows.push({
          Agent_Email_Official: agent.official,
          Total_Audits: agent.profileRate.audits,
          Average_Audit_Score: agent.profileRate.qualityScore,
        });

        // Daily rows: 6 days working out of 7, 1 day off (Day=0), and 1 half-day (Day=0.5) per agent
        dateStrings.forEach((dStr, dayIdx) => {
          let dayVal = 1;
          // Every 7th day off
          if (dayIdx % 7 === 6) {
            dayVal = 0;
          } else if (dayIdx === (agentIdx % 5) + 2) {
            // Exactly one half day for this agent
            dayVal = 0.5;
          }

          const multiplier = dayVal;
          const sales = Math.round(agent.profileRate.salesPerDay * multiplier);
          const orders = Math.round(agent.profileRate.ordersPerDay * multiplier);
          const connects = Math.round(agent.profileRate.connectsPerDay * multiplier);
          const talkSeconds = Math.round(agent.profileRate.talkSecPerDay * multiplier);
          const visitsBooked = Math.round(agent.profileRate.visitsBooked * multiplier);
          const visitsAttributed = Math.round(agent.profileRate.visitsAttributed * multiplier);
          const aov = orders > 0 ? Math.round(sales / orders) : 0;

          generatedMainRows.push({
            Date: dStr,
            Month: 'October',
            Agent_Name: agent.name,
            Agent_Email_Official: agent.official,
            Agent_Email_Personal: agent.personal,
            Agent_Location: agent.location,
            Agent_Tier: agent.tier,
            Count_of_Orders: orders,
            Sales: sales,
            Average_Order_Value: aov,
            Unique_Connects: connects,
            'Talk_Time_(seconds)': talkSeconds,
            TL_Official_Email: agent.tlOfficial,
            TL_Personal_Email: agent.tlPersonal,
            Store_Visits_Booked: visitsBooked,
            Store_Visits_Attributed: visitsAttributed,
            Day: dayVal,
            isTest: true,
          });
        });
      });

      // Submit through /api/import
      const token = await getIdToken();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mainRows: generatedMainRows,
          qualityRows: generatedQualityRows,
          source: 'test',
        }),
      });

      const data = await res.json();
      if (res.ok && data.result === 'ok') {
        if (dummyForm.managerEmail && dummyForm.managerEmail.trim()) {
          const mgrEmail = normalizeEmail(dummyForm.managerEmail);
          const currentMgrs = appConfig?.managers || [];
          if (!currentMgrs.map(normalizeEmail).includes(mgrEmail)) {
            const updatedMgrs = [...currentMgrs, mgrEmail];
            await fetch('/api/admin/config', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ managers: updatedMgrs }),
            });
            if (appConfig) setAppConfig({ ...appConfig, managers: updatedMgrs });
          }
        }

        setDummyStatus({
          loading: false,
          result: 'ok',
          summary: data,
        });
        loadConfigAndLogs();
      } else {
        setDummyStatus({
          loading: false,
          result: 'error',
          summary: data,
        });
      }
    } catch (err: any) {
      setDummyStatus({
        loading: false,
        result: 'error',
        summary: { error: err.message },
      });
    }
  };

  // 5. Clear Test Data
  const clearTestData = async () => {
    if (!confirm('Are you sure you want to delete all isTest=true records in active cycle?')) {
      return;
    }
    setClearStatus({ loading: true });
    try {
      const token = await getIdToken();
      const res = await fetch('/api/clear-test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setClearStatus({
          loading: false,
          result: `Cleaned successfully: ${data.deletedAgents || 0} agents, ${data.deletedAccess || 0} access records removed.`,
        });
        loadConfigAndLogs();
      } else {
        setClearStatus({
          loading: false,
          result: `Error: ${data.error || 'Failed to clear'}`,
        });
      }
    } catch (err: any) {
      setClearStatus({
        loading: false,
        result: `Error: ${err.message}`,
      });
    }
  };

  const passedTestsCount = testResults.filter((r) => r.passed).length;

  return (
    <div className="space-y-8 pb-16">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm text-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold tracking-tight">Super Admin Test Center</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Logged in as <span className="text-slate-200 font-mono">{userEmail}</span> | Active Cycle:{' '}
            <span className="font-semibold text-emerald-300">{cycle?.name || 'Diwali 2026'}</span> (
            {cycle?.startDate} to {cycle?.endDate})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Test Mode: ACTIVE
          </span>
          <button
            onClick={loadConfigAndLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section 1: Health Check */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">1. System Health Check</h2>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Executes <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700">/api/health</code> using the Firebase Admin SDK to write a timestamp to <code className="bg-slate-100 px-1 py-0.5 rounded">health/ping</code> and read it back.
            </p>

            {healthStatus.result && (
              <div
                className={`p-3.5 rounded-lg text-xs font-medium flex items-start gap-2.5 mb-4 ${
                  healthStatus.result === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {healthStatus.result === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold uppercase tracking-wider text-[11px]">
                    Status: {healthStatus.result}
                  </div>
                  <div className="mt-0.5 text-slate-700">{healthStatus.message}</div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={runHealthCheck}
            disabled={healthStatus.loading}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            {healthStatus.loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Verifying Health...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Run Health Check
              </>
            )}
          </button>
        </div>

        {/* Section 2: Calculation Engine Tests */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500" />
                <h2 className="text-base font-bold text-slate-900">2. Calculation Engine Tests</h2>
              </div>
              {testsRan && (
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    passedTestsCount === 16
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-100 text-rose-800 border border-rose-200'
                  }`}
                >
                  {passedTestsCount} of 16 passed
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Validates all 16 specification incentive test cases directly in the browser using the pure TypeScript calculation engine.
            </p>
          </div>

          <button
            onClick={runCalculationTests}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <Play className="w-4 h-4" /> Run All 16 Test Cases
          </button>
        </div>
      </div>

      {/* Test cases results table */}
      {testsRan && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Calculation Test Results
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              Total {testResults.length} cases
            </span>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-600 sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold w-12">#</th>
                  <th className="py-2.5 px-4 font-semibold">Test Specification</th>
                  <th className="py-2.5 px-4 font-semibold">Expected</th>
                  <th className="py-2.5 px-4 font-semibold">Actual</th>
                  <th className="py-2.5 px-4 font-semibold text-center w-24">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {testResults.map((t) => (
                  <tr key={t.id} className={t.passed ? 'hover:bg-slate-50' : 'bg-rose-50/50'}>
                    <td className="py-2 px-4 text-slate-500 font-sans font-bold">{t.id}</td>
                    <td className="py-2 px-4 text-slate-800 font-sans">{t.description}</td>
                    <td className="py-2 px-4 text-slate-600">{t.expected}</td>
                    <td className="py-2 px-4 text-slate-900">{t.actual}</td>
                    <td className="py-2 px-4 text-center">
                      {t.passed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-sans font-semibold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded font-sans font-semibold text-[10px]">
                          <XCircle className="w-3 h-3 text-rose-600" /> FAIL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 3: Import File */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet className="w-5 h-5 text-teal-600" />
          <h2 className="text-base font-bold text-slate-900">3. Import Spreadsheet File (.xlsx)</h2>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Upload an Excel workbook containing sheets <span className="font-semibold text-slate-800">MainSheet</span> and optionally <span className="font-semibold text-slate-800">D-1_QualityAudit_Summary</span>. Parsed with SheetJS and sent to <code className="bg-slate-100 px-1 py-0.5 rounded text-teal-700">/api/import</code> with your Firebase ID token.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select .xlsx File
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="block w-full text-xs text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-800 hover:file:bg-slate-200 border border-slate-300 rounded-lg cursor-pointer p-1"
            />
          </div>

          <button
            onClick={submitImport}
            disabled={!fileStats || importStatus.loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            {importStatus.loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> Process & Import
              </>
            )}
          </button>
        </div>

        {fileStats && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs text-slate-700">
            <div>
              <span className="font-semibold">Selected:</span> {selectedFile?.name} (
              {fileStats.mainCount} rows in MainSheet, {fileStats.qualityCount} rows in Quality)
            </div>
          </div>
        )}

        {importStatus.result && (
          <div
            className={`mt-4 p-4 rounded-lg text-xs ${
              importStatus.result === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <div className="font-bold flex items-center gap-2">
              {importStatus.result === 'ok' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Import Succeeded!
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-600" /> Import Error
                </>
              )}
            </div>
            {importStatus.summary && (
              <div className="mt-2 space-y-1">
                <div>
                  <strong>Processed Rows:</strong> {importStatus.summary.rows} |{' '}
                  <strong>Agents:</strong> {importStatus.summary.agents} |{' '}
                  <strong>Last Data Date:</strong> {importStatus.summary.lastDataDate || 'N/A'}
                </div>
                {importStatus.summary.warnings?.length > 0 && (
                  <div className="text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 mt-2">
                    <span className="font-semibold">Warnings ({importStatus.summary.warnings.length}):</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5">
                      {importStatus.summary.warnings.map((w: string, i: number) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {importStatus.error && <div className="mt-1 font-mono text-[11px]">{importStatus.error}</div>}
          </div>
        )}
      </div>

      {/* Section 4: Generate Dummy Data */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">4. Generate Dummy Test Data</h2>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Generates comprehensive synthetic records for <strong>9 agents</strong> (3 per location: Dighe, Andheri, Bangalore) from 2026-10-01 up to the chosen date. Includes 6 working days/week, 1 half-day per agent, diverse incentive classes (NQ, A, B, C, D), bonus bands, and 1 agent with 0 audits. All marked <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700">isTest = true</code>.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Dighe Test Agent Login Email
            </label>
            <input
              type="email"
              value={dummyForm.digheEmail}
              onChange={(e) => setDummyForm({ ...dummyForm, digheEmail: e.target.value })}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Andheri Test Agent Login Email
            </label>
            <input
              type="email"
              value={dummyForm.andheriEmail}
              onChange={(e) => setDummyForm({ ...dummyForm, andheriEmail: e.target.value })}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Bangalore Test Agent Login Email
            </label>
            <input
              type="email"
              value={dummyForm.bangaloreEmail}
              onChange={(e) => setDummyForm({ ...dummyForm, bangaloreEmail: e.target.value })}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Dighe TL Login Email
            </label>
            <input
              type="email"
              value={dummyForm.tlDigheEmail}
              onChange={(e) => setDummyForm({ ...dummyForm, tlDigheEmail: e.target.value })}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Test Manager Login Email
            </label>
            <input
              type="email"
              value={dummyForm.managerEmail}
              onChange={(e) => setDummyForm({ ...dummyForm, managerEmail: e.target.value })}
              placeholder="e.g. testmanager.tsc@gmail.com"
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Data Up To (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={dummyForm.dataUpTo}
              onChange={(e) => setDummyForm({ ...dummyForm, dataUpTo: e.target.value })}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={generateDummyData}
              disabled={dummyStatus.loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              {dummyStatus.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" /> Generate 9 Test Agents
                </>
              )}
            </button>
          </div>
        </div>

        {dummyStatus.result && (
          <div
            className={`p-4 rounded-lg text-xs ${
              dummyStatus.result === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <div className="font-bold flex items-center gap-2">
              {dummyStatus.result === 'ok' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Dummy Data Generated & Processed Successfully!
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-600" /> Generation Error
                </>
              )}
            </div>
            {dummyStatus.summary && (
              <div className="mt-2 text-slate-700">
                Created <strong>{dummyStatus.summary.agents || 9}</strong> agent records across 3 locations (Dighe, Andheri, Bangalore), built 3 location leaderboards, and created access records.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 5: AI Coaching Suggestions (Gemini Flash) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">
                5. AI Coaching Suggestions (Gemini Flash)
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Rewrites rule-based suggestions into short, upbeat Diwali sales coaching messages. Only runs on the server; the browser and Simulator never call Gemini. Numbers are strictly validated before saving.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleTestAi}
              disabled={testAiLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 shadow-xs transition disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${testAiLoading ? 'animate-spin' : ''}`} />
              {testAiLoading ? 'Testing Gemini...' : 'Test AI text (Dry-Run)'}
            </button>

            <button
              onClick={handleGenerateAiAll}
              disabled={generateAllLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <Bot className={`w-3.5 h-3.5 ${generateAllLoading ? 'animate-spin' : ''}`} />
              {generateAllLoading ? 'Generating & Saving...' : 'Generate AI text for all agents'}
            </button>
          </div>
        </div>

        {/* AI Settings Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
          {/* Switch: config/app.aiEnabled */}
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
            <div>
              <span className="text-xs font-bold text-slate-900 block">AI Suggestions Active</span>
              <span className="text-[11px] text-slate-500 block">
                {aiEnabled ? 'Gemini rewrites suggestions on import' : 'Rule text is shown without AI calls'}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiEnabled}
                disabled={savingAiConfig}
                onChange={(e) => updateAiConfig(e.target.checked, aiTone)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Select: config/app.aiTone */}
          <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-200">
            <div>
              <span className="text-xs font-bold text-slate-900 block">Coaching Tone</span>
              <span className="text-[11px] text-slate-500 block">
                Language style for motivational messages
              </span>
            </div>
            <select
              value={aiTone}
              disabled={savingAiConfig}
              onChange={(e) => updateAiConfig(aiEnabled, e.target.value as 'english' | 'hinglish')}
              className="text-xs font-semibold border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="english">English (Simple & Friendly)</option>
              <option value="hinglish">Hinglish (Casual Hindi-English mix)</option>
            </select>
          </div>
        </div>

        {/* Generate AI For All Status Result */}
        {generateAllResult && (
          <div className={`p-4 rounded-xl text-xs ${
            generateAllResult.error
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}>
            {generateAllResult.error ? (
              <div className="font-semibold flex items-center gap-1.5">
                <XCircle className="w-4 h-4 text-rose-600" />
                {generateAllResult.error}
              </div>
            ) : (
              <div className="font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Generated AI suggestions: {generateAllResult.okCount} OK, {generateAllResult.failedCount} Failed out of {generateAllResult.total} agents in active cycle. Records saved to Firestore.
              </div>
            )}
          </div>
        )}

        {/* Test AI Report (3 columns: defaultText, Gemini text, and check result) */}
        {testAiReport && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800">
                Dry-Run AI Validation Report {testAiReport.agentName ? `(${testAiReport.agentName})` : ''}
              </span>
              <span className="text-[11px] text-slate-500">
                Dry-run results are validated against strict number & word count rules without modifying Firestore.
              </span>
            </div>

            {testAiReport.error ? (
              <div className="p-4 text-xs text-rose-600 bg-rose-50">
                {testAiReport.error}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700 border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4 w-1/3">Default Text (Rule)</th>
                      <th className="py-2.5 px-4 w-1/3">Gemini Text (AI)</th>
                      <th className="py-2.5 px-4 w-1/3">Check Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {testAiReport.items?.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 px-4 text-slate-600 align-top">
                          <span className="font-mono text-[10px] text-slate-400 block mb-0.5">
                            [{item.id}]
                          </span>
                          {item.defaultText}
                        </td>
                        <td className="py-3 px-4 text-slate-900 font-medium align-top">
                          {item.geminiText}
                        </td>
                        <td className="py-3 px-4 align-top">
                          {item.status === 'passed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Passed (Numbers & words match)
                            </span>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                Dropped
                              </span>
                              {item.reason && (
                                <p className="text-[11px] text-amber-700 mt-1 font-sans">
                                  {item.reason}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 6: Clear Test Data */}
      <div className="bg-white border border-rose-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-5 h-5 text-rose-600" />
              <h2 className="text-base font-bold text-slate-900">6. Clear Test Data</h2>
            </div>
            <p className="text-xs text-slate-600">
              Deletes all agent records, access accounts, and leaderboards entries where <code className="bg-rose-50 text-rose-700 px-1 py-0.5 rounded font-mono">isTest == true</code> in the active cycle. Real imported agents remain untouched.
            </p>
          </div>
          <button
            onClick={clearTestData}
            disabled={clearStatus.loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            {clearStatus.loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Clearing...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" /> Clear All Test Data
              </>
            )}
          </button>
        </div>

        {clearStatus.result && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700">
            {clearStatus.result}
          </div>
        )}
      </div>

      {/* Section 6: Role & Permissions Access Management */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-bold text-slate-900">
            6. Role & Access Management (Super Admin & Manager Accounts)
          </h2>
        </div>
        <p className="text-xs text-slate-600">
          Configure which Google accounts have <strong>Super Admin</strong> (full system & test control) or <strong>Manager</strong> (cross-location team overview & 3 leaderboards) privileges in <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700">config/app</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Super Admins */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-2">
              Super Admins ({appConfig?.superAdmins?.length || 0})
            </span>
            <div className="flex flex-wrap gap-2">
              {appConfig?.superAdmins?.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-md text-xs font-medium font-mono"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  {email}
                </span>
              ))}
            </div>
          </div>

          {/* Managers */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-2">
              Managers ({appConfig?.managers?.length || 0})
            </span>
            <div className="flex flex-wrap gap-2 mb-3">
              {(!appConfig?.managers || appConfig.managers.length === 0) ? (
                <span className="text-xs text-slate-400 italic">No managers configured.</span>
              ) : (
                appConfig.managers.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md text-xs font-medium font-mono"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                    {email}
                    <button
                      onClick={() => handleRemoveManager(email)}
                      disabled={savingManagers}
                      title={`Revoke Manager role from ${email}`}
                      className="text-emerald-700 hover:text-rose-600 font-bold ml-1 transition"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add Manager Form */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
              <input
                type="email"
                placeholder="Add manager email (e.g. testmanager.tsc@gmail.com)"
                value={newManagerInput}
                onChange={(e) => setNewManagerInput(e.target.value)}
                className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 bg-white"
              />
              <button
                onClick={handleAddManager}
                disabled={savingManagers || !newManagerInput.trim()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition"
              >
                {savingManagers ? 'Saving...' : 'Grant Manager'}
              </button>
            </div>

            {managerSaveMsg && (
              <div
                className={`mt-2 text-xs font-medium ${
                  managerSaveMsg.type === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {managerSaveMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 7: Sync Logs */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              7. Sync Logs (Last 30 Records)
            </h3>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            {syncLogs.length} events logged
          </span>
        </div>

        {syncLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No sync logs recorded yet. Run a dummy generation or upload an .xlsx file to see logs.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-600 sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Timestamp (UTC/IST)</th>
                  <th className="py-2.5 px-4 font-semibold">Source</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold">Rows</th>
                  <th className="py-2.5 px-4 font-semibold">Agents</th>
                  <th className="py-2.5 px-4 font-semibold">Last Data Date</th>
                  <th className="py-2.5 px-4 font-semibold">Notes & Warnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {syncLogs.map((log: any, idx: number) => (
                  <tr key={log.id || idx} className="hover:bg-slate-50">
                    <td className="py-2 px-4 text-slate-600 whitespace-nowrap">
                      {new Date(log.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                    </td>
                    <td className="py-2 px-4">
                      <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded font-sans text-[10px]">
                        {log.source}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      {log.result === 'ok' ? (
                        <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded font-sans text-[10px]">
                          OK
                        </span>
                      ) : (
                        <span className="text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded font-sans text-[10px]">
                          ERROR
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-slate-800">{log.rows || 0}</td>
                    <td className="py-2 px-4 text-slate-800">{log.agents || 0}</td>
                    <td className="py-2 px-4 text-slate-600">{log.lastDataDate || '-'}</td>
                    <td className="py-2 px-4 font-sans text-slate-600 text-[11px]">
                      {log.error && <div className="text-rose-600 font-medium">{log.error}</div>}
                      {log.warnings?.length > 0 && (
                        <div className="text-amber-700">{log.warnings.join('; ')}</div>
                      )}
                      {!log.error && (!log.warnings || log.warnings.length === 0) && (
                        <span className="text-slate-400">Clean sync</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
