/** RFC 4180 CSV of the rows the person selected (what they can already see), downloaded in the browser. */
export function toCsv<Row>(
  rows: readonly Row[],
  columns: ReadonlyArray<[string, (r: Row) => string]>,
): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [
    columns.map(([h]) => cell(h)).join(','),
    ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(',')),
  ].join('\r\n');
}

export function downloadCsv<Row>(
  filename: string,
  rows: readonly Row[],
  columns: ReadonlyArray<[string, (r: Row) => string]>,
): void {
  const blob = new Blob([`﻿${toCsv(rows, columns)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
