import React, { useEffect, useMemo, useRef, useState } from 'react';
import { elementToPng } from '../utils/captureImage';
import { ExportCsvButton } from './ExportCsvButton';
import { csvName, downloadCsv as saveCsv, CsvCell } from '../utils/csv';
import { ChevronDown, ChevronUp, Copy, Download, Lock, Plus, RefreshCw, X } from 'lucide-react';
import { formatNumberINR } from '../shared/incentive';
import {
  COHORT_CATEGORIES,
  CohortPeriod,
  CohortRow,
  CohortTableRow,
  CompanyDay,
  DiwaliDay,
  attributedRevenue,
  diwaliTotals,
  companyForPeriod,
  cohortTableForPeriod,
  growth,
  monthToDate,
  rowDate,
  sameDaysMonthsBack,
} from '../shared/cohortReport';

interface CohortReportViewProps {
  getIdToken: () => Promise<string>;
}

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs';
// Proportional digits (tabular-nums) keep the numbers narrow
const td = 'py-1.5 px-1.5 text-right tabular-nums whitespace-nowrap text-[11px]';
const input = 'border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-white rounded-lg px-2 py-1.5 text-xs';
const smallBtn = 'px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800';

const money = (n: number | null) => (n === null ? '-' : formatNumberINR(Math.round(n)));
const pct = (g: number | null) => (g === null ? '-' : `${(g * 100).toFixed(1)}%`);
const growthClass = (g: number | null) =>
  g === null ? 'text-slate-400' : g < 0 ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40' : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';

const fmtDay = (d: string, withYear = true) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/** "1-12 Oct 2026", or "28 Sep - 3 Oct 2026" across months. */
function periodText(p: CohortPeriod): string {
  if (p.from === p.to) return fmtDay(p.from);
  if (p.from.slice(0, 7) === p.to.slice(0, 7)) return `${Number(p.from.slice(8))}-${fmtDay(p.to)}`;
  return `${fmtDay(p.from, p.from.slice(0, 4) !== p.to.slice(0, 4))} - ${fmtDay(p.to)}`;
}

/** "SDLM" / "Same days 2 months back" when a comparison is exactly that, else ''. */
function periodTag(base: CohortPeriod, p: CohortPeriod): string {
  for (let n = 1; n <= 24; n++) {
    const s = sameDaysMonthsBack(base, n);
    if (s.from === p.from && s.to === p.to) return n === 1 ? 'SDLM' : `Same days ${n} months back`;
  }
  return '';
}

/** The cohort tables of every period as flat rows: one row per period and cohort. */
function cohortCsvRows(periods: CohortPeriod[], tables: CohortTableRow[][]): CsvCell[][] {
  const base = periods[0];
  const rows: CsvCell[][] = [
    ['Period', 'From', 'To', 'Talk Time Cohort', ...COHORT_CATEGORIES.flatMap((c) => [`${c.label} Orders`, `${c.label} Revenue`]), 'Total Orders', 'Total Revenue', 'AOV'],
  ];
  periods.forEach((p, i) => {
    for (const r of tables[i] || []) {
      rows.push([i === 0 ? 'Base' : periodTag(base, p) || `Comparison ${i}`, p.from, p.to, r.cohort, ...COHORT_CATEGORIES.flatMap((c) => [r.byCategory[c.key].orders, Math.round(r.byCategory[c.key].revenue)]), r.orders, Math.round(r.revenue), r.aov === null ? '' : Math.round(r.aov)]);
    }
  });
  return rows;
}

