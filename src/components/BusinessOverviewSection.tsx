import React, { useMemo, useState } from 'react';
import { Briefcase, Download } from 'lucide-react';
import { formatNumberINR } from '../shared/incentive';
import { ALL_TIERS, BusinessOverviewRow } from '../shared/businessOverview';
import { hms } from '../shared/teamOps';
import { buildOverviewSheet } from '../shared/businessOverviewExport';
import { useDataStatus } from './DataStatusBar';

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}-${m.slice(2, 4)}`;

const cr = (n: number) => `${(n / 1e7).toFixed(2)} Cr`;
const lakh = (n: number) => `${(n / 1e5).toFixed(2)} L`;
const int = (n: number) => formatNumberINR(Math.round(n));

type Show = (r: BusinessOverviewRow) => string | null;

interface Kpi {
  label: string;
  /** Label of the all-tier row: a sum is a "Total", an average the "Team Average". */
  allLabel: string;
  show: Show;
}

const dash = (v: number | null | undefined, f: (n: number) => string) => (v === null || v === undefined || !Number.isFinite(v) ? null : f(v));

const KPIS: Kpi[] = [
  { label: 'Total Outbound Calls', allLabel: 'Total', show: (r) => dash(r.outbound, int) },
  { label: 'Average Outbound Calls / Agent / Day', allLabel: 'Team Average', show: (r) => dash(r.avgOutbound, int) },
  { label: 'Total Connected Calls', allLabel: 'Total', show: (r) => dash(r.connected, int) },
  { label: 'Average Connected Calls / Agent / Day', allLabel: 'Team Average', show: (r) => dash(r.avgConnected, int) },
  { label: 'Total Talk Time', allLabel: 'Total', show: (r) => dash(r.talkSec, hms) },
  { label: 'Average Talk Time / Agent / Day', allLabel: 'Team Average', show: (r) => dash(r.avgTalkSec, hms) },
  { label: 'Total Revenue', allLabel: 'Total', show: (r) => dash(r.revenue, cr) },
  { label: 'Average Revenue per Agent', allLabel: 'Team Average', show: (r) => dash(r.avgRevenue, lakh) },
  { label: 'Active Team Size', allLabel: 'Total', show: (r) => dash(r.teamSize, int) },
  { label: 'Average Order Value', allLabel: 'Team Average', show: (r) => dash(r.aov, int) },
  { label: 'Quality Score', allLabel: 'Team Average', show: (r) => dash(r.quality, (n) => `${(n * 100).toFixed(1)}%`) },
];

const TIER_ORDER = ['HO Caller', 'Store Callers - Andheri', 'Store Callers - Bangalore'];

/**
 * Business Overview: month by month, per tier, for the tiers the viewer may see. Past months come from the
 * Business_Overview tab; months of the cycle are worked out at every sync from Dialer, Orders and Quality.
 */
export function BusinessOverviewSection({ rows }: { rows: BusinessOverviewRow[] }) {
  const status = useDataStatus();
  const [exporting, setExporting] = useState(false);
  const { months, tiers, byKey, hasAll } = useMemo(() => {
    const months = [...new Set(rows.map((r) => r.month))].sort().reverse();
    const tiers = [...new Set(rows.map((r) => r.tier).filter((t) => t !== ALL_TIERS))].sort((a, b) => {
      const ia = TIER_ORDER.indexOf(a);
      const ib = TIER_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return { months, tiers, byKey: new Map(rows.map((r) => [`${r.month}|${r.tier}`, r])), hasAll: rows.some((r) => r.tier === ALL_TIERS) };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <section className={`${card} p-5 text-xs text-slate-500`}>
        No business overview yet. It appears after the next sync (paste the updated Code.gs, and add the Business_Overview tab for the past months).
      </section>
    );
  }

  // Downloads the table as an .xlsx in the layout of the Business Review files
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const sheet = buildOverviewSheet(rows);
      const ws = XLSX.utils.aoa_to_sheet(sheet.cells.map((r) => r.map((c) => c ?? '')));
      ws['!merges'] = sheet.merges;
      ws['!cols'] = sheet.colWidths.map((wch) => ({ wch }));
      // Latest data date (IST today when the status is not known): "Performance-till-30.09.2026"
      const asOf = status?.lastDataDate || new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const [y, m, d] = asOf.split('-');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Performance-till-${d}.${m}.${y}`);
      XLSX.writeFile(wb, `Business_Overview_${asOf}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const cell = (month: string, tier: string, show: Show) => {
    const r = byKey.get(`${month}|${tier}`);
    return r ? show(r) : null;
  };
  const preSales = months.map((m) => byKey.get(`${m}|${ALL_TIERS}`)?.qualityPreSales ?? null);
  const showPre = hasAll && preSales.some((v) => v !== null);
  const liveMonths = new Set(rows.filter((r) => r.live).map((r) => r.month));

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-950 dark:text-white">Business Overview</h3>
        <span className="text-[11px] text-slate-500">
          month by month{liveMonths.size ? '; a month marked MTD is still running, so only its averages compare with full months' : ''}
        </span>
        <button
          onClick={exportXlsx}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          title="Download as an Excel file in the Business Review layout"
        >
          <Download className="w-3.5 h-3.5" /> {exporting ? 'Exporting...' : 'Export .xlsx'}
        </button>
      </div>
      <div className="overflow-x-auto" data-scroll-box="true">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className="py-2 px-3 text-left text-[10px] uppercase tracking-wide font-bold text-slate-500 w-72">KPI</th>
              {months.map((m) => (
                <th key={m} className="py-2 px-3 text-right text-[10px] uppercase tracking-wide font-bold text-slate-500 whitespace-nowrap">
                  {monthLabel(m)}
                  {liveMonths.has(m) ? ' (MTD)' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KPIS.map((k) => {
              const lines = [...tiers.map((t) => ({ tier: t, name: t })), ...(hasAll && tiers.length > 1 ? [{ tier: ALL_TIERS, name: k.allLabel }] : [])];
              return (
                <React.Fragment key={k.label}>
                  <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                    <td colSpan={months.length + 1} className="py-1.5 px-3 text-[11px] font-bold text-slate-900 dark:text-white">
                      {k.label}
                    </td>
                  </tr>
                  {lines.map((l) => (
                    <tr key={l.tier} className="border-t border-slate-100 dark:border-slate-800">
                      <td className={`py-1.5 px-3 pl-6 text-[11px] break-words ${l.tier === ALL_TIERS ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                        {l.name}
                      </td>
                      {months.map((m) => (
                        <td key={m} className={`py-1.5 px-3 text-right tabular-nums whitespace-nowrap ${l.tier === ALL_TIERS ? 'font-bold' : ''} text-slate-900 dark:text-white`}>
                          {cell(m, l.tier, k.show) ?? '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
            {showPre && (
              <React.Fragment>
                <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                  <td colSpan={months.length + 1} className="py-1.5 px-3 text-[11px] font-bold text-slate-900 dark:text-white">
                    Quality Score (Pre Sales Team)
                  </td>
                </tr>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 px-3 pl-6 text-[11px] text-slate-600 dark:text-slate-300">Pre Sales</td>
                  {preSales.map((v, i) => (
                    <td key={i} className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap text-slate-900 dark:text-white">
                      {v === null ? '-' : `${(v * 100).toFixed(1)}%`}
                    </td>
                  ))}
                </tr>
              </React.Fragment>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
