import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { ChevronDown, ChevronUp, Copy, Download, Lock, Plus, RefreshCw, X } from 'lucide-react';
import { formatNumberINR } from '../shared/incentive';
import {
  COHORT_CATEGORIES,
  CohortPeriod,
  CohortRow,
  CohortTableRow,
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

export function CohortReportView({ getIdToken }: CohortReportViewProps) {
  const [rows, setRows] = useState<CohortRow[]>([]);
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

  const downloadCsv = () => {
    const head = ['Period', 'From', 'To', 'Talk Time Cohort', ...COHORT_CATEGORIES.flatMap((c) => [`${c.label} Orders`, `${c.label} Revenue`]), 'Total Orders', 'Total Revenue', 'AOV'];
    const lines = [head.join(',')];
    periods.forEach((p, i) => {
      for (const r of tables[i]) {
        lines.push(
          [i === 0 ? 'Base' : periodTag(base, p) || `Comparison ${i}`, p.from, p.to, `"${r.cohort}"`, ...COHORT_CATEGORIES.flatMap((c) => [r.byCategory[c.key].orders, Math.round(r.byCategory[c.key].revenue)]), r.orders, Math.round(r.revenue), r.aov === null ? '' : Math.round(r.aov)].join(',')
        );
      }
    });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `talk_time_cohort_${base.from}_to_${base.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // All tables as one PNG on the clipboard; where the browser cannot copy images, the PNG is downloaded
  const copyPng = async () => {
    if (!tablesRef.current) return;
    setCopyState('busy');
    try {
      const dark = document.documentElement.classList.contains('dark');
      const node = tablesRef.current;
      // While the picture is taken, the scroll boxes show their full width (no scrollbars in the image)
      const boxes = Array.from(node.querySelectorAll<HTMLElement>('[data-scroll-box]'));
      const width = Math.max(node.scrollWidth, ...Array.from(node.querySelectorAll('table')).map((t) => t.scrollWidth + 8));
      // html-to-image copies each element's on-screen size, so the container itself is widened for the
      // moment of the capture (a brief flash on a small screen), then put back
      boxes.forEach((b) => (b.style.overflow = 'visible'));
      const oldWidth = node.style.width;
      node.style.width = `${width}px`;
      let blob: Blob | null = null;
      try {
        blob = await toBlob(node, {
          pixelRatio: 2,
          width,
          style: { width: `${width}px` },
          backgroundColor: dark ? '#020617' : '#f8fafc',
        });
      } finally {
        boxes.forEach((b) => (b.style.overflow = ''));
        node.style.width = oldWidth;
      }
      if (!blob) throw new Error('The image could not be made.');
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
      </div>
    </div>
  );
}

const thGroup = 'pt-2 pb-1 px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 text-center whitespace-nowrap border-b border-slate-200 dark:border-slate-700';
const thSub = 'pb-2 pt-1 px-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 text-right whitespace-nowrap';
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
              {COHORT_CATEGORIES.map((c) => (
                <React.Fragment key={c.key}>
                  <th className={`${thSub} ${sep}`}>Orders</th>
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
