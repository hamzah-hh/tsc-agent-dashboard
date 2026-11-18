import React, { useMemo } from 'react';
import { AgentRecord } from '../shared/types';
import { AGENT_BREAK_COLUMNS, breakAverages, hms, overLimit } from '../shared/teamOps';
import { useAgentBreaks } from '../utils/useAgentBreaks';
import { AgentBreaksSection } from './AgentBreaksSection';
import { CARD, Tile, TILE_GRID, rangeLabel } from './MetricTile';
import { DateRangeFilter, inDateRange, useDateRange } from './DateRangeFilter';

interface BreaksAdherenceTabProps {
  agentRecord: AgentRecord | null;
  getIdToken: () => Promise<string>;
}

// Short names for the tiles (the table keeps the full column names)
export const BREAK_TILE_LABEL: Record<string, string> = {
  bio: 'Bio / Misc Break',
  first: 'First Break',
  lunch: 'Lunch',
  last: 'Last Break',
  total: 'Total Daily Break',
  acw: 'After Call Work',
  idle: 'Idle Time',
  idleAcw: 'Idle Time + ACW',
  staffed: 'Staffed Duration',
  idleAcwPct: 'Idle + ACW %',
};

/** Adherence: the share of worked days that stayed inside every break limit. */
export const adherencePct = (days: number, daysOver: number): number | null => (days > 0 ? ((days - daysOver) / days) * 100 : null);

/** Breaks and Adherence: staffed duration, every break, idle time and ACW, and how often the limits were kept. */
export function BreaksAdherenceTab({ agentRecord, getIdToken }: BreaksAdherenceTabProps) {
  const name = agentRecord?.name || 'agent';
  const { breaks: allBreaks, error } = useAgentBreaks(getIdToken, agentRecord?.officialEmail || '');

  const dates = (allBreaks || []).map((b) => b.date);
  const firstDay = dates.reduce((m, d) => (!m || d < m ? d : m), '');
  const lastDay = dates.reduce((m, d) => (d > m ? d : m), '');
  const { from, to, set: setRange } = useDateRange(firstDay, lastDay);
  const breakDays = useMemo(() => (allBreaks ? allBreaks.filter((b) => inDateRange(b.date, from, to)) : null), [allBreaks, from, to]);

  const brk = breakAverages(breakDays || []);
  const adherence = adherencePct(brk.days, brk.daysOver);

  const summary =
    breakDays && breakDays.length > 0 ? (
      <div className={TILE_GRID}>
        <Tile
          label="Adherence"
          value={adherence === null ? '-' : `${adherence.toFixed(1)}%`}
          sub={`${brk.days - brk.daysOver} of ${brk.days} day${brk.days === 1 ? '' : 's'} within every limit`}
          red={adherence !== null && adherence < 50}
        />
        <Tile label="Days over a limit" value={String(brk.daysOver)} sub={`of ${brk.days} day${brk.days === 1 ? '' : 's'}`} red={brk.daysOver > 0} />
        {AGENT_BREAK_COLUMNS.map((c) => {
          const v = brk[c.key];
          const limit = c.limitSec !== undefined ? `Limit ${hms(c.limitSec)}` : c.limitPct !== undefined ? `Limit ${c.limitPct.toFixed(1)}%` : 'Daily average';
          return (
            <Tile
              key={c.key}
              label={`Avg ${BREAK_TILE_LABEL[c.key]}`}
              value={v === null ? '-' : c.key === 'idleAcwPct' ? `${v.toFixed(1)}%` : hms(v)}
              sub={limit}
              red={overLimit(c.key, v)}
            />
          );
        })}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div className={`${CARD} !p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-bold text-slate-950 dark:text-fg">Breaks &amp; Adherence</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Staffed duration, breaks, idle time and ACW for {rangeLabel(from, to)}. Adherence is the share of worked days with no break limit crossed.
          </p>
        </div>
        <DateRangeFilter from={from} to={to} min={firstDay} max={lastDay} onChange={setRange} />
      </div>
      <AgentBreaksSection days={breakDays} error={error} agentName={name} summary={summary} />
    </div>
  );
}
