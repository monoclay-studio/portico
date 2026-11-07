/**
 * `pms.simulator` — a SIMULATED external property management system used to prove connect-alongside flows
 * (adoption brief §2, §8) without any real hotel system. It holds reservations, rooms, room status and charges,
 * produces change messages, accepts commands, and has controllable faults: delivery delay, duplicates,
 * out-of-order delivery, outage, credential expiry, command timeouts and refusals.
 *
 * It is never a working integration with a real PMS (CLAUDE.md §7): data exchanged with it is labeled
 * "simulated". State lives in memory, per organization, outside Portico's database — like a real external system.
 */
import { randomToken } from '@portico/kernel';
import { z } from 'zod';
import type { SimulatorFaults } from '../contracts';
import {
  type AdapterContext,
  type ConnectorAdapter,
  type ConnectorDefinition,
  ConnectorError,
  type ExternalEntity,
  type InboundRecord,
  type OutboundRequest,
} from './sdk';

export const PMS_SIMULATOR_KEY = 'pms.simulator';

interface SimReservation {
  reservationId: string;
  revision: number;
  propertyCode: string;
  status: string;
  arrival: string;
  departure: string;
  roomTypeCode: string;
  ratePlanCode: string;
  guestName: string;
  adults: number;
  totalMinor: number;
  currency: string;
}

interface SimMessage {
  workflow: string;
  externalId: string;
  revision: number;
  occurredAt: Date;
  propertyCode: string;
  payload: Record<string, unknown>;
  summary: string;
}

export interface SimAppliedCommand {
  idempotencyKey: string;
  workflow: string;
  operation: string;
  payload: Record<string, unknown>;
  externalRef: string;
  appliedAt: Date;
}

export interface SimProperty {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  roomTypes: Array<{ code: string; name: string; maxOccupancy: number }>;
  rooms: Array<{ number: string; roomTypeCode: string }>;
  ratePlans: Array<{ code: string; name: string }>;
  chargeCodes: Array<{ code: string; name: string }>;
}

const ROOM_STATUSES = [
  { code: 'VC', name: 'Vacant Clean' },
  { code: 'VD', name: 'Vacant Dirty' },
  { code: 'OD', name: 'Occupied Dirty' },
  { code: 'INS', name: 'Inspected' },
  { code: 'OOO', name: 'Out of Order' },
];
const BOOKING_STATUSES = [
  { code: 'CNF', name: 'Confirmed' },
  { code: 'TEN', name: 'Tentative' },
  { code: 'CXL', name: 'Cancelled' },
];

/** Fictional sample data (Maldives resort) — no real hotel. */
export function defaultSimProperty(): SimProperty {
  return {
    code: 'LGN',
    name: 'Lagoon Island Resort (simulated PMS)',
    currency: 'USD',
    timezone: 'Indian/Maldives',
    roomTypes: [
      { code: 'BV', name: 'Beach Villa', maxOccupancy: 3 },
      { code: 'WV', name: 'Water Villa', maxOccupancy: 2 },
      { code: 'DV', name: 'Deluxe Villa', maxOccupancy: 3 },
    ],
    rooms: [
      { number: '101', roomTypeCode: 'BV' },
      { number: '102', roomTypeCode: 'BV' },
      { number: '201', roomTypeCode: 'WV' },
      { number: '202', roomTypeCode: 'WV' },
      { number: '301', roomTypeCode: 'DV' },
    ],
    ratePlans: [
      { code: 'BAR', name: 'Best Available Rate' },
      { code: 'HB', name: 'Half Board' },
    ],
    chargeCodes: [
      { code: 'RM', name: 'Room' },
      { code: 'FNB', name: 'Food & Beverage' },
      { code: 'SPA', name: 'Spa' },
    ],
  };
}

export class PmsSimulatorAccount {
  readonly accountId: string;
  readonly property: SimProperty;
  private readonly keys = new Map<string, { expiresAt: Date | null; readOnly: boolean }>();
  private readonly reservations = new Map<string, SimReservation>();
  private readonly roomStatus = new Map<string, { code: string; revision: number }>();
  private readonly queue: SimMessage[] = [];
  private readonly history: SimMessage[] = [];
  private readonly applied: SimAppliedCommand[] = [];
  private faults: Required<SimulatorFaults> = {
    outage: false,
    credentialExpired: false,
    delaySeconds: 0,
    duplicateNext: 0,
    reorderNext: false,
    timeoutNextCommand: false,
    rejectNextCommand: false,
  };
  private seq = 1000;
  /** Real PMS APIs often do not deduplicate by client keys; the simulator does not either (by default). */
  honorsIdempotencyKeys = false;

