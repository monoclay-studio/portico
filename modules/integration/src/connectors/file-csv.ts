/**
 * `file.csv` — file-based import and export. Clearly labeled FILE-BASED: it is never presented as a live
 * connection (adoption brief §6: "A file export must not be presented as a live connection"). Imported data is
 * only as current as the last file; exports are marked "exported", never "synced" or "confirmed".
 *
 * Import formats (header row required, UTF-8, comma separated, RFC 4180 quoting):
 *  - reservations: reservation_id, modified_at, property_code, status, arrival, departure, room_type_code,
 *                  rate_plan_code, guest_name, adults, total_amount_minor, currency
 *  - roomStatus:   room_id, room_number, property_code, status_code, changed_at
 * `modified_at` / `changed_at` (ISO 8601 with offset) order the revisions: re-importing the same file creates
 * no duplicates; an older file imported after a newer one never overwrites newer information.
 *
 * Export format:
 *  - journals: reference, business_date, property_code, ledger_account, description, debit_minor,
 *              credit_minor, currency
 */
import { CsvError, parseCsvRecords, writeCsv } from '../domain/csv';
import { revisionOrderOf } from '../domain/inbound-ordering';
import {
  type ConnectorAdapter,
  type ConnectorDefinition,
  ConnectorError,
  type ExternalEntity,
  type InboundRecord,
} from './sdk';

export const FILE_CSV_KEY = 'file.csv';

const RESERVATION_COLUMNS = [
  'reservation_id',
  'modified_at',
  'property_code',
  'status',
  'arrival',
  'departure',
  'room_type_code',
  'rate_plan_code',
  'guest_name',
  'adults',
  'total_amount_minor',
  'currency',
] as const;
const ROOM_STATUS_COLUMNS = ['room_id', 'room_number', 'property_code', 'status_code', 'changed_at'] as const;
const JOURNAL_COLUMNS = [
  'reference',
  'business_date',
  'property_code',
  'ledger_account',
  'description',
  'debit_minor',
  'credit_minor',
  'currency',
] as const;

function requireColumns(workflow: string, headers: string[], required: readonly string[]) {
  const missing = required.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new ConnectorError(
      'invalid',
      `The ${workflow} file is missing columns: ${missing.join(', ')}. Use the template from the connector description.`,
      { missing },
    );
  }
}

function orderOf(value: string, row: number, column: string): number {
  const order = revisionOrderOf(value);
  if (order === null || !/T/.test(value)) {
    throw new ConnectorError(
      'invalid',
      `Row ${row}: ${column} "${value}" is not an ISO date-time such as 2026-11-07T09:30:00+05:00.`,
    );
  }
  return order;
}

function intOf(value: string, row: number, column: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new ConnectorError(
      'invalid',
      `Row ${row}: ${column} must be a whole number in minor units (cents), got "${value}".`,
    );
  }
  return Number(value.trim());
}

export function parseCsvFile(workflow: string, content: string, fileName: string): InboundRecord[] {
  let parsed: ReturnType<typeof parseCsvRecords>;
  try {
    parsed = parseCsvRecords(content);
  } catch (err) {
    if (err instanceof CsvError) throw new ConnectorError('invalid', `${fileName}: ${err.message}`);
    throw err;
  }
  const { headers, records } = parsed;
  if (workflow === 'reservations') {
    requireColumns(workflow, headers, RESERVATION_COLUMNS);
    return records.map((r, i) => {
      const row = i + 2;
      const order = orderOf(r.modified_at ?? '', row, 'modified_at');
      return {
        workflow,
        externalId: r.reservation_id ?? '',
        revision: r.modified_at ?? '',
        revisionOrder: order,
        occurredAt: new Date(order).toISOString(),
        propertyExternalId: r.property_code ?? null,
        payload: {
          reservationId: r.reservation_id,
          propertyCode: r.property_code,
          status: r.status,
          arrival: r.arrival,
          departure: r.departure,
          roomTypeCode: r.room_type_code,
          ratePlanCode: r.rate_plan_code,
          guestName: r.guest_name,
          adults: intOf(r.adults ?? '', row, 'adults'),
          totalMinor: intOf(r.total_amount_minor ?? '', row, 'total_amount_minor'),
          currency: r.currency,
          sourceFile: fileName,
          sourceRow: row,
        },
        summary: `Reservation ${r.reservation_id} from file ${fileName} (row ${row})`,
      };
    });
  }
  if (workflow === 'roomStatus') {
    requireColumns(workflow, headers, ROOM_STATUS_COLUMNS);
    return records.map((r, i) => {
      const row = i + 2;
      const order = orderOf(r.changed_at ?? '', row, 'changed_at');
      return {
        workflow,
        externalId: r.room_id ?? '',
        revision: r.changed_at ?? '',
        revisionOrder: order,
        occurredAt: new Date(order).toISOString(),
        propertyExternalId: r.property_code ?? null,
        payload: {
          roomId: r.room_id,
          roomNumber: r.room_number,
          propertyCode: r.property_code,
          statusCode: r.status_code,
          sourceFile: fileName,
          sourceRow: row,
        },
        summary: `Room ${r.room_number} status ${r.status_code} from file ${fileName} (row ${row})`,
      };
    });
  }
  throw new ConnectorError('invalid', `The CSV connector cannot import "${workflow}" files.`);
}

