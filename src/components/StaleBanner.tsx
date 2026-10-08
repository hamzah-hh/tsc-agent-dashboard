import React from 'react';
import { AlertCircle } from 'lucide-react';

/** Whole days between a YYYY-MM-DD date and today in IST (positive = the date is in the past). */
export function daysOld(dateStr: string | undefined | null, nowMs: number = Date.now()): number {
  if (!dateStr) return 0;
  const todayIST = new Date(nowMs + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
  const a = new Date(dateStr.slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(todayIST + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

interface StaleBannerProps {
  /** The latest data date (or the date of the last update). */
  date: string | undefined | null;
  label?: string;
}

/**
 * The yellow banner of the Design Document ("Data last updated on <date>") when the latest data is more
 * than 2 days old. It is shown on every screen that shows data.
 */
export function StaleBanner({ date, label = 'Data last updated on' }: StaleBannerProps) {
  if (!date || daysOld(date) <= 2) return null;
  return (
    <div
      role="status"
      className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-300 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-3 shadow-xs"
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>
          {label} {date.slice(0, 10)}.
        </span>
      </div>
      <span className="text-[11px] text-amber-700 dark:text-amber-400 font-mono hidden sm:inline">Sync pending from Ops sheet</span>
    </div>
  );
}
