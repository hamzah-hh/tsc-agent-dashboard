import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;
export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

export interface SortState<T> {
  /** The rows in the chosen order (the input array is never changed). */
  sorted: T[];
  sortKey: string | null;
  dir: SortDir;
  /** Click on a column: first click sorts it (numbers high to low, text A to Z), second flips, third clears. */
  toggle: (key: string) => void;
}

const isBlank = (v: SortValue) => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Click-to-sort for a table. `accessors` maps a column key to the value to sort by; blank values always
 * go last, whichever way the column is sorted. With no column chosen the rows stay in their input order.
 */
export function useSort<T>(
  rows: T[],
  accessors: SortAccessors<T>,
  initial?: { key: string; dir?: SortDir }
): SortState<T> {
  const [sortKey, setSortKey] = useState<string | null>(initial?.key ?? null);
  const [dir, setDir] = useState<SortDir>(initial?.dir ?? 'desc');

  const sorted = useMemo(() => {
    const get = sortKey ? accessors[sortKey] : undefined;
    if (!get) return rows;
    const sign = dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i, v: get(row) }))
      .sort((x, y) => {
        const bx = isBlank(x.v);
        const by = isBlank(y.v);
        if (bx || by) return bx === by ? x.i - y.i : bx ? 1 : -1;
        return sign * compare(x.v, y.v) || x.i - y.i;
      })
      .map((x) => x.row);
    // accessors are defined inline by the caller; the rows and the chosen column decide the order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  const toggle = useCallback(
    (key: string) => {
      // text columns start A to Z, number columns start high to low
      const sample = accessors[key] ? rows.map((r) => accessors[key](r)).find((v) => !isBlank(v)) : undefined;
      const first: SortDir = typeof sample === 'string' ? 'asc' : 'desc';
      if (sortKey !== key) {
        setSortKey(key);
        setDir(first);
      } else if (dir === first) {
        setDir(first === 'asc' ? 'desc' : 'asc');
      } else {
        setSortKey(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sortKey, dir]
  );

  return { sorted, sortKey, dir, toggle };
}