function entitiesFromRecords(records: InboundRecord[]): ExternalEntity[] {
  const out = new Map<string, ExternalEntity>();
  const add = (e: ExternalEntity) => out.set(`${e.kind}:${e.externalId}`, e);
  for (const r of records) {
    const p = r.payload;
    const prop = typeof p.propertyCode === 'string' ? p.propertyCode : null;
    if (prop)
      add({ kind: 'property', externalId: prop, label: prop, propertyExternalId: prop, attributes: {} });
    if (r.workflow === 'reservations') {
      if (typeof p.roomTypeCode === 'string' && p.roomTypeCode)
        add({
          kind: 'unitType',
          externalId: p.roomTypeCode,
          label: p.roomTypeCode,
          propertyExternalId: prop,
          attributes: {},
        });
      if (typeof p.ratePlanCode === 'string' && p.ratePlanCode)
        add({
          kind: 'ratePlan',
          externalId: p.ratePlanCode,
          label: p.ratePlanCode,
          propertyExternalId: prop,
          attributes: typeof p.currency === 'string' ? { currency: p.currency } : {},
        });
      if (typeof p.status === 'string' && p.status)
        add({
          kind: 'status',
          externalId: `bookingStatus:${p.status}`,
          code: p.status,
          label: p.status,
          statusDomain: 'bookingStatus',
          propertyExternalId: null,
          attributes: {},
        });
    }
    if (r.workflow === 'roomStatus') {
      if (typeof p.roomId === 'string' && p.roomId)
        add({
          kind: 'unit',
          externalId: p.roomId,
          code: typeof p.roomNumber === 'string' ? p.roomNumber : p.roomId,
          label: `Room ${p.roomNumber ?? p.roomId}`,
          propertyExternalId: prop,
          attributes: {},
        });
      if (typeof p.statusCode === 'string' && p.statusCode)
        add({
          kind: 'status',
          externalId: `roomStatus:${p.statusCode}`,
          code: p.statusCode,
          label: p.statusCode,
          statusDomain: 'roomStatus',
          propertyExternalId: null,
          attributes: {},
        });
    }
  }
  return [...out.values()];
}

