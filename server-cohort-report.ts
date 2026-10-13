/**
 * The private Talk Time Cohort report (Anirban_Ref tab).
 *
 * Kept outside cycles/ in privateReports/cohort (+ chunks/rows-N): firestore.rules has no rule for it, so
 * no browser can read it directly, and only GET /api/cohort-report hands it out, to COHORT_REPORT_VIEWERS.
 * Sync warnings about this tab give counts only, never values.
 */
import { adminDb } from './server-firebase-admin';
import { normalizeEmail } from './src/shared/incentive';
import { COHORT_REPORT_VIEWERS, CohortRow } from './src/shared/cohortReport';
import { sheetDateTime } from './server-clean-sheet';

const CHUNK = 2000;
const headRef = () => adminDb.collection('privateReports').doc('cohort');
const chunksCol = () => headRef().collection('chunks');

/** COHORT_REPORT_VIEWERS, or the comma-separated COHORT_REPORT_VIEWERS environment variable when set. */
export function canSeeCohortReport(email: string | undefined | null): boolean {
  const list = process.env.COHORT_REPORT_VIEWERS
    ? process.env.COHORT_REPORT_VIEWERS.split(',').map((e) => normalizeEmail(e)).filter(Boolean)
    : COHORT_REPORT_VIEWERS;
  const me = normalizeEmail(email);
  return Boolean(me) && list.includes(me);
}

function headerKey(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(row: Record<string, any>, ...names: string[]): string {
  const values = new Map<string, any>();
  for (const [k, v] of Object.entries(row || {})) values.set(headerKey(k), v);
  for (const n of names) {
    const v = values.get(headerKey(n));
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Reads the tab. Returns the rows plus counts of rows that could not be read (for a warning). */
export function parseCohortRows(rows: any[]): { rows: CohortRow[]; skipped: number } {
  const out: CohortRow[] = [];
  let skipped = 0;
  for (const row of rows || []) {
    // The raw cell: an uploaded .xlsx gives an Excel date number, the Apps Script a 'yyyy-MM-dd ...' text
    const dateCell = Object.entries(row || {}).find(([k]) => headerKey(k) === 'date')?.[1];
    const m = /^(\d{4})-(\d{2})/.exec(sheetDateTime(dateCell)?.day || '');
    const day = Number(pick(row, 'Day_Number', 'Day'));
    const orders = Number(pick(row, 'Order_Count', 'Orders').replace(/,/g, ''));
    const sales = Number(pick(row, 'Sales', 'Revenue').replace(/,/g, ''));
    const category = pick(row, 'Sale_Category', 'Category');
    const cohort = pick(row, 'TT_Cohort', 'Talk Time Cohort');
    if (!m || !Number.isFinite(day) || day < 1 || !Number.isFinite(orders) || !Number.isFinite(sales) || !category || !cohort) {
      skipped++;
      continue;
    }
    out.push({ month: `${m[1]}-${m[2].padStart(2, '0')}`, date: sheetDateTime(dateCell)!.day, label: pick(row, 'Month') || `${m[1]}-${m[2]}`, day, category, cohort, orders, sales });
  }
  return { rows: out, skipped };
}

export async function saveCohortRows(rows: CohortRow[]): Promise<void> {
  const prev = await headRef().get();
  const prevChunks = prev.exists ? (prev.data() as any)?.chunks || 0 : 0;
  const parts: CohortRow[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) parts.push(rows.slice(i, i + CHUNK));
  const batch = adminDb.batch();
  parts.forEach((p, i) => batch.set(chunksCol().doc(`rows-${i}`), { rows: p }));
  for (let i = parts.length; i < prevChunks; i++) batch.delete(chunksCol().doc(`rows-${i}`));
  batch.set(headRef(), { chunks: parts.length, count: rows.length, updatedAt: new Date().toISOString() });
  await batch.commit();
}

/** How much is saved (a count and a time, never the report's numbers), for the monitor. */
export async function cohortReportStatus(): Promise<{ count: number; updatedAt: string | null }> {
  const head = await headRef().get();
  const d: any = head.exists ? head.data() : {};
  return { count: d.count || 0, updatedAt: d.updatedAt || null };
}

export async function loadCohortRows(): Promise<{ rows: CohortRow[]; updatedAt: string | null }> {
  const head = await headRef().get();
  if (!head.exists) return { rows: [], updatedAt: null };
  const d: any = head.data();
  const parts = await Promise.all(Array.from({ length: d.chunks || 0 }, (_, i) => chunksCol().doc(`rows-${i}`).get()));
  return { rows: parts.flatMap((p: any) => (p.exists ? p.data()?.rows || [] : [])), updatedAt: d.updatedAt || null };
}
