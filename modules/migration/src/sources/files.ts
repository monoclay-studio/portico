/**
 * Reading an uploaded file pack: CSV files and/or XLSX workbooks → detected tables. The card-number scan (kernel
 * `findPan`) runs on every cell, header, sheet name, workbook string and file name BEFORE anything is returned for
 * storage or preview (MG-02).
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
import { findCardNumbers, hasCardNumber } from '../domain/sensitive';
import { isZip, readWorkbook } from '../domain/xlsx';
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

/** Where a card number was found — a position, never the value. */
export interface CardFinding {
  file: string;
  where: 'cell' | 'header' | 'sheet name' | 'workbook text' | 'file name';
  /** 1-based data row (cells only). */
  row?: number;
  column?: string;
}

function describeFinding(f: CardFinding): string {
  if (f.where === 'cell') return `${f.file}, row ${f.row}, column "${f.column}"`;
  if (f.where === 'header') return `${f.file}, header row, ${f.column}`;
  if (f.where === 'workbook text') return `${f.file}, a text stored in the workbook (shared strings)`;
  return `${f.file}, the ${f.where}`;
}

export class CardDataInFileError extends BusinessRuleError {
  constructor(findings: CardFinding[]) {
    super(
      'card_data_in_file',
      `The upload contains what looks like a payment card number (${findings
        .slice(0, 5)
        .map(describeFinding)
        .join(
          '; ',
        )}). Nothing from it was stored. Card numbers never travel through files: delete them from the export (and from the computer that holds it) and upload it again. Guarantees are re-collected from guests instead. If the value is not a card number (for example a long reference, or several numbers written next to each other), put the numbers in separate columns or separate them with words, then upload again.`,
      { findings: findings.slice(0, 20) },
    );
  }
}

interface ParsedFile {
  name: string;
  table: Table;
  spreadsheet: boolean;
}

function tablesOf(file: UploadedFile, cards: CardFinding[]): ParsedFile[] {
  const base64 = file.encoding === 'base64' || /\.xlsx$/i.test(file.name);
  if (base64) {
    const buf = Buffer.from(file.content, 'base64');
    if (!isZip(buf))
      throw new ValidationError('unreadable_spreadsheet', `${file.name} is not an .xlsx workbook.`);
    const wb = readWorkbook(buf);
    const fileLabel = hasCardNumber(file.name) ? 'a workbook' : file.name;
    for (const n of wb.sheetNames) if (hasCardNumber(n)) cards.push({ file: fileLabel, where: 'sheet name' });
    if (wb.sharedStrings.some(hasCardNumber)) cards.push({ file: fileLabel, where: 'workbook text' });
    return [...wb.sheets].map(([sheet, table]) => ({
      name: `${fileLabel}#${hasCardNumber(sheet) ? 'sheet' : sheet}`,
      table,
      spreadsheet: true,
    }));
  }
  return [
    {
      name: hasCardNumber(file.name) ? 'a file' : file.name,
      table: parseCsv(file.content),
      spreadsheet: false,
    },
  ];
}

/** Parse, scan and detect. Throws `card_data_in_file` (nothing returned) when any cell holds a card number. */
export function readPack(
  files: readonly UploadedFile[],
  adapter: SourceAdapter,
): { tables: PackTable[]; review: TableReview[] } {
  if (files.length === 0) throw new ValidationError('no_files', 'Upload at least one file.');
  const cards: CardFinding[] = [];
  for (const f of files)
    if (hasCardNumber(f.name)) cards.push({ file: 'an uploaded file', where: 'file name' });
  const parsed = files.flatMap((f) => tablesOf(f, cards).map((t) => ({ ...t, file: f })));
  for (const p of parsed)
    for (const c of findCardNumbers(p.table.headers, p.table.rows))
      cards.push(
        c.row === 0
          ? { file: p.name, where: 'header', column: c.column }
          : { file: p.name, where: 'cell', row: c.row, column: c.column },
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
