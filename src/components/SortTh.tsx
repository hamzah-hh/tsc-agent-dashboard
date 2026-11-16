import React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { SortState } from '../utils/useSort';

interface SortThProps {
  sort: Pick<SortState<unknown>, 'sortKey' | 'dir' | 'toggle'>;
  /** The column key given to useSort's accessors. */
  k: string;
  className?: string;
  /** Right-align the label with the numbers under it. */
  right?: boolean;
  title?: string;
  rowSpan?: number;
  colSpan?: number;
  children: React.ReactNode;
}

/** A table header cell that sorts its column on click and shows the current direction. */
export function SortTh({ sort, k, className = '', right, title, rowSpan, colSpan, children }: SortThProps) {
  const active = sort.sortKey === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={className}
      title={title}
      rowSpan={rowSpan}
      colSpan={colSpan}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={`inline-flex items-center gap-1 [font:inherit] [text-transform:inherit] [letter-spacing:inherit] hover:text-accent transition-colors ${right ? 'flex-row-reverse' : ''} ${
          active ? 'text-accent' : ''
        }`}
      >
        <span>{children}</span>
        <Icon className={`w-3 h-3 shrink-0 ${active ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </th>
  );
}
