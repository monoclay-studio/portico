import { randomBytes } from 'node:crypto';
import { type TxContext, typed } from '@portico/db';
import { actorId, actorLabel, DomainError, type LocalDate } from '@portico/kernel';
import type { PropertyInfo, ReservationsPorts } from '../ports';
import type { ReservationsDB } from '../tables';

export interface ServiceConfig {
  /** How long a change preview token stays valid (minutes). */
  previewTtlMinutes: number;
  /** Default inventory hold for 'hold' intent (minutes) when the property has no policy. */
  holdMinutes: number;
  randomBytes: (n: number) => Uint8Array;
}

export const DEFAULT_CONFIG: ServiceConfig = {
  previewTtlMinutes: 15,
  holdMinutes: 30,
  randomBytes: (n) => randomBytes(n),
};

export interface Deps {
  ports: ReservationsPorts;
  config: ServiceConfig;
}

export const db = (tx: TxContext) => typed<ReservationsDB>(tx.db);

export const actorKey = (tx: TxContext): string => `${tx.actor.kind}:${actorId(tx.actor)}`;
export const actorName = (tx: TxContext): string => actorLabel(tx.actor);
export const actorUserId = (tx: TxContext): string | null =>
  tx.actor.kind === 'user' ? tx.actor.userId : null;

/** Property facts needed for computation (time zone, currency, business date). */
export async function propertyInfo(deps: Deps, tx: TxContext, propertyId: string): Promise<PropertyInfo> {
  return deps.ports.platform.getProperty(tx, propertyId);
}

export async function businessDateOf(deps: Deps, tx: TxContext, propertyId: string): Promise<LocalDate> {
  return deps.ports.platform.getBusinessDate(tx, propertyId);
}

export async function policy<T>(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  key: string,
  def: T,
): Promise<T> {
  return (await deps.ports.platform.resolvePolicy<T>(tx, propertyId, key, def)).value;
}

/**
 * True when a cross-module FACT could not be read: the provider is not installed, or (ADR-0015 transition, review
 * R-14/R-29) it refused the read (403) or does not know the record yet (404). Read-only facts degrade to
 * "unknown"; they never fail the whole record or step.
 */
export function isModuleUnavailable(err: unknown): boolean {
  return (
    err instanceof DomainError &&
    (err.code === 'module_not_available' || err.status === 403 || err.status === 404)
  );
}

export interface ChargeCodes {
  cancellation: string;
  noShow: string;
  earlyDeparture: string;
  earlyCheckIn: string;
  lateCheckOut: string;
}

/**
 * Finance charge codes for reservations' penalties and fees (review R-10). Data, not code: property policy
 * `reservations.chargeCodes`, defaulting to codes in finance's default catalogue (CXL, MISC).
 */
export async function chargeCodes(deps: Deps, tx: TxContext, propertyId: string): Promise<ChargeCodes> {
  const defaults: ChargeCodes = {
    cancellation: 'CXL',
    noShow: 'CXL',
    earlyDeparture: 'CXL',
    earlyCheckIn: 'MISC',
    lateCheckOut: 'MISC',
  };
  const configured = await policy<Partial<ChargeCodes>>(deps, tx, propertyId, 'reservations.chargeCodes', {});
  return { ...defaults, ...configured };
}

/** Parse a Postgres daterange text '[2026-11-10,2026-11-13)'. */
export function parseNights(value: string): { from: LocalDate; to: LocalDate } {
  const m = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(value);
  if (!m) throw new Error(`Unexpected daterange value ${value}`);
  return { from: m[1] as string, to: m[2] as string };
}

export const json = (v: unknown): string => JSON.stringify(v ?? null);

/**
 * UX FD-15 / C11.2 (review P2-1): money (totals, deposits, balances, payment state) is returned only to roles that
 * handle money at the property. The server decides; hidden navigation is not access control.
 */
export const MONEY_READ = [
  'finance.folio.read',
  'payments.payment.read',
  'payments.payment.collect',
] as const;
export function seesMoney(tx: TxContext, propertyId: string): boolean {
  return MONEY_READ.some((p) => tx.authz.can(p, { propertyId }));
}

/**
 * Review R2-P3-5: a booking's commercial value (agreed totals, the deposit it requires) is the revenue manager's core
 * data, not payment state. Roles that handle money see it, and so do roles that set prices. Payment state, balances
 * and folio links stay with `seesMoney`.
 */
export const COMMERCIAL_READ = [...MONEY_READ, 'rates.price.manage'] as const;
export function seesCommercialValue(tx: TxContext, propertyId: string): boolean {
  return COMMERCIAL_READ.some((p) => tx.authz.can(p, { propertyId }));
}

/** Who may see which saved card secures a booking (review R2-P1-1): payment roles only. */
export function seesPaymentMethods(tx: TxContext, propertyId: string): boolean {
  return ['payments.payment.read', 'payments.payment.collect', 'payments.method.manage'].some((p) =>
    tx.authz.can(p, { propertyId }),
  );
}
export const MONEY_NOT_SHOWN = 'Payment detail is not shown for your role.';

/** Re-review #3 R3-P2-2: stored issues whose text or details are derived from money (balances, payments, cards). */
export const MONEY_ISSUE_KINDS: ReadonlySet<string> = new Set([
  'departed_with_balance',
  'payment_follow_up',
  'guarantee_card_not_attached',
]);

/**
 * The text and details of a stored issue as this reader may see them: a money issue is shown to roles without money
 * permissions as "there is a payment matter for a colleague who handles payments", never with amounts or details.
 */
export function issueForReader(
  tx: TxContext,
  propertyId: string,
  issue: { kind: string; message: string; details?: unknown },
): { message: string; details: Record<string, unknown> } {
  if (!MONEY_ISSUE_KINDS.has(issue.kind) || seesMoney(tx, propertyId)) {
    return { message: issue.message, details: (issue.details ?? {}) as Record<string, unknown> };
  }
  return { message: `${MONEY_NOT_SHOWN} A colleague who handles payments follows this up.`, details: {} };
}
