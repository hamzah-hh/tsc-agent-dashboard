import React from 'react';
import { CalendarDays } from 'lucide-react';

const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** True when a YYYY-MM-DD date is inside the range (an empty end is open). */
export function inDateRange(date: string | undefined, from: string, to: string): boolean {
  if (!date) return !from && !to;
  const d = date.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
}

interface DateRangeFilterProps {
  from: string;
  to: string;
  /** The first and last day that have data: the bounds of the pickers and of the quick buttons. */
  min: string;
  max: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}

const input =
  'border border-slate-300 dark:border-line bg-white dark:bg-panel text-slate-800 dark:text-fg rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:border-accent';

/** From / to data-date pickers with quick ranges, for tables that list one row per day. */
export function DateRangeFilter({ from, to, min, max, onChange, className = '' }: DateRangeFilterProps) {
  const last7 = max ? (addDays(max, -6) < min ? min : addDays(max, -6)) : '';
  const quick: Array<[string, string, string]> = [
    ['All dates', min, max],
    ['Last 7 days', last7, max],
    ['Latest day', max, max],
  ];
  const isAll = (!from && !to) || (from === min && to === max);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <CalendarDays className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" aria-hidden />
      <span className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400">Data date</span>
      {quick.map(([label, f, t]) => {
        const active = label === 'All dates' ? isAll : from === f && to === t;
        return (
          <button
            key={label}
            type="button"
            disabled={!max}
            onClick={() => onChange(f, t)}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition ${
              active
                ? 'bg-brand-900 text-white border-brand-900 dark:bg-accent dark:text-on-accent dark:border-accent'
                : 'border-slate-300 dark:border-line text-slate-700 dark:text-fg-2 hover:bg-slate-50 dark:hover:bg-hover'
            }`}
          >
            {label}
          </button>
        );
      })}
      <input type="date" value={from} min={min || undefined} max={to || max || undefined} onChange={(e) => onChange(e.target.value, to)} className={input} aria-label="From data date" />
      <span className="text-slate-400 text-[11px]">to</span>
      <input type="date" value={to} min={from || min || undefined} max={max || undefined} onChange={(e) => onChange(from, e.target.value)} className={input} aria-label="To data date" />
    </div>
  );
}
