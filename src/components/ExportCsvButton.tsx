import React from 'react';
import { Download } from 'lucide-react';
import { CsvCell, downloadCsv } from '../utils/csv';

interface ExportCsvButtonProps {
  /** File name; ".csv" is added. */
  filename: string;
  /** The rows to export, header row first. Called when the button is pressed, so it always matches what is on screen. */
  getRows: () => CsvCell[][];
  label?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/** The one "Export CSV" button used next to every table. */
export function ExportCsvButton({ filename, getRows, label = 'Export CSV', disabled, title, className }: ExportCsvButtonProps) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, getRows())}
      disabled={disabled}
      title={title || 'Download this table as a CSV file'}
      className={
        className ||
        'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 shrink-0'
      }
    >
      <Download className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
