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

/** True when the error is a port stub for a module not wired in this installation. */
export function isModuleUnavailable(err: unknown): boolean {
  return err instanceof DomainError && err.code === 'module_not_available';
}

/** Parse a Postgres daterange text '[2026-11-10,2026-11-13)'. */
export function parseNights(value: string): { from: LocalDate; to: LocalDate } {
  const m = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(value);
  if (!m) throw new Error(`Unexpected daterange value ${value}`);
  return { from: m[1] as string, to: m[2] as string };
}

export const json = (v: unknown): string => JSON.stringify(v ?? null);
