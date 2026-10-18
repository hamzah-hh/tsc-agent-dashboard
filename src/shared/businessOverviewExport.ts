/**
 * The Business Overview as a sheet in the layout of the Business Review sample files: KPIs down the side
 * (a block of tier rows per KPI, with the KPI name merged over it), months across newest first, and a
 * quarter average column after each complete quarter (financial year from April).
 */
import { ALL_TIERS, BusinessOverviewRow } from './businessOverview';

export interface SheetCell {
  v: string | number;
  t: 's' | 'n';
  z?: string;
}

export interface OverviewSheet {
  cells: Array<Array<SheetCell | null>>;
  /** Merged ranges, 0-based. */
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  colWidths: number[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthHeader = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}-${m.slice(2, 4)}`;

const TIER_ORDER = ['HO Caller', 'Store Callers - Andheri', 'Store Callers - Bangalore'];

interface Kpi {
  label: string;
  allLabel: string;
  z: string;
  get: (r: BusinessOverviewRow) => number | null;
}

const KPIS: Kpi[] = [
  { label: 'Total Outbound Calls', allLabel: 'Total', z: '#,##0', get: (r) => r.outbound },
  { label: 'Average Outbound Calls / Agent / Day', allLabel: 'Team Average', z: '#,##0', get: (r) => r.avgOutbound },
  { label: 'Total Connected Calls', allLabel: 'Total', z: '#,##0', get: (r) => r.connected },
  { label: 'Average Connected Calls / Agent / Day', allLabel: 'Team Average', z: '#,##0', get: (r) => r.avgConnected },
  { label: 'Total Talk Time', allLabel: 'Total', z: '[h]:mm:ss', get: (r) => r.talkSec / 86400 },
  { label: 'Average Talk Time', allLabel: 'Team Average', z: '[h]:mm:ss', get: (r) => (r.avgTalkSec === null ? null : r.avgTalkSec / 86400) },
  { label: 'Total Revenue', allLabel: 'Total', z: '0.00" Cr"', get: (r) => r.revenue / 1e7 },
  { label: 'Average Revenue per Agent', allLabel: 'Team Average', z: '0.00" L"', get: (r) => (r.avgRevenue === null ? null : r.avgRevenue / 1e5) },
  { label: 'Active Team Size', allLabel: 'Total', z: '0.00', get: (r) => r.teamSize },
  { label: 'Average Order Value', allLabel: 'Team Average', z: '#,##0.00', get: (r) => r.aov },
];

type Col = { kind: 'month'; month: string; live: boolean } | { kind: 'quarter'; label: string; months: string[] };

/** Financial-year quarter of a month: Apr-Jun = Q1 of the year that starts in April. */
export function quarterOf(month: string): { label: string; key: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const q = Math.floor(((m + 8) % 12) / 3) + 1;
  return { label: `${fy}-Q${q} Average`, key: `${fy}-Q${q}` };
}

export function buildOverviewSheet(rows: BusinessOverviewRow[]): OverviewSheet {
  const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
  const live = new Set(rows.filter((r) => r.live).map((r) => r.month));
  const tiers = [...new Set(rows.map((r) => r.tier).filter((t) => t !== ALL_TIERS))].sort((a, b) => {
    const ia = TIER_ORDER.indexOf(a);
    const ib = TIER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const byKey = new Map(rows.map((r) => [`${r.month}|${r.tier}`, r]));
  const hasAll = rows.some((r) => r.tier === ALL_TIERS);

  // Columns: months newest first; a quarter average sits after the earliest month of a complete quarter
  const cols: Col[] = [];
  for (const m of months) {
    cols.push({ kind: 'month', month: m, live: live.has(m) });
    const q = quarterOf(m);
    const inQ = months.filter((x) => quarterOf(x).key === q.key);
    if (inQ.length === 3 && !inQ.some((x) => live.has(x)) && m === inQ[inQ.length - 1]) cols.push({ kind: 'quarter', label: q.label, months: inQ });
  }

  const value = (col: Col, tier: string, get: (r: BusinessOverviewRow) => number | null): number | null => {
    if (col.kind === 'month') {
      const r = byKey.get(`${col.month}|${tier}`);
      return r ? get(r) : null;
    }
    const vals = col.months.map((m) => byKey.get(`${m}|${tier}`)).map((r) => (r ? get(r) : null)).filter((v): v is number => v !== null && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const cell = (v: number | null, z: string): SheetCell | null => (v === null ? null : { v, t: 'n', z });
  const text = (v: string): SheetCell => ({ v, t: 's' });

  const width = 2 + cols.length;
  const cells: OverviewSheet['cells'] = [];
  const merges: OverviewSheet['merges'] = [];
  const row = (...c: Array<SheetCell | null>) => {
    cells.push([...c, ...Array(Math.max(0, width - c.length)).fill(null)]);
  };

  row(text('KPIs'), null, ...cols.map((c) => text(c.kind === 'month' ? `${monthHeader(c.month)}${c.live ? ' (MTD)' : ''}` : c.label)));
  row();
  row(text('Particulars'), text('Tier'));

  for (const k of KPIS) {
    const lines = [...tiers, ...(hasAll && tiers.length > 1 ? [ALL_TIERS] : [])];
    const start = cells.length;
    lines.forEach((t, i) => {
      row(i === 0 ? text(k.label) : null, text(t === ALL_TIERS ? k.allLabel : t), ...cols.map((c) => cell(value(c, t, k.get), k.z)));
    });
    if (lines.length > 1) merges.push({ s: { r: start, c: 0 }, e: { r: cells.length - 1, c: 0 } });
  }

  // Quality: one row for the team (the all-tier row, or the only tier a TL sees), one for Pre Sales
  const qTier = hasAll ? ALL_TIERS : tiers[0];
  if (qTier) {
    row(text('MOM Quality Score (Assist Sales Team)'), null, ...cols.map((c) => cell(value(c, qTier, (r) => r.quality), '0%')));
    if (hasAll && rows.some((r) => r.qualityPreSales != null)) {
      row(text('MOM Quality Score (Pre Sales Team)'), null, ...cols.map((c) => cell(value(c, ALL_TIERS, (r) => r.qualityPreSales ?? null), '0%')));
    }
  }

  return { cells, merges, colWidths: [38, 26, ...cols.map(() => 17)] };
}
