import React from 'react';

/** The card every agent-view section sits in. */
export const CARD = 'bg-white/95 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs';

/** A responsive grid for a row of tiles. */
export const TILE_GRID = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-5';

/** "14 Nov" for a YYYY-MM-DD day. */
export const monthDay = (d: string) =>
  d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

/** "1 Nov to 14 Nov", or "all days" while no range is set. */
export const rangeLabel = (from: string, to: string) => (from && to ? `${monthDay(from)} to ${monthDay(to)}` : 'all days');

/** One headline number, red when it misses its target or limit. */
export function Tile({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        red
          ? 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10'
          : 'border-slate-200 bg-slate-50/70 dark:border-line dark:bg-raised'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide font-bold text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
      <p className={`mt-1 text-2xl font-black font-mono tabular-nums ${red ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-fg'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

/** A titled group of tiles. */
export function TileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 font-mono mb-2">{title}</h3>
      <div className={TILE_GRID}>{children}</div>
    </section>
  );
}