  constructor(accountId: string, property: SimProperty) {
    this.accountId = accountId;
    this.property = property;
  }

  issueKey(expiresAt: Date | null, opts: { readOnly?: boolean } = {}): string {
    const key = `simk_${randomToken(24)}`;
    this.keys.set(key, { expiresAt, readOnly: opts.readOnly ?? false });
    return key;
  }

  revokeKey(key: string): void {
    this.keys.delete(key);
  }

  setFaults(patch: SimulatorFaults): Required<SimulatorFaults> {
    this.faults = {
      ...this.faults,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    return { ...this.faults };
  }

  getFaults(): Required<SimulatorFaults> {
    return { ...this.faults };
  }

  appliedCommands(): readonly SimAppliedCommand[] {
    return this.applied;
  }

  // ── activity inside the "external" system ──

  createReservation(
    now: Date,
    input: Partial<Omit<SimReservation, 'revision'>> & { reservationId?: string } = {},
  ): SimReservation {
    const reservationId = input.reservationId ?? `R${++this.seq}`;
    const r: SimReservation = {
      reservationId,
      revision: 1,
      propertyCode: this.property.code,
      status: input.status ?? 'CNF',
      arrival: input.arrival ?? '2026-12-01',
      departure: input.departure ?? '2026-12-05',
      roomTypeCode: input.roomTypeCode ?? 'BV',
      ratePlanCode: input.ratePlanCode ?? 'BAR',
      guestName: input.guestName ?? 'Sample Guest',
      adults: input.adults ?? 2,
      totalMinor: input.totalMinor ?? 180_000,
      currency: input.currency ?? this.property.currency,
    };
    this.reservations.set(reservationId, r);
    this.emitReservation(now, r, `Reservation ${reservationId} created`);
    return r;
  }

  modifyReservation(
    now: Date,
    reservationId: string,
    patch: Partial<Omit<SimReservation, 'reservationId' | 'revision'>>,
  ): SimReservation {
    const r = this.reservations.get(reservationId);
    if (!r) throw new Error(`Simulated reservation ${reservationId} does not exist`);
    const next = { ...r, ...patch, revision: r.revision + 1 };
    this.reservations.set(reservationId, next);
    this.emitReservation(now, next, `Reservation ${reservationId} modified`);
    return next;
  }

  cancelReservation(now: Date, reservationId: string): SimReservation {
    return this.modifyReservation(now, reservationId, { status: 'CXL' });
  }

  setRoomStatus(now: Date, roomNumber: string, statusCode: string): void {
    const roomId = `${this.property.code}-${roomNumber}`;
    const prev = this.roomStatus.get(roomId);
    const revision = (prev?.revision ?? 0) + 1;
    this.roomStatus.set(roomId, { code: statusCode, revision });
    this.push({
      workflow: 'roomStatus',
      externalId: roomId,
      revision,
      occurredAt: now,
      propertyCode: this.property.code,
      payload: { roomId, roomNumber, propertyCode: this.property.code, statusCode },
      summary: `Room ${roomNumber} is now ${statusCode}`,
    });
  }

  postCharge(
    now: Date,
    input: { reservationId: string; chargeCode: string; amountMinor: number; currency: string },
  ): string {
    const chargeId = `C${++this.seq}`;
    this.push({
      workflow: 'charges',
      externalId: chargeId,
      revision: 1,
      occurredAt: now,
      propertyCode: this.property.code,
      payload: {
        chargeId,
        reservationId: input.reservationId,
        propertyCode: this.property.code,
        chargeCode: input.chargeCode,
        amountMinor: input.amountMinor,
        currency: input.currency,
        businessDate: localDate(now, this.property.timezone),
      },
      summary: `Charge ${chargeId} (${input.chargeCode}) on reservation ${input.reservationId}`,
    });
    return chargeId;
  }

  private emitReservation(now: Date, r: SimReservation, summary: string) {
    this.push({
      workflow: 'reservations',
      externalId: r.reservationId,
      revision: r.revision,
      occurredAt: now,
      propertyCode: r.propertyCode,
      payload: {
        reservationId: r.reservationId,
        propertyCode: r.propertyCode,
        status: r.status,
        arrival: r.arrival,
        departure: r.departure,
        roomTypeCode: r.roomTypeCode,
        ratePlanCode: r.ratePlanCode,
        guestName: r.guestName,
        adults: r.adults,
        totalMinor: r.totalMinor,
        currency: r.currency,
      },
      summary,
    });
  }

  private push(m: SimMessage) {
    this.queue.push(m);
    this.history.push(m);
  }

  // ── API surface used by the adapter (faults applied here) ──

  checkAccess(apiKey: unknown, now: Date): { expiresAt: Date | null; readOnly: boolean } {
    if (this.faults.outage)
      throw new ConnectorError('outage', 'The simulated PMS is unavailable (HTTP 503).');
    const key = typeof apiKey === 'string' ? this.keys.get(apiKey) : undefined;
    if (!key) throw new ConnectorError('auth', 'The simulated PMS did not recognise the API key.');
    if (this.faults.credentialExpired || (key.expiresAt && key.expiresAt.getTime() <= now.getTime())) {
      throw new ConnectorError('auth', 'The simulated PMS rejected the API key because it has expired.');
    }
    return { expiresAt: key.expiresAt, readOnly: key.readOnly };
  }

  /** Deliverable messages for a workflow. They stay queued until acknowledged (ack after commit). */
  pull(workflow: string, now: Date): SimMessage[] {
    const due = this.queue.filter(
      (m) =>
        m.workflow === workflow && m.occurredAt.getTime() + this.faults.delaySeconds * 1000 <= now.getTime(),
    );
    let out = [...due];
    if (this.faults.duplicateNext > 0 && out.length > 0) {
      const n = Math.min(this.faults.duplicateNext, out.length);
      out = [...out, ...out.slice(0, n)];
      this.faults.duplicateNext -= n;
    }
    if (this.faults.reorderNext && out.length > 1) {
      out.reverse();
      this.faults.reorderNext = false;
    }
    return out;
  }

  acknowledge(workflow: string, records: ReadonlyArray<{ externalId: string; revision: string }>): void {
    const done = new Set(records.map((r) => `${r.externalId}#${r.revision}`));
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const m = this.queue[i] as SimMessage;
      if (m.workflow === workflow && done.has(`${m.externalId}#${m.revision}`)) this.queue.splice(i, 1);
    }
  }

