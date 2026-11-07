/**
 * Reading an uploaded file pack: CSV files and/or XLSX workbooks → detected tables. The card-number scan runs on
 * every cell of every table BEFORE anything is returned for storage (MG-02).
 */
import { BusinessRuleError, ValidationError } from '@portico/kernel';
import {
  AUTO_ACCEPT_CONFIDENCE,
  detectTable,
  kindFromName,
  mapColumns,
  type TableKind,
} from '../domain/columns';
import { parseCsv, type Table } from '../domain/csv';
import type { PackTable } from '../domain/pack';
import { type CellFinding, findCardNumbers } from '../domain/sensitive';
import { isZip, readXlsx } from '../domain/xlsx';
import type { SourceAdapter } from './adapters';

export interface UploadedFile {
  name: string;
  /** CSV text, or base64 of an .xlsx workbook. */
  content: string;
  encoding?: 'text' | 'base64';
  /** Declared table kind (skips detection for this file). */
  kind?: TableKind;
  /** Confirmed header → field corrections from the person reviewing the detection. */
  columnOverrides?: Record<string, string>;
}

export interface TableReview {
  name: string;
  kind: TableKind;
  confidence: number;
  missingRequired: string[];
  unmappedHeaders: string[];
  columns: Array<{ header: string; field: string; confidence: number }>;
  rows: number;
  needsConfirmation: boolean;
}

export class CardDataInFileError extends BusinessRuleError {
  constructor(findings: Array<CellFinding & { file: string }>) {
    super(
      'card_data_in_file',
      `The upload contains what looks like a payment card number (${findings
        .slice(0, 5)
        .map((f) => `${f.file}, row ${f.row}, column "${f.column}"`)
        .join(
          '; ',
        )}). Nothing from it was stored. Card numbers never travel through files: delete them from the export (and from the computer that holds it) and upload it again. Guarantees are re-collected from guests instead.`,
      { findings: findings.slice(0, 20) },
    );
  }
}

function tablesOf(file: UploadedFile): Array<{ name: string; table: Table; spreadsheet: boolean }> {
  const base64 = file.encoding === 'base64' || /\.xlsx$/i.test(file.name);
  if (base64) {
    const buf = Buffer.from(file.content, 'base64');
    if (!isZip(buf))
      throw new ValidationError('unreadable_spreadsheet', `${file.name} is not an .xlsx workbook.`);
    return [...readXlsx(buf)].map(([sheet, table]) => ({
      name: `${file.name}#${sheet}`,
      table,
      spreadsheet: true,
    }));
  }
  return [{ name: file.name, table: parseCsv(file.content), spreadsheet: false }];
}

/** Parse, scan and detect. Throws `card_data_in_file` (nothing returned) when any cell holds a card number. */
export function readPack(
  files: readonly UploadedFile[],
  adapter: SourceAdapter,
): { tables: PackTable[]; review: TableReview[] } {
  if (files.length === 0) throw new ValidationError('no_files', 'Upload at least one file.');
  const parsed = files.flatMap((f) => tablesOf(f).map((t) => ({ ...t, file: f })));
  const cards = parsed.flatMap((p) =>
    findCardNumbers(p.table.headers, p.table.rows).map((c) => ({ ...c, file: p.name })),
  );
  if (cards.length > 0) throw new CardDataInFileError(cards);
  const tables: PackTable[] = [];
  const review: TableReview[] = [];
  for (const p of parsed) {
    const sheetName = p.name.includes('#') ? (p.name.split('#')[1] as string) : p.name;
    const hint = p.file.kind ?? kindFromName(sheetName) ?? undefined;
    const detected = hint ? mapColumns(hint, p.table.headers) : detectTable(p.table.headers);
    const overrides = { ...(adapter.headerHints[detected.kind] ?? {}), ...(p.file.columnOverrides ?? {}) };
    const d = Object.keys(overrides).length
      ? mapColumns(detected.kind, p.table.headers, overrides)
      : detected;
    const declared = !!p.file.kind || Object.keys(p.file.columnOverrides ?? {}).length > 0;
    tables.push({
      name: p.name,
      kind: d.kind,
      table: p.table,
      columns: d.columns,
      spreadsheet: p.spreadsheet,
    });
    review.push({
      name: p.name,
      kind: d.kind,
      confidence: d.confidence,
      missingRequired: d.missingRequired,
      unmappedHeaders: d.unmappedHeaders,
      columns: d.columns.map((c) => ({ header: c.header, field: c.field, confidence: c.confidence })),
      rows: p.table.rows.length,
      needsConfirmation: d.missingRequired.length > 0 || (!declared && d.confidence < AUTO_ACCEPT_CONFIDENCE),
    });
  }
  return { tables, review };
}