export const fileCsvDefinition: ConnectorDefinition = {
  key: FILE_CSV_KEY,
  name: 'CSV files (import and export)',
  category: 'file',
  vendor: { name: 'Any system that reads or writes CSV files' },
  products: [{ name: 'CSV (RFC 4180)', versions: ['UTF-8, comma separated, header row'] }],
  regions: ['global'],
  accessModel: 'file',
  localConnectorRequired: false,
  localConnectorNote: null,
  credentialSchema: null,
  credentialFields: [],
  vendorSetupSteps: [
    'In the other system, export the report as CSV using the column layout shown for each workflow.',
    'Upload the file in Portico. Repeat whenever you want Portico to catch up: nothing updates between files.',
    'For exports, download the file from Portico and import it into the other system yourself.',
  ],
  prerequisites: ['Someone at the hotel who can run the export in the other system.'],
  workflows: [
    {
      workflow: 'reservations',
      label: 'Reservations (file import)',
      description: 'Import reservations from a CSV export of another system.',
      operations: ['read'],
      sync: 'file',
      status: 'supported',
      limitations: [
        'File-based: information is only as current as the last uploaded file. This is not a live connection.',
        'Cancellations are recognised only from the status column; deleted rows are not detected.',
      ],
      dataDomain: 'reservations',
      whenUnavailable:
        'Without a new file Portico keeps the last imported copy, labeled with the file name and time.',
      freshnessTargetSeconds: null,
      expectedIntervalSeconds: null,
      sequentialRevisions: false,
      mappedFields: [
        { field: 'propertyCode', kind: 'property', required: true },
        { field: 'roomTypeCode', kind: 'unitType', required: true },
        { field: 'ratePlanCode', kind: 'ratePlan', required: false },
        { field: 'status', kind: 'status', statusDomain: 'bookingStatus', required: true },
      ],
      effects: {},
      currencyField: 'currency',
    },
    {
      workflow: 'roomStatus',
      label: 'Room status (file import)',
      description: 'Import room status from a CSV file.',
      operations: ['read'],
      sync: 'file',
      status: 'supported',
      limitations: ['File-based: not a live connection.'],
      dataDomain: 'roomStatus',
      whenUnavailable: 'Room status stays as last imported.',
      freshnessTargetSeconds: null,
      expectedIntervalSeconds: null,
      sequentialRevisions: false,
      mappedFields: [
        { field: 'propertyCode', kind: 'property', required: true },
        { field: 'roomId', kind: 'unit', required: true },
        { field: 'statusCode', kind: 'status', statusDomain: 'roomStatus', required: true },
      ],
      effects: {},
    },
    {
      workflow: 'journals',
      label: 'Accounting journals (file export)',
      description: 'Export queued journal lines as a CSV file for an accounting system.',
      operations: ['create'],
      sync: 'file',
      status: 'limited',
      limitations: [
        'File-based: Portico cannot know whether the accounting system imported the file; exported lines are marked "exported", not confirmed.',
        'Journal lines are produced by the finance module (not yet connected in this deployment).',
      ],
      dataDomain: 'accounting',
      whenUnavailable: 'Lines wait in the export queue until someone generates the next file.',
      freshnessTargetSeconds: null,
      expectedIntervalSeconds: null,
      sequentialRevisions: false,
      mappedFields: [],
      effects: { create: 'money' },
    },
  ],
  governableDomains: [
    { domain: 'reservations', writeModes: ['read_only'] },
    { domain: 'roomStatus', writeModes: ['read_only'] },
  ],
  costNotes: [
    'No connector cost. The other system may charge for its export function: check with its vendor.',
  ],
  implementation: {
    level: 'R3',
    label: 'Implemented and tested internally',
    evidence: ['modules/integration/test/file-csv.test.ts — import (dedupe, ordering, holds) and export.'],
  },
  externalApproval: { status: 'not_required', note: 'Files are exchanged by the hotel itself.' },
  provenance: 'file',
  isSimulator: false,
  fileBased: true,
  setupPath: 'connection',
  ackSemantics: 'none',
  support: { vendor: 'The other system’s vendor, for its export format.', escalation: 'Monoclay support.' },
  vendorNotices: [],
};

export function fileCsvAdapter(): ConnectorAdapter {
  return {
    async testCredentials() {
      return {
        accountLabel: 'File-based (no credentials: staff upload files)',
        expiresAt: null,
        scopes: null,
        readOnly: true,
      };
    },
    async discover(ctx) {
      const records = (ctx.files ?? []).flatMap((f) => parseCsvFile(f.workflow, f.content, f.name));
      return entitiesFromRecords(records);
    },
    async sample(ctx, req) {
      const files = (ctx.files ?? []).filter((f) => f.workflow === req.workflow);
      return files.flatMap((f) => parseCsvFile(f.workflow, f.content, f.name)).slice(0, req.limit);
    },
    parseFile: parseCsvFile,
    renderFile(workflow, commands) {
      if (workflow !== 'journals')
        throw new ConnectorError('invalid', `The CSV connector cannot export "${workflow}".`);
      const rows = commands.map((c) => {
        const p = c.payload;
        const s = (k: string) =>
          typeof p[k] === 'string' || typeof p[k] === 'number' ? (p[k] as string | number) : null;
        return {
          reference: c.idempotencyKey,
          business_date: s('businessDate'),
          property_code: s('propertyCode'),
          ledger_account: s('ledgerAccount'),
          description: s('description'),
          debit_minor: s('debitMinor'),
          credit_minor: s('creditMinor'),
          currency: s('currency'),
        };
      });
      return { content: writeCsv(JOURNAL_COLUMNS, rows), contentType: 'text/csv', fileExtension: 'csv' };
    },
  };
}