  pendingCount(workflow?: string): number {
    return this.queue.filter((m) => !workflow || m.workflow === workflow).length;
  }

  recent(workflow: string, limit: number): SimMessage[] {
    return this.history.filter((m) => m.workflow === workflow).slice(-limit);
  }

  apply(req: OutboundRequest, now: Date): string {
    if (this.faults.rejectNextCommand) {
      this.faults.rejectNextCommand = false;
      throw new ConnectorError(
        'rejected',
        'The simulated PMS refused the action: the folio is closed for posting.',
        {
          httpStatus: 422,
        },
      );
    }
    if (this.honorsIdempotencyKeys) {
      const prior = this.applied.find((a) => a.idempotencyKey === req.idempotencyKey);
      if (prior) return prior.externalRef;
    }
    const externalRef = `X${++this.seq}`;
    this.applied.push({
      idempotencyKey: req.idempotencyKey,
      workflow: req.workflow,
      operation: req.operation,
      payload: req.payload,
      externalRef,
      appliedAt: now,
    });
    if (req.workflow === 'reservations' && req.operation === 'cancel') {
      const id = String(req.payload.reservationId ?? '');
      if (this.reservations.has(id)) this.cancelReservation(now, id);
    }
    if (req.workflow === 'roomStatus' && req.operation === 'update') {
      const roomNumber = String(req.payload.roomNumber ?? '');
      const statusCode = String(req.payload.statusCode ?? '');
      if (roomNumber && statusCode) this.setRoomStatus(now, roomNumber, statusCode);
    }
    if (this.faults.timeoutNextCommand) {
      // The action WAS applied, but the response never reaches Portico: the outcome is unknown to Portico.
      this.faults.timeoutNextCommand = false;
      throw new ConnectorError(
        'timeout',
        'The simulated PMS did not answer in time; the outcome is unknown.',
      );
    }
    return externalRef;
  }

