/**
 * Business Overview storage: the past months typed into the Business_Overview tab, and the months the
 * sync worked out itself. Kept under privateReports (server only, like the cohort report).
 */
import { adminDb } from './server-firebase-admin';
import { monthOf } from './server-clean-sheet';
import { BusinessOverviewRow, mergeOverview } from './src/shared/businessOverview';

function headerKey(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function num(row: Record<string, any>, ...names: string[]): number | null {
  const values = new Map<string, any>();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey(k), v);
  for (const n of names) {
    const v = values.get(headerKey(n));
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const x = Number(String(v).replace(/[,%\s]/g, ''));
    if (Number.isFinite(x)) return x;
  }
  return null;
}

function text(row: Record<string, any>, ...names: string[]): string {
  const values = new Map<string, any>();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey(k), v);
  for (const n of names) {
    const v = values.get(headerKey(n));
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Reads the Business_Overview tab (one row per Month and Tier). Month is any date in the month, or "2026-04".
 * A row without a month or tier is counted in `skipped`.
 */
export function parseBusinessOverviewRows(rows: any[]): { rows: BusinessOverviewRow[]; skipped: number } {
  const out: BusinessOverviewRow[] = [];
  let skipped = 0;
  for (const row of rows || []) {
    const monthCell = Object.entries(row || {}).find(([k]) => headerKey(k) === 'month')?.[1];
    const month = monthOf(monthCell);
    const tier = text(row, 'Tier');
    if (!month || !tier) {
      skipped++;
      continue;
    }
    const revenue = num(row, 'Revenue') ?? 0;
    const teamSize = num(row, 'Active_Team_Size') ?? 0;
    const quality = num(row, 'Quality_Score');
    const pre = num(row, 'Quality_Score_Pre_Sales');
    out.push({
      month,
      tier,
      outbound: num(row, 'Outbound_Calls') ?? 0,
      avgOutbound: num(row, 'Avg_Outbound_Calls_Per_Agent_Day'),
      connected: num(row, 'Connected_Calls') ?? 0,
      avgConnected: num(row, 'Avg_Connected_Calls_Per_Agent_Day'),
      talkSec: num(row, 'Talk_Time_Sec') ?? 0,
      avgTalkSec: num(row, 'Avg_Talk_Time_Sec'),
      revenue,
      // Average revenue per agent is always Total Revenue / Active Team Size (the typed column is only a fallback)
      avgRevenue: teamSize > 0 ? revenue / teamSize : num(row, 'Avg_Revenue_Per_Agent'),
      teamSize,
      aov: num(row, 'AOV'),
      quality: quality === null ? null : quality > 1 ? quality / 100 : quality,
      ...(pre !== null ? { qualityPreSales: pre > 1 ? pre / 100 : pre } : {}),
    });
  }
  return { rows: out, skipped };
}

const ref = () => adminDb.collection('privateReports').doc('businessOverview');

interface Stored {
  history?: BusinessOverviewRow[];
  live?: BusinessOverviewRow[];
}

async function read(): Promise<Stored> {
  const snap = await ref().get();
  return snap.exists ? ((snap.data() as Stored) || {}) : {};
}

/** Saves what the sync sent. `history` null = the tab was not sent (older Apps Script): keep what is saved. */
/** null keeps what is saved (history: the tab was not sent; live: a sync of the report tabs only). */
export async function saveBusinessOverview(history: BusinessOverviewRow[] | null, live: BusinessOverviewRow[] | null): Promise<void> {
  const old = await read();
  await ref().set({
    history: history ?? old.history ?? [],
    live: live ?? old.live ?? [],
    updatedAt: new Date().toISOString(),
  });
}

export async function loadBusinessOverview(): Promise<BusinessOverviewRow[]> {
  const s = await read();
  return mergeOverview(s.history || [], s.live || []);
}