export function CohortReportView({ getIdToken }: CohortReportViewProps) {
  const [rows, setRows] = useState<CohortRow[]>([]);
  const [company, setCompany] = useState<CompanyDay[]>([]);
  const [diwali, setDiwali] = useState<DiwaliDay[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // periods[0] is the base period; the rest are comparisons
  const [periods, setPeriods] = useState<CohortPeriod[]>([]);
  // A clicked cohort is highlighted in every table; clicking it again clears it
  const [picked, setPicked] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied' | 'saved' | 'error'>('idle');
  const tablesRef = useRef<HTMLDivElement>(null);
  // The title and filters can be folded away so the tables alone can be screenshotted (remembered per browser)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cohortReport.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem('cohortReport.collapsed', next ? '1' : '0');
    } catch {
      // private window: the choice is simply not remembered
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cohort-report', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.rows || []);
      setCompany(json.company || []);
      setDiwali(json.diwali || []);
      setUpdatedAt(json.updatedAt || null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [firstDate, latestDate] = useMemo(() => {
    let min = '';
    let max = '';
    for (const r of rows) {
      const d = rowDate(r);
      if (!min || d < min) min = d;
      if (d > max) max = d;
    }
    return [min, max];
  }, [rows]);

  // Default: this month to date vs SDLM (the same days last month)
  const defaults = (): CohortPeriod[] => {
    const base = monthToDate(latestDate);
    return [base, sameDaysMonthsBack(base, 1)];
  };
  useEffect(() => {
    if (latestDate && periods.length === 0) setPeriods(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDate]);

  const tables = useMemo(() => periods.map((p) => cohortTableForPeriod(rows, p)), [rows, periods]);

  if (loading) return <div className={`${card} p-10 text-center text-xs text-slate-500`}>Loading the report...</div>;
  if (error) {
    return (
      <div className={`${card} p-10 text-center`}>
        <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
        <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
          Retry
        </button>
      </div>
    );
  }
  if (!rows.length || periods.length === 0) {
    return <div className={`${card} p-10 text-center text-xs text-slate-500`}>No data yet. It arrives with the next sync of the Anirban_Ref tab.</div>;
  }

  const base = periods[0];
  const setPeriod = (i: number, p: CohortPeriod) => setPeriods((ps) => ps.map((x, j) => (j === i ? p : x)));
  // A new comparison goes one more month back than the furthest one already there
  const addComparison = () => {
    let n = 1;
    while (periods.some((p) => periodTag(base, p) === (n === 1 ? 'SDLM' : `Same days ${n} months back`))) n++;
    setPeriods((ps) => [...ps, sameDaysMonthsBack(base, n)]);
  };

  const comparisons = periods.slice(1).map((p, i) => ({ period: p, table: tables[i + 1], tag: periodTag(base, p) }));

  const downloadCsv = () => saveCsv(`talk_time_cohort_${base.from}_to_${base.to}`, cohortCsvRows(periods, tables));

  // All tables as one PNG on the clipboard; where the browser cannot copy images, the PNG is downloaded
  const copyPng = async () => {
    if (!tablesRef.current) return;
    setCopyState('busy');
    try {
      const dark = document.documentElement.classList.contains('dark');
      // An off-screen full-width copy without scroll boxes: no scrollbars, nothing cut off
      const blob = await elementToPng(tablesRef.current, { background: dark ? '#020617' : '#f8fafc' });
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopyState('copied');
      } catch {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `talk_time_cohort_${base.from}_to_${base.to}.png`;
        a.click();
        URL.revokeObjectURL(url);
        setCopyState('saved');
      }
    } catch (err) {
      console.error('Copy as PNG failed:', err);
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  };
  const copyLabel =
    copyState === 'busy'
      ? 'Copying...'
      : copyState === 'copied'
      ? 'Copied!'
      : copyState === 'saved'
      ? 'Saved as PNG'
      : copyState === 'error'
      ? 'Copy failed'
      : 'Copy as PNG';
  const copyButton = (
    <button onClick={copyPng} disabled={copyState === 'busy'} className={`${smallBtn} inline-flex items-center gap-1 disabled:opacity-60`} title="Copy all tables as one image">
      <Copy className="w-3.5 h-3.5" /> {copyLabel}
    </button>
  );

  return (
    <div className="space-y-6">
      {collapsed ? (
        <div className="flex justify-end items-center gap-2 -mb-3">
          {copyButton}
          <button
            onClick={() => toggleCollapsed(false)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Show the report title and date filters"
          >
            <ChevronDown className="w-3 h-3" /> Filters
          </button>
        </div>
      ) : (
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
              Talk Time Cohort Report <Lock className="w-4 h-4 text-slate-400" />
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Private report. Cohorts are cumulative (each row counts that talk time and longer). Data {fmtDay(firstDate)} to {fmtDay(latestDate)}, updated{' '}
              {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : '-'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {copyButton}
            <button onClick={() => toggleCollapsed(true)} className={`${smallBtn} inline-flex items-center gap-1`} title="Hide the title and filters (for a clean screenshot)">
              <ChevronUp className="w-3.5 h-3.5" /> Hide
            </button>
            <button onClick={() => setPeriods(defaults())} className={smallBtn} title="This month to date vs the same days last month">
              Reset: MTD vs SDLM
            </button>
            <button onClick={downloadCsv} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Download CSV">
              <Download className="w-3.5 h-3.5" />
            </button>
            <button onClick={load} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Reload">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {periods.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`w-28 font-semibold ${i === 0 ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                {i === 0 ? 'Base period' : `Comparison ${i}`}
              </span>
              <input
                type="date"
                value={p.from}
                min={firstDate}
                max={p.to}
                onChange={(e) => e.target.value && setPeriod(i, { ...p, from: e.target.value })}
                className={input}
                aria-label={`${i === 0 ? 'Base' : `Comparison ${i}`} from`}
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={p.to}
                min={p.from}
                max={latestDate}
                onChange={(e) => e.target.value && setPeriod(i, { ...p, to: e.target.value })}
                className={input}
                aria-label={`${i === 0 ? 'Base' : `Comparison ${i}`} to`}
              />
              {i === 0 ? (
                <button onClick={() => setPeriod(0, monthToDate(latestDate))} className={smallBtn}>
                  Month to date
                </button>
              ) : (
                <>
                  <select
                    value=""
                    onChange={(e) => e.target.value && setPeriod(i, sameDaysMonthsBack(base, Number(e.target.value)))}
                    className={input}
                    aria-label="Same days of an earlier month"
                  >
                    <option value="">Same days of...</option>
                    {Array.from({ length: 12 }, (_, k) => k + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'Last month (SDLM)' : `${n} months back`}
                      </option>
                    ))}
                  </select>
                  {periodTag(base, p) && <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">{periodTag(base, p)}</span>}
                  <button onClick={() => setPeriods((ps) => ps.filter((_, j) => j !== i))} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" aria-label={`Remove comparison ${i}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          <button onClick={addComparison} className={`${smallBtn} inline-flex items-center gap-1`}>
            <Plus className="w-3.5 h-3.5" /> Add comparison
          </button>
        </div>
      </div>
      )}

      {/* Every table has the same columns at the same widths, so they line up. The base table carries the
          growth against each comparison; the comparison tables keep those column slots empty. */}
      <div ref={tablesRef} className="space-y-4 p-1">
        <CohortTable
          title={`Base: ${periodText(base)}`}
          table={tables[0]}
          growth={comparisons.map((c) => ({ label: c.tag ? `${c.tag} · ${periodText(c.period)}` : periodText(c.period), table: c.table }))}
          slots={comparisons.length}
          picked={picked}
          onPick={setPicked}
        />
        {comparisons.map((c, i) => (
          <CohortTable
            key={i}
            title={`Comparison ${i + 1}: ${periodText(c.period)}${c.tag ? ` · ${c.tag}` : ''}`}
            table={c.table}
            growth={[]}
            slots={comparisons.length}
            picked={picked}
            onPick={setPicked}
          />
        ))}
        <CompanySection
          periods={periods}
          tables={tables}
          company={company}
          tags={periods.map((p, i) => (i === 0 ? 'Base' : periodTag(base, p) || `Comparison ${i}`))}
        />
        <DiwaliSection days={diwali} />
      </div>
      <AprilAttributionSection getIdToken={getIdToken} periods={periods} picked={picked} onPick={setPicked} />
    </div>
  );
}

/**
 * The same cohort tables on the April onwards attribution (Anirban_Cohort_Reportv2). Hidden until its button is
 * pressed; the rows are fetched then, not with the page. It uses the base period and comparisons chosen above.
 */
function AprilAttributionSection({
  getIdToken,
  periods,
  picked,
  onPick,
}: {
  getIdToken: () => Promise<string>;
  periods: CohortPeriod[];
  picked: string | null;
  onPick: (c: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CohortRow[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied' | 'saved' | 'error'>('idle');
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cohort-report-v2', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.rows || []);
      setUpdatedAt(json.updatedAt || null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the report.');
    } finally {
      setLoading(false);
    }
  };

  const show = () => {
    setOpen(true);
    if (rows === null && !loading) load();
  };

  const tables = useMemo(() => (rows ? periods.map((p) => cohortTableForPeriod(rows, p)) : []), [rows, periods]);

  if (!open) {
    return (
      <div className="flex justify-center">
        <button onClick={show} className={`${smallBtn} inline-flex items-center gap-1.5 px-4 py-2`}>
          <ChevronDown className="w-3.5 h-3.5" /> View April_Onwards Attribution
        </button>
      </div>
    );
  }

  const base = periods[0];
  const comparisons = periods.slice(1).map((p, i) => ({ period: p, table: tables[i + 1], tag: periodTag(base, p) }));

  const copyPng = async () => {
    if (!ref.current) return;
    setCopyState('busy');
    try {
      const dark = document.documentElement.classList.contains('dark');
      const blob = await elementToPng(ref.current, { background: dark ? '#020617' : '#f8fafc' });
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopyState('copied');
      } catch {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `april_onwards_attribution_${base.from}_to_${base.to}.png`;
        a.click();
        URL.revokeObjectURL(url);
        setCopyState('saved');
      }
    } catch (err) {
      console.error('Copy as PNG failed:', err);
      setCopyState('error');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  };
  const copyLabel = { idle: 'Copy as PNG', busy: 'Copying...', copied: 'Copied!', saved: 'Saved as PNG', error: 'Copy failed' }[copyState];

  return (
    <div className="space-y-4">
      <div className={`${card} p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3`}>
        <div>
          <h2 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
            April Onwards Attribution <Lock className="w-4 h-4 text-slate-400" />
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            The same cohort tables on the April onwards attribution (sheet Anirban_Cohort_Reportv2), for the periods chosen above. Updated{' '}
            {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : '-'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            filename={`april_onwards_attribution_${base.from}_to_${base.to}`}
            disabled={!rows?.length}
            className={`${smallBtn} inline-flex items-center gap-1 disabled:opacity-60`}
            getRows={() => cohortCsvRows(periods, tables)}
          />
          <button onClick={copyPng} disabled={copyState === 'busy' || !rows?.length} className={`${smallBtn} inline-flex items-center gap-1 disabled:opacity-60`} title="Copy these tables as one image">
            <Copy className="w-3.5 h-3.5" /> {copyLabel}
          </button>
          <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-60" title="Reload">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setOpen(false)} className={`${smallBtn} inline-flex items-center gap-1`}>
            <ChevronUp className="w-3.5 h-3.5" /> Hide
          </button>
        </div>
      </div>

      {loading && rows === null ? (
        <div className={`${card} p-10 text-center text-xs text-slate-500`}>Loading the report...</div>
      ) : error ? (
        <div className={`${card} p-10 text-center`}>
          <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>
          <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            Retry
          </button>
        </div>
      ) : !rows?.length ? (
        <div className={`${card} p-10 text-center text-xs text-slate-500`}>No data yet. It arrives with the next sync of the Anirban_Cohort_Reportv2 tab.</div>
      ) : (
        <div ref={ref} className="space-y-4 p-1">
          <CohortTable
            title={`April onwards, Base: ${periodText(base)}`}
            table={tables[0]}
            growth={comparisons.map((c) => ({ label: c.tag ? `${c.tag} · ${periodText(c.period)}` : periodText(c.period), table: c.table }))}
            slots={comparisons.length}
            picked={picked}
            onPick={onPick}
          />
          {comparisons.map((c, i) => (
            <CohortTable
              key={i}
              title={`April onwards, Comparison ${i + 1}: ${periodText(c.period)}${c.tag ? ` · ${c.tag}` : ''}`}
              table={c.table}
              growth={[]}
              slots={comparisons.length}
              picked={picked}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const thGroup = 'pt-2 pb-1 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-center whitespace-nowrap border-b border-slate-200 dark:border-slate-700';
const thSub = 'pb-2 pt-1 px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 text-right whitespace-nowrap';
// Headers of the company tables wrap onto two lines instead of forcing the table wide
const thWrap = 'pb-2 pt-2 px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 text-right leading-tight align-bottom';
const sep = 'border-l border-slate-200 dark:border-slate-700';
const growthSep = 'border-l-2 border-slate-300 dark:border-slate-600';

export function CohortTable({
  title,
  table,
  growth: growthAgainst,
  slots,
  picked,
  onPick,
}: {
  title: string;
  table: CohortTableRow[];
  /** Growth of this (base) table against each comparison; [] on a comparison table. */
  growth: Array<{ label: string; table: CohortTableRow[] }>;
  /** Number of comparison column groups every table reserves, so all tables line up. */
  slots: number;
  picked: string | null;
  onPick: (cohort: string | null) => void;
}) {
  const groups = Array.from({ length: slots }, (_, i) => growthAgainst[i] || null);
  return (
    <section className={`${card} overflow-hidden`}>
      <h3 className="px-4 py-2.5 text-sm font-bold text-slate-950 dark:text-white border-b border-slate-200 dark:border-slate-800">{title}</h3>
      <div className="overflow-x-auto" data-scroll-box="true">
        {/* Fixed layout and the same columns in every table: the columns line up from table to table */}
        <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: `${1180 + slots * 260}px` }}>
          <colgroup>
            <col style={{ width: '11rem' }} />
            {Array.from({ length: COHORT_CATEGORIES.length * 2 + 3 + slots * 3 }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th rowSpan={2} className="py-2 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-left align-bottom">
                Talk Time Cohort
              </th>
              {COHORT_CATEGORIES.map((c) => (
                <th key={c.key} colSpan={2} className={`${thGroup} ${sep}`}>
                  {c.label}
                </th>
              ))}
              <th colSpan={3} className={`${thGroup} ${sep}`}>
                Total
              </th>
              {groups.map((g, i) => (
                <th key={i} colSpan={3} className={`${thGroup} ${growthSep}`}>
                  {g ? `Growth vs ${g.label}` : ''}
                </th>
              ))}
            </tr>
            <tr>
              {COHORT_CATEGORIES.map((c, i) => (
                <React.Fragment key={c.key}>
                  {/* first cell of this header row (the cohort column spans both rows): keep it centred */}
                  <th className={`${thSub} ${sep} ${i === 0 ? 'cell-center' : ''}`}>Orders</th>
                  <th className={thSub}>Revenue</th>
                </React.Fragment>
              ))}
              <th className={`${thSub} ${sep}`}>Orders</th>
              <th className={thSub}>Revenue</th>
              <th className={thSub}>AOV</th>
              {groups.map((g, i) => (
                <React.Fragment key={i}>
                  <th className={`${thSub} ${growthSep}`}>{g ? 'Orders' : ''}</th>
                  <th className={thSub}>{g ? 'Revenue' : ''}</th>
                  <th className={thSub}>{g ? 'AOV' : ''}</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.map((r) => {
              const on = picked === r.cohort;
              return (
                <tr
                  key={r.cohort}
                  onClick={() => onPick(on ? null : r.cohort)}
                  title="Click to highlight this cohort in every table"
                  className={`cursor-pointer ${on ? 'bg-amber-100 dark:bg-amber-900/40 outline outline-2 outline-amber-400 -outline-offset-2' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                >
                  <td className={`py-1.5 px-2 text-[11px] font-semibold whitespace-nowrap truncate ${on ? 'text-amber-900 dark:text-amber-200' : 'text-slate-900 dark:text-white'}`}>
                    {r.cohort}
                  </td>
                  {COHORT_CATEGORIES.map((c) => (
                    <React.Fragment key={c.key}>
                      <td className={`${td} ${sep}`}>{formatNumberINR(r.byCategory[c.key].orders)}</td>
                      <td className={td}>{money(r.byCategory[c.key].revenue)}</td>
                    </React.Fragment>
                  ))}
                  <td className={`${td} ${sep} font-bold text-slate-900 dark:text-white`}>{formatNumberINR(r.orders)}</td>
                  <td className={`${td} font-bold text-slate-900 dark:text-white`}>{money(r.revenue)}</td>
                  <td className={td}>{money(r.aov)}</td>
                  {groups.map((g, gi) => {
                    if (!g) return <td key={gi} colSpan={3} className={growthSep} />;
                    const o = g.table.find((x) => x.cohort === r.cohort);
                    const vals = [growth(r.orders, o?.orders ?? null), growth(r.revenue, o?.revenue ?? null), growth(r.aov, o?.aov ?? null)];
                    return vals.map((v, i) => (
                      <td key={`${gi}-${i}`} className={`${td} ${growthClass(v)} ${i === 0 ? growthSep : ''}`}>
                        {pct(v)}
                      </td>
                    ));
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const pp = (v: number | null) => (v === null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} pp`);

/**
 * Company revenue (Company_DOD tab) for each period, and each cumulative talk time cohort's revenue as a
 * share of it. The change columns are the base share minus each comparison's share, in percentage points.
 */
function CompanySection({
  periods,
  tables,
  company,
  tags,
}: {
  periods: CohortPeriod[];
  tables: CohortTableRow[][];
  company: CompanyDay[];
  tags: string[];
}) {
  if (company.length === 0) {
    return (
      <section className={`${card} p-5 text-xs text-slate-500`}>
        No company revenue yet. It arrives with the next sync of the Company_DOD tab (paste the updated Code.gs first).
      </section>
    );
  }
  const totals = periods.map((p) => companyForPeriod(company, p));
  const first = company[0].date;
  const last = company[company.length - 1].date;
  const outside = periods.some((p) => p.from < first || p.to > last);
  const comps = periods.slice(1);

  // Rows: company, retail, marketplace and website revenue (Company_DOD), attributed revenue (cumulative 10 seconds
  // cohort of the cohort tables), then attributed revenue as a % of each of the four.
  const attributed = tables.map((t) => attributedRevenue(t));
  const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
  const metrics: Array<{ label: string; percent: boolean; values: Array<number | null> }> = [
    { label: 'Company Revenue', percent: false, values: totals.map((t) => t.revenue) },
    { label: 'Retail Revenue', percent: false, values: totals.map((t) => t.retail) },
    { label: 'Marketplace Revenue', percent: false, values: totals.map((t) => t.marketplace) },
    { label: 'Website Revenue', percent: false, values: totals.map((t) => t.website) },
    { label: 'Attributed Revenue', percent: false, values: attributed },
    { label: 'Attributed Revenue % (of Company Revenue)', percent: true, values: totals.map((t, i) => ratio(attributed[i], t.revenue)) },
    { label: 'Retail Revenue % (Attributed / Retail)', percent: true, values: totals.map((t, i) => ratio(attributed[i], t.retail)) },
    { label: 'Marketplace Revenue % (Attributed / Marketplace)', percent: true, values: totals.map((t, i) => ratio(attributed[i], t.marketplace)) },
    { label: 'Website Revenue % (Attributed / Website)', percent: true, values: totals.map((t, i) => ratio(attributed[i], t.website)) },
  ];

  return (
    <>
      <section className={`${card} overflow-hidden`}>
        <h3 className="px-4 py-2.5 text-sm font-bold text-slate-950 dark:text-white border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <span>
            Company Revenue
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              Company_DOD tab, {fmtDay(first)} to {fmtDay(last)}
              {outside ? '; a period reaching outside these dates is partly empty' : ''}
            </span>
          </span>
          <ExportCsvButton
            filename="company_revenue"
            getRows={() => [
              ['Period', 'From', 'To', 'Days', 'Orders', 'Revenue', 'Retail Revenue', 'Marketplace Revenue', 'Website Revenue', 'AOV', 'Base Orders vs This %', 'Base Revenue vs This %', 'Base AOV vs This %'],
              ...periods.map((p, i) => {
                const t = totals[i];
                const g = i === 0 ? [null, null, null] : [growth(totals[0].orders, t.orders), growth(totals[0].revenue, t.revenue), growth(totals[0].aov, t.aov)];
                return [tags[i], p.from, p.to, t.days, t.orders, Math.round(t.revenue), Math.round(t.retail), Math.round(t.marketplace), Math.round(t.website), t.aov === null ? '' : Math.round(t.aov), ...g.map((v) => (v === null ? '' : Number((v * 100).toFixed(1)))) ];
              }),
            ]}
          />
        </h3>
        <div className="overflow-x-auto" data-scroll-box="true">
          <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: '760px' }}>
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="py-2 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-left w-64">Period</th>
                <th className={thWrap}>Days</th>
                <th className={thWrap}>Orders</th>
                <th className={thWrap}>Revenue</th>
                <th className={thWrap}>AOV</th>
                <th className={`${thWrap} ${growthSep}`}>Base orders vs this</th>
                <th className={thWrap}>Base revenue vs this</th>
                <th className={thWrap}>Base AOV vs this</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {periods.map((p, i) => {
                const t = totals[i];
                const g = i === 0 ? [null, null, null] : [growth(totals[0].orders, t.orders), growth(totals[0].revenue, t.revenue), growth(totals[0].aov, t.aov)];
                return (
                  <tr key={i}>
                    <td className="py-1.5 px-2 text-[11px] font-semibold text-slate-900 dark:text-white leading-tight break-words">
                      {tags[i]}: {periodText(p)}
                    </td>
                    <td className={td}>{t.days}</td>
                    <td className={td}>{formatNumberINR(t.orders)}</td>
                    <td className={`${td} font-bold text-slate-900 dark:text-white`}>{money(t.revenue)}</td>
                    <td className={td}>{money(t.aov)}</td>
                    {g.map((v, k) => (
                      <td key={k} className={`${td} ${growthClass(v)} ${k === 0 ? growthSep : ''}`}>
                        {pct(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} overflow-hidden`}>
        <h3 className="px-4 py-2.5 text-sm font-bold text-slate-950 dark:text-white border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <span>
            Attributed Revenue
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              cumulative revenue of orders with 10 seconds or more of talk time, against the Company_DOD revenue
            </span>
          </span>
          <ExportCsvButton
            filename="attributed_revenue"
            getRows={() => [
              ['Metric', ...periods.map((p, i) => `${tags[i]} (${p.from} to ${p.to})`), ...comps.map((_, i) => `Base vs ${tags[i + 1]} change (pp for % rows, % for others)`)],
              ...metrics.map((m) => [
                m.label,
                ...m.values.map((v) => (v === null ? '' : m.percent ? Number(v.toFixed(2)) : Math.round(v))),
                ...comps.map((_, i) => {
                  const b = m.values[0];
                  const o = m.values[i + 1];
                  const change = m.percent ? (b !== null && o !== null ? b - o : null) : growth(b, o);
                  return change === null ? '' : Number((m.percent ? change : change * 100).toFixed(2));
                }),
              ]),
            ]}
          />
        </h3>
        <div className="overflow-x-auto" data-scroll-box="true">
          <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: `${220 + periods.length * 150 + comps.length * 130}px` }}>
            <colgroup>
              <col style={{ width: '15rem' }} />
              {Array.from({ length: periods.length + comps.length }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="py-2 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-left align-bottom">Metric</th>
                {periods.map((p, i) => (
                  <th key={i} className={`${thWrap} ${i === 0 ? sep : ''} text-center leading-tight`}>
                    <span className="block font-semibold text-slate-700 dark:text-slate-200">{tags[i]}</span>
                    {periodText(p)}
                  </th>
                ))}
                {comps.map((_, i) => (
                  <th key={i} className={`${thWrap} ${i === 0 ? growthSep : sep} text-center leading-tight`}>
                    <span className="block font-semibold text-slate-700 dark:text-slate-200">Base vs {tags[i + 1]}</span>
                    change
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.map((m) => {
                const vals = m.values;
                return (
                  <tr key={m.label} className={m.percent ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''}>
                    <td className={`py-1.5 px-2 text-[11px] font-semibold leading-tight break-words ${m.percent ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-white'}`}>{m.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={`${td} ${i === 0 ? sep : ''} font-bold text-slate-900 dark:text-white`}>
                        {m.percent ? (v === null ? '-' : `${v.toFixed(2)}%`) : money(v)}
                      </td>
                    ))}
                    {comps.map((_, i) => {
                      const base = vals[0];
                      const other = vals[i + 1];
                      const change = m.percent ? (base !== null && other !== null ? base - other : null) : growth(base, other);
                      return (
                        <td key={i} className={`${td} ${growthClass(change)} ${i === 0 ? growthSep : sep}`}>
                          {m.percent ? pp(change) : pct(change)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const ach = (actual: number, projection: number) => (projection > 0 ? (actual / projection) * 100 : null);
const pctText = (v: number | null) => (v === null ? '-' : `${v.toFixed(1)}%`);
const achClass = (v: number | null) =>
  v === null ? 'text-slate-400' : v >= 100 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : v >= 85 ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40' : 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40';

type Rag = 'g' | 'a' | 'r';
const ragClass: Record<Rag, string> = {
  g: 'text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/50',
  a: 'text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50',
  r: 'text-rose-800 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/50',
};
/** Ranks the values best first and splits them in thirds: top third green, middle amber, bottom third red. */
function ragByRank(values: Array<number | null>): Array<Rag | null> {
  const order = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null).sort((a, b) => b.v - a.v);
  const out: Array<Rag | null> = values.map(() => null);
  order.forEach((x, rank) => {
    out[x.i] = rank < order.length / 3 ? 'g' : rank < (order.length * 2) / 3 ? 'a' : 'r';
  });
  return out;
}

/**
 * Diwali projection (Diwali_Projection tab): the company's daily projection against the actual, with attributed
 * and 3 minute revenue as a share of the actual. Days with an actual of 0 are still ahead.
 */
function DiwaliSection({ days }: { days: DiwaliDay[] }) {
  // Days without data yet are folded away until asked for
  const [showAhead, setShowAhead] = useState(false);
  if (days.length === 0) {
    return (
      <section className={`${card} p-5 text-xs text-slate-500`}>
        No Diwali projection yet. It arrives with the next sync of the Diwali_Projection tab (paste the updated Code.gs first).
      </section>
    );
  }
  const t = diwaliTotals(days);
  const achieved = ach(t.actual, t.projectionToDate);
  const ofAll = ach(t.actual, t.projectionAll);
  // What the remaining days must average to still reach the full projection
  const needPerDay = t.remainingDays > 0 ? Math.max(0, t.projectionAll - t.actual) / t.remainingDays : null;
  const projPerDay = t.remainingDays > 0 ? t.remainingProjection / t.remainingDays : null;
  // RAG of the played days by rank of Attributed % and of 3 min % (top third green, middle amber, bottom third red)
  const attrShare = days.map((d) => (d.actual > 0 ? ach(d.attributed, d.actual) : null));
  const threeShare = days.map((d) => (d.actual > 0 ? ach(d.threeMin, d.actual) : null));
  const attrRag = ragByRank(attrShare);
  const threeRag = ragByRank(threeShare);
  const firstAhead = days.findIndex((x) => !(x.actual > 0));
  const aheadCount = firstAhead < 0 ? 0 : days.length - firstAhead;
  const tiles: Array<{ label: string; value: string; sub?: string; cls?: string }> = [
    { label: 'Projection (full period)', value: money(t.projectionAll), sub: `${fmtDay(days[0].date)} to ${fmtDay(days[days.length - 1].date)}` },
    { label: 'Projection to date', value: money(t.projectionToDate), sub: `${t.days} day(s) played` },
    { label: 'Actual to date', value: money(t.actual), sub: `${pctText(ofAll)} of full projection` },
    { label: 'Achievement to date', value: pctText(achieved), cls: achClass(achieved) },
    { label: 'Attributed Revenue', value: money(t.attributed), sub: `${pctText(ach(t.attributed, t.actual))} of actual` },
    { label: '3 min Revenue', value: money(t.threeMin), sub: `${pctText(ach(t.threeMin, t.actual))} of actual` },
    { label: 'Remaining projection', value: money(t.remainingProjection), sub: `${t.remainingDays} day(s) left` },
    { label: 'Needed per day to reach full', value: money(needPerDay), sub: projPerDay === null ? undefined : `projected avg ${money(projPerDay)}` },
  ];
  return (
    <section className={`${card} overflow-hidden`}>
      <h3 className="px-4 py-2.5 text-sm font-bold text-slate-950 dark:text-white border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <span>
          Diwali Projection
          <span className="ml-2 text-[11px] font-normal text-slate-500">Diwali_Projection tab; achievement = actual / projection</span>
        </span>
        <ExportCsvButton
          filename="diwali_projection"
          title="Every day, including the days still ahead"
          getRows={() => [
            ['Date', 'Day', 'Week Flag', 'Sale %', 'Company Projection', 'Company Actual', 'Achievement %', 'Attributed Revenue', 'Attributed %', '3 min Revenue', '3 min %'],
            ...days.map((d, i) => {
              const played = d.actual > 0;
              const a = played ? ach(d.actual, d.projection) : null;
              return [d.date, d.dow, d.weekFlag, d.salePct === null ? '' : Math.round(d.salePct * 100), Math.round(d.projection), played ? Math.round(d.actual) : '', a === null ? '' : Number(a.toFixed(1)), played ? Math.round(d.attributed) : '', attrShare[i] === null ? '' : Number(attrShare[i]!.toFixed(1)), played ? Math.round(d.threeMin) : '', threeShare[i] === null ? '' : Number(threeShare[i]!.toFixed(1))];
            }),
          ]}
        />
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        {tiles.map((x) => (
          <div key={x.label} className={`rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 ${x.cls || ''}`}>
            <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-tight">{x.label}</div>
            <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{x.value}</div>
            {x.sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{x.sub}</div>}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto" data-scroll-box="true">
        <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: '900px' }}>
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr>
              <th className="py-2 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-left w-28">Date</th>
              <th className={thWrap}>Week flag</th>
              <th className={thWrap}>Sale %</th>
              <th className={thWrap}>Company projection</th>
              <th className={thWrap}>Company actual</th>
              <th className={thWrap}>Achievement</th>
              <th className={thWrap}>Attributed revenue</th>
              <th className={thWrap}>Attributed %</th>
              <th className={thWrap}>3 min revenue</th>
              <th className={thWrap}>3 min %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {days.map((d, i) => {
              const big = d.salePct !== null && Math.round(d.salePct * 100) === 45;
              const played = d.actual > 0;
              const a = played ? ach(d.actual, d.projection) : null;
              // The toggle sits right after the last day with data, before the rows still ahead
              const toggle =
                i === firstAhead ? (
                  <tr key="ahead-toggle">
                    <td colSpan={10} className="p-0">
                      <button
                        onClick={() => setShowAhead((v) => !v)}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        {showAhead ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {showAhead ? 'Hide' : 'Show'} {aheadCount} upcoming day(s) without data
                      </button>
                    </td>
                  </tr>
                ) : null;
              if (!played && !showAhead) return toggle;
              return (
                <React.Fragment key={d.date}>
                {toggle}
                <tr className={`${played ? '' : 'text-slate-400'} ${big ? 'bg-indigo-50 dark:bg-indigo-950/30 shadow-[inset_3px_0_0_0_#4f46e5]' : ''}`}>
                  <td className="py-1.5 px-2 text-[11px] font-semibold whitespace-nowrap text-slate-900 dark:text-white">
                    {fmtDay(d.date, false)} <span className="font-normal text-slate-500">{d.dow}</span>
                  </td>
                  <td className={td}>{d.weekFlag}</td>
                  <td className={td}>
                    {d.salePct === null ? (
                      '-'
                    ) : big ? (
                      <span className="inline-block px-1.5 py-0.5 rounded-md bg-indigo-600 text-white font-bold">{Math.round(d.salePct * 100)}%</span>
                    ) : (
                      `${Math.round(d.salePct * 100)}%`
                    )}
                  </td>
                  <td className={td}>{money(d.projection)}</td>
                  <td className={`${td} font-bold`}>{played ? money(d.actual) : '-'}</td>
                  <td className={`${td} ${achClass(a)}`}>{pctText(a)}</td>
                  <td className={td}>{played ? money(d.attributed) : '-'}</td>
                  <td className={`${td} font-semibold ${attrRag[i] ? ragClass[attrRag[i]!] : ''}`}>{played ? pctText(attrShare[i]) : '-'}</td>
                  <td className={td}>{played ? money(d.threeMin) : '-'}</td>
                  <td className={`${td} font-semibold ${threeRag[i] ? ragClass[threeRag[i]!] : ''}`}>{played ? pctText(threeShare[i]) : '-'}</td>
                </tr>
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-800/60 font-bold">
            <tr>
              <td className="py-1.5 px-2 text-[11px] text-slate-900 dark:text-white">Played days</td>
              <td className={td} />
              <td className={td} />
              <td className={td}>{money(t.projectionToDate)}</td>
              <td className={td}>{money(t.actual)}</td>
              <td className={`${td} ${achClass(achieved)}`}>{pctText(achieved)}</td>
              <td className={td}>{money(t.attributed)}</td>
              <td className={td}>{pctText(ach(t.attributed, t.actual))}</td>
              <td className={td}>{money(t.threeMin)}</td>
              <td className={td}>{pctText(ach(t.threeMin, t.actual))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
