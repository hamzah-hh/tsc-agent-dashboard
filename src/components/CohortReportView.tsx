import React, { useEffect, useMemo, useState } from 'react';
import { Download, Lock, Plus, RefreshCw, X } from 'lucide-react';
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
// Headers wrap and digits are proportional (tabular-nums) so a base table with comparisons fits the page
const th = 'py-2 px-1.5 text-[10px] uppercase tracking-wide leading-tight text-slate-600 dark:text-slate-300 font-bold text-right align-bottom';
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

  return (
    <div className="space-y-6">
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

      <CohortTable title={`Base: ${periodText(base)}`} table={tables[0]} comparisons={comparisons.map((c) => ({ label: c.tag ? `${c.tag} (${periodText(c.period)})` : periodText(c.period), table: c.table }))} />
      {comparisons.map((c, i) => (
        <CohortTable key={i} title={`Comparison ${i + 1}: ${periodText(c.period)}${c.tag ? ` · ${c.tag}` : ''}`} table={c.table} comparisons={[]} />
      ))}
    </div>
  );
}

function CohortTable({
  title,
  table,
  comparisons,
}: {
  title: string;
  table: CohortTableRow[];
  comparisons: Array<{ label: string; table: CohortTableRow[] }>;
}) {
  return (
    <section className={`${card} overflow-hidden`}>
      <h3 className="px-5 py-3 text-sm font-bold text-slate-950 dark:text-white border-b border-slate-200 dark:border-slate-800">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60">
              <th className={`${th} text-left`}>Talk Time Cohort</th>
              {COHORT_CATEGORIES.map((c) => (
                <React.Fragment key={c.key}>
                  <th className={th}>{c.label} Orders</th>
                  <th className={th}>{c.label} Revenue</th>
                </React.Fragment>
              ))}
              <th className={th}>Total Orders</th>
              <th className={th}>Total Revenue</th>
              <th className={th}>AOV</th>
              {comparisons.map((c, i) => (
                <th key={i} colSpan={3} className={`${th} text-center border-l-2 border-slate-300 dark:border-slate-600`}>
                  vs {c.label}
                  <div className="flex justify-around font-normal normal-case tracking-normal text-slate-500 mt-0.5">
                    <span>Orders</span>
                    <span>Revenue</span>
                    <span>AOV</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.map((r) => (
              <tr key={r.cohort} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-1.5 px-2 text-[11px] font-semibold text-slate-900 dark:text-white whitespace-nowrap">{r.cohort}</td>
                {COHORT_CATEGORIES.map((c) => (
                  <React.Fragment key={c.key}>
                    <td className={td}>{formatNumberINR(r.byCategory[c.key].orders)}</td>
                    <td className={td}>{money(r.byCategory[c.key].revenue)}</td>
                  </React.Fragment>
                ))}
                <td className={`${td} font-bold text-slate-900 dark:text-white`}>{formatNumberINR(r.orders)}</td>
                <td className={`${td} font-bold text-slate-900 dark:text-white`}>{money(r.revenue)}</td>
                <td className={td}>{money(r.aov)}</td>
                {comparisons.map((c, ci) => {
                  const o = c.table.find((x) => x.cohort === r.cohort);
                  const g = [growth(r.orders, o?.orders ?? null), growth(r.revenue, o?.revenue ?? null), growth(r.aov, o?.aov ?? null)];
                  return g.map((v, i) => (
                    <td key={`${ci}-${i}`} className={`${td} ${growthClass(v)} ${i === 0 ? 'border-l-2 border-slate-300 dark:border-slate-600' : ''}`}>
                      {pct(v)}
                    </td>
                  ));
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
