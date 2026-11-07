import { type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  BusinessRuleError,
  ConflictError,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { ZodType } from 'zod';
import type { RatesPorts } from '../ports';
import type { RatesDB } from '../tables';

export const db = (tx: TxContext) => typed<RatesDB>(tx.db);
export type Row<T extends keyof RatesDB> = Selectable<RatesDB[T]>;

export const actorKey = (tx: TxContext) => `${tx.actor.kind}:${actorId(tx.actor)}`;

/**
 * Guard for every rates configuration write: permission for the property, then data authority (`rates`).
 * When an external system is authoritative with write mode `forward`, rates cannot forward yet → refuse with
 * an explanation instead of silently diverging (ADR-0014).
 */
export async function guardConfigWrite(
  ports: RatesPorts,
  tx: TxContext,
  propertyId: string,
  permission: string,
): Promise<void> {
  requirePermission(tx, permission, { propertyId });
  const mode = await ports.assertWritable(tx, propertyId, 'rates');
  if (mode === 'forward') {
    throw new BusinessRuleError(
      'rates_forwarding_unavailable',
      'Rates at this property are managed in an external system. Forwarding rate changes to it is not available yet, so make this change in that system; Portico will show it once received.',
      { propertyId, domain: 'rates' },
    );
  }
}

/** Read permission: either configuration read or quoting (desk staff quote without seeing every setting). */
export function requireRead(tx: TxContext, propertyId: string): void {
  if (tx.authz.can('rates.ratePlan.read', { propertyId })) return;
  requirePermission(tx, 'rates.quote.read', { propertyId });
}

export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export async function withUniqueCode<T>(entity: string, code: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        `${entity}_code_taken`,
        `The code ${code} is already used by another ${entity.replace(/_/g, ' ')} at this property. Choose a different code.`,
        { code },
      );
    }
    throw err;
  }
}

/** Parse stored JSON with its schema (defends against drift); a failure is a server-side data problem. */
export function parseStored<T>(schema: ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`Stored ${what} does not match its schema: ${r.error.message}`);
  return r.data;
}

export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ValidationError(
      'validation_failed',
      'Some fields are missing or invalid. Correct them and try again.',
      {
        errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    );
  }
  return r.data;
}

export const json = (v: unknown) => JSON.stringify(v);

export async function lockPlanGraph(tx: TxContext, propertyId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`rates.plan-graph:${propertyId}`}))`.execute(tx.db);
}
