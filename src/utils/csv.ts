/**
 * Simple CSV export: one header row, then the rows, as the tables show them (filters and sort applied).
 * Every export in the app goes through here, so they all open the same way in Excel and Google Sheets.
 */
export type CsvCell = string | number | boolean | null | undefined;

/** A cell as CSV text: quoted when it holds a comma, quote or line break. Text that would run as a formula is kept as text. */
function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  if (typeof v === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Today in IST as YYYY-MM-DD, for file names. */
export function csvStamp(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

/** A file name part with nothing but letters, digits, dashes and underscores. */
export function csvName(...parts: Array<string | number | null | undefined>): string {
  return (
    parts
      .filter((p) => p !== null && p !== undefined && String(p) !== '')
      .map((p) => String(p).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''))
      .filter(Boolean)
      .join('_') || 'export'
  );
}

/** Downloads the rows as <filename>.csv (a byte order mark first, so Excel reads accents correctly). */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