  /** Search by the reference Portico writes into every command (supports verify-before-resend). */
  findApplied(idempotencyKey: string): SimAppliedCommand | undefined {
    return this.applied.find((a) => a.idempotencyKey === idempotencyKey);
  }

  entities(): ExternalEntity[] {
    const p = this.property;
    const out: ExternalEntity[] = [
      {
        kind: 'property',
        externalId: p.code,
        label: p.name.replace(' (simulated PMS)', ''),
        propertyExternalId: p.code,
        attributes: { currency: p.currency, timezone: p.timezone },
      },
    ];
    for (const t of p.roomTypes) {
      out.push({
        kind: 'unitType',
        externalId: t.code,
        label: t.name,
        propertyExternalId: p.code,
        attributes: {
          maxOccupancy: t.maxOccupancy,
          unitCount: p.rooms.filter((r) => r.roomTypeCode === t.code).length,
        },
      });
    }
    for (const r of p.rooms) {
      out.push({
        kind: 'unit',
        externalId: `${p.code}-${r.number}`,
        code: r.number,
        label: `Room ${r.number}`,
        propertyExternalId: p.code,
        attributes: { unitTypeExternalId: r.roomTypeCode },
      });
    }
    for (const rp of p.ratePlans) {
      out.push({
        kind: 'ratePlan',
        externalId: rp.code,
        label: rp.name,
        propertyExternalId: p.code,
        attributes: { currency: p.currency },
      });
    }
    for (const c of p.chargeCodes) {
      out.push({
        kind: 'chargeCode',
        externalId: c.code,
        label: c.name,
        propertyExternalId: p.code,
        attributes: {},
      });
    }
    for (const s of ROOM_STATUSES) {
      out.push({
        kind: 'status',
        externalId: `roomStatus:${s.code}`,
        code: s.code,
        label: s.name,
        statusDomain: 'roomStatus',
        propertyExternalId: null,
        attributes: {},
      });
    }
    for (const s of BOOKING_STATUSES) {
      out.push({
        kind: 'status',
        externalId: `bookingStatus:${s.code}`,
        code: s.code,
        label: s.name,
        statusDomain: 'bookingStatus',
        propertyExternalId: null,
        attributes: {},
      });
    }
    return out;
  }
}

function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return parts;
}

/** In-memory registry of simulated PMS accounts, isolated per organization. */
export class PmsSimulatorHub {
  private readonly accounts = new Map<string, PmsSimulatorAccount>();
  private counter = 0;

  createAccount(
    tenantId: string,
    opts: { property?: SimProperty; keyExpiresAt?: Date | null; readOnlyKey?: boolean; seedAt?: Date } = {},
  ): { account: PmsSimulatorAccount; apiKey: string } {
    const accountId = `sim-${++this.counter}-${randomToken(4).toLowerCase()}`;
    const account = new PmsSimulatorAccount(accountId, opts.property ?? defaultSimProperty());
    const apiKey = account.issueKey(opts.keyExpiresAt ?? null, { readOnly: opts.readOnlyKey ?? false });
    this.accounts.set(`${tenantId}:${accountId}`, account);
    if (opts.seedAt) {
      account.createReservation(opts.seedAt, { guestName: 'A. Sample', roomTypeCode: 'BV' });
      account.createReservation(opts.seedAt, {
        guestName: 'B. Sample',
        roomTypeCode: 'WV',
        ratePlanCode: 'HB',
      });
      account.setRoomStatus(opts.seedAt, '101', 'VD');
    }
    return { account, apiKey };
  }

  get(tenantId: string, accountId: string): PmsSimulatorAccount | undefined {
    return this.accounts.get(`${tenantId}:${accountId}`);
  }
}

export const pmsSimulatorCredentialSchema = z.object({
  accountId: z.string().min(1).max(100),
  apiKey: z.string().min(16).max(200),
});

