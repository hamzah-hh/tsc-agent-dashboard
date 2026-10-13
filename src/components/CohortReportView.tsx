import React, { useEffect, useMemo, useState } from 'react';
import { Download, Lock, RefreshCw } from 'lucide-react';
import { formatNumberINR } from '../shared/incentive';
import { COHORT_CATEGORIES, CohortRow, CohortTableRow, cohortTable, growth } from '../shared/cohortReport';

interface CohortReportViewProps {
  getIdToken: () => Promise<string>;
}

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs';
const th = 'py-2 px-2.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-300 font-bold text-right whitespace-nowrap';
const td = 'py-2 px-2.5 text-right font-mono whitespace-nowrap';
const select = 'border border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-white rounded-lg px-2 py-1.5 text-xs';

const money = (n: number | null) => (n === null ? '-' : formatNumberINR(Math.round(n)));
const pct = (g: number | null) => (g === null ? '-' : `${(g * 100).toFixed(1)}%`);
const growthClass = (g: number | null) =>
  g === null ? 'text-slate-400' : g < 0 ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40' : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40';

/** 'YYYY-MM' + day -> 'DD-MM-YYYY', as in the original report title. */
const tillText = (month: string, day: number) => `${String(day).padStart(2, '0')}-${month.slice(5, 7)}-${month.slice(0, 4)}`;
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function CohortReportView({ getIdToken }: CohortReportViewProps) {
  const [rows, setRows] = useState<CohortRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [tillDay, setTillDay] = useState(0);
  const [compare, setCompare] = useState<[string, string]>(['', '']);

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

  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort().reverse(), [rows]);
  const maxDay = (m: string) => rows.reduce((max, r) => (r.month === m && r.day > max ? r.day : max), 0);

  // Defaults: the newest month, up to its newest day, against the two months before it
  useEffect(() => {
    if (months.length && !month) {
      setMonth(months[0]);
      setTillDay(maxDay(months[0]));
      setCompare([months[1] || '', months[2] || '']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months]);

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
  if (!rows.length || !month) {
    return <div className={`${card} p-10 text-center text-xs text-slate-500`}>No data yet. It arrives with the next sync of the Anirban_Ref tab.</div>;
  }

  const comparisons = compare.filter((m) => m && m !== month);
  // The same day numbers in every month (a shorter month stops at its last day)
  const tableFor = (m: string) => cohortTable(rows, m, Math.min(tillDay, maxDay(m) || tillDay));
  const current = tableFor(month);
  const others = comparisons.map((m) => ({ month: m, table: tableFor(m) }));

  const downloadCsv = () => {
    const head = ['Month', 'Till Day', 'Talk Time Cohort', ...COHORT_CATEGORIES.flatMap((c) => [`${c.label} Orders`, `${c.label} Revenue`]), 'Total Orders', 'Total Revenue', 'AOV'];
    const lines = [head.join(',')];
    for (const { month: m, table } of [{ month, table: current }, ...others]) {
      for (const r of table) {
        lines.push(
          [m, Math.min(tillDay, maxDay(m)), `"${r.cohort}"`, ...COHORT_CATEGORIES.flatMap((c) => [r.byCategory[c.key].orders, Math.round(r.byCategory[c.key].revenue)]), r.orders, Math.round(r.revenue), r.aov === null ? '' : Math.round(r.aov)].join(',')
        );
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `talk_time_cohort_${month}_till_${tillDay}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4`}>
        <div>
          <h2 className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2">
            Talk Time Cohort Report <Lock className="w-4 h-4 text-slate-400" />
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Private report. Cohorts are cumulative (each row counts that talk time and longer). Updated {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : '-'}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-slate-500">Month</label>
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setTillDay(maxDay(e.target.value));
            }}
            className={select}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <label className="text-slate-500">Till day</label>
          <select value={tillDay} onChange={(e) => setTillDay(Number(e.target.value))} className={select}>
            {Array.from({ length: Math.max(31, maxDay(month)) }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="text-slate-500">Compare with</label>
          {[0, 1].map((i) => (
            <select
              key={i}
              value={compare[i]}
              onChange={(e) => setCompare((c) => (i === 0 ? [e.target.value, c[1]] : [c[0], e.target.value]))}
              className={select}
            >
              <option value="">(none)</option>
              {months
                .filter((m) => m !== month)
                .map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
            </select>
          ))}
          <button onClick={downloadCsv} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Download CSV">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={load} className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300" title="Reload">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <CohortTable title={`${monthName(month)} - till ${tillText(month, tillDay)}`} table={current} comparisons={others} />
      {others.map((o) => (
        <CohortTable key={o.month} title={`${monthName(o.month)} - till ${tillText(o.month, Math.min(tillDay, maxDay(o.month)))}`} table={o.table} comparisons={[]} />
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
  comparisons: Array<{ month: string; table: CohortTableRow[] }>;
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
              {comparisons.map((c) => (
                <th key={c.month} colSpan={3} className={`${th} text-center border-l-2 border-slate-300 dark:border-slate-600`}>
                  vs {monthName(c.month)}
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
                <td className="py-2 px-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{r.cohort}</td>
                {COHORT_CATEGORIES.map((c) => (
                  <React.Fragment key={c.key}>
                    <td className={td}>{formatNumberINR(r.byCategory[c.key].orders)}</td>
                    <td className={td}>{money(r.byCategory[c.key].revenue)}</td>
                  </React.Fragment>
                ))}
                <td className={`${td} font-bold text-slate-900 dark:text-white`}>{formatNumberINR(r.orders)}</td>
                <td className={`${td} font-bold text-slate-900 dark:text-white`}>{money(r.revenue)}</td>
                <td className={td}>{money(r.aov)}</td>
                {comparisons.map((c) => {
                  const o = c.table.find((x) => x.cohort === r.cohort);
                  const g = [growth(r.orders, o?.orders ?? null), growth(r.revenue, o?.revenue ?? null), growth(r.aov, o?.aov ?? null)];
                  return g.map((v, i) => (
                    <td key={`${c.month}-${i}`} className={`${td} ${growthClass(v)} ${i === 0 ? 'border-l-2 border-slate-300 dark:border-slate-600' : ''}`}>
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