export const pmsSimulatorDefinition: ConnectorDefinition = {
  key: PMS_SIMULATOR_KEY,
  name: 'Simulated PMS',
  category: 'pms',
  vendor: {
    name: 'Portico (simulator)',
    note: 'Built into Portico for demonstrations and testing. Not a real hotel system.',
  },
  products: [{ name: 'Portico PMS simulator', versions: ['1'] }],
  regions: ['global'],
  accessModel: 'public_api',
  localConnectorRequired: false,
  localConnectorNote: null,
  credentialSchema: pmsSimulatorCredentialSchema,
  credentialFields: [
    {
      name: 'accountId',
      label: 'Simulator account',
      secret: false,
      description: 'The simulated PMS account id.',
    },
    {
      name: 'apiKey',
      label: 'API key',
      secret: true,
      description: 'Issued when the simulated PMS account is created.',
    },
  ],
  vendorSetupSteps: [
    'Create a simulated PMS account (Integrations → Simulators). Portico shows its account id and API key once.',
    'Copy the API key into the authorization step. In a real PMS this is where the hotel’s administrator issues an API key or approves access.',
  ],
  prerequisites: ['A Portico property for each simulated property you want to connect.'],
  workflows: [
    {
      workflow: 'reservations',
      label: 'Reservations',
      description:
        'Receive new, changed and cancelled reservations; send cancellations and new bookings when Portico forwards them.',
      operations: ['read', 'receive', 'create', 'update'],
      sync: 'periodic',
      status: 'supported',
      limitations: [
        'Simulated: fictional data only.',
        'Group blocks, split stays and multi-room bookings are not simulated.',
      ],
      dataDomain: 'reservations',
      whenUnavailable:
        'Portico keeps its last copy, labeled delayed, and raises an exception; staff use the PMS directly until it returns.',
      freshnessTargetSeconds: 120,
      expectedIntervalSeconds: 60,
      sequentialRevisions: true,
      mappedFields: [
        { field: 'propertyCode', kind: 'property', required: true },
        { field: 'roomTypeCode', kind: 'unitType', required: true },
        { field: 'ratePlanCode', kind: 'ratePlan', required: false },
        { field: 'status', kind: 'status', statusDomain: 'bookingStatus', required: true },
      ],
      effects: { create: 'inventory', update: 'inventory', cancel: 'inventory_reopen' },
      currencyField: 'currency',
    },
    {
      workflow: 'roomStatus',
      label: 'Room status',
      description: 'Receive housekeeping room status; send status changes made in Portico.',
      operations: ['read', 'receive', 'update'],
      sync: 'periodic',
      status: 'supported',
      limitations: [
        'Simulated: fictional data only.',
        'Occupancy discrepancies (skip/sleep) are not simulated.',
      ],
      dataDomain: 'roomStatus',
      whenUnavailable: 'Room status in Portico is labeled delayed; housekeeping updates wait in a queue.',
      freshnessTargetSeconds: 60,
      expectedIntervalSeconds: 30,
      sequentialRevisions: true,
      mappedFields: [
        { field: 'propertyCode', kind: 'property', required: true },
        { field: 'roomId', kind: 'unit', required: true },
        { field: 'statusCode', kind: 'status', statusDomain: 'roomStatus', required: true },
      ],
      effects: { update: 'standard' },
    },
    {
      workflow: 'charges',
      label: 'Guest charges',
      description:
        'Receive charges posted in the PMS; post charges from Portico to the guest’s bill in the PMS.',
      operations: ['read', 'receive', 'create'],
      sync: 'periodic',
      status: 'limited',
      limitations: [
        'Simulated: fictional data only.',
        'Corrections are new negative charges; a posted charge is never edited.',
        'Taxes are not itemised: the simulated PMS posts gross amounts.',
      ],
      dataDomain: 'charges',
      whenUnavailable:
        'Charges wait in a queue; after an interruption each one needs confirmation before it is sent, so a guest is never charged twice.',
      freshnessTargetSeconds: 300,
      expectedIntervalSeconds: 60,
      sequentialRevisions: false,
      mappedFields: [
        { field: 'propertyCode', kind: 'property', required: true },
        { field: 'chargeCode', kind: 'chargeCode', required: true },
      ],
      effects: { create: 'money' },
      currencyField: 'currency',
    },
    {
      workflow: 'availability',
      label: 'Availability',
      description: 'Not offered by the simulated PMS.',
      operations: [],
      sync: 'manual',
      status: 'unsupported',
      limitations: ['The simulated PMS does not publish availability.'],
      dataDomain: 'availability',
      whenUnavailable:
        'Availability stays wherever it is managed today; Portico does not show it for this connection.',
      freshnessTargetSeconds: null,
      expectedIntervalSeconds: null,
      sequentialRevisions: false,
      mappedFields: [],
      effects: {},
    },
  ],
  governableDomains: [
    { domain: 'reservations', writeModes: ['read_only', 'forward'] },
    { domain: 'roomStatus', writeModes: ['read_only', 'forward'] },
    { domain: 'charges', writeModes: ['read_only', 'forward'] },
  ],
  costNotes: ['No cost: built-in simulator.'],
  implementation: {
    level: 'R3',
    label: 'Implemented and tested internally (simulator only)',
    evidence: [
      'modules/integration/test/setup-journey.test.ts, scenario-s02-inbound-faults.test.ts, scenario-s20-integration-outage.test.ts, credentials.test.ts — journey, faults and recovery against the simulator (2026-11-07, automated).',
    ],
  },
  externalApproval: { status: 'not_required', note: 'Simulator: no vendor involved.' },
  provenance: 'simulated',
  isSimulator: true,
  fileBased: false,
  setupPath: 'connection',
  support: { vendor: 'Not applicable (simulator).', escalation: 'Monoclay support.' },
  vendorNotices: [],
};

export function pmsSimulatorAdapter(hub: PmsSimulatorHub): ConnectorAdapter {
  const account = (ctx: AdapterContext): PmsSimulatorAccount => {
    const accountId = typeof ctx.credential?.accountId === 'string' ? ctx.credential.accountId : '';
    const a = hub.get(ctx.tenantId, accountId);
    if (!a)
      throw new ConnectorError('auth', 'This simulated PMS account does not exist in your organization.');
    a.checkAccess(ctx.credential?.apiKey, ctx.now);
    return a;
  };
  const toRecord = (m: SimMessage): InboundRecord => ({
    workflow: m.workflow,
    externalId: m.externalId,
    revision: String(m.revision),
    revisionOrder: m.revision,
    occurredAt: m.occurredAt.toISOString(),
    propertyExternalId: m.propertyCode,
    payload: m.payload,
    summary: m.summary,
  });
  return {
    async testCredentials(ctx) {
      const a = hub.get(
        ctx.tenantId,
        typeof ctx.credential?.accountId === 'string' ? ctx.credential.accountId : '',
      );
      if (!a)
        throw new ConnectorError('auth', 'This simulated PMS account does not exist in your organization.');
      const { expiresAt, readOnly } = a.checkAccess(ctx.credential?.apiKey, ctx.now);
      return {
        accountLabel: a.property.name,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        scopes: readOnly ? ['read'] : ['read', 'write'],
        readOnly,
      };
    },
    async discover(ctx) {
      return account(ctx).entities();
    },
    async pull(ctx, req) {
      const records = account(ctx).pull(req.workflow, ctx.now).map(toRecord);
      return { records, cursor: null };
    },
    async acknowledge(ctx, req) {
      account(ctx).acknowledge(req.workflow, req.records);
    },
    async sample(ctx, req) {
      return account(ctx).recent(req.workflow, req.limit).map(toRecord);
    },
    async send(ctx, req) {
      const a = hub.get(
        ctx.tenantId,
        typeof ctx.credential?.accountId === 'string' ? ctx.credential.accountId : '',
      );
      if (!a)
        throw new ConnectorError('auth', 'This simulated PMS account does not exist in your organization.');
      if (a.checkAccess(ctx.credential?.apiKey, ctx.now).readOnly) {
        throw new ConnectorError('auth', 'The simulated PMS refused a change: this API key is read-only.');
      }
      return { externalRef: a.apply(req, ctx.now) };
    },
    async lookup(ctx, req) {
      const found = account(ctx).findApplied(req.idempotencyKey);
      return { found: found !== undefined, externalRef: found?.externalRef ?? null };
    },
  };
}
