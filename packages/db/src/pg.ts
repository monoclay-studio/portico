import { sql } from 'kysely';
import type { TxContext } from './tx';

/** Postgres SQLSTATE of an error, if any (e.g. '23505' unique violation, '23P01' exclusion violation). */
export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/** Name of the violated constraint, if any. */
export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;
}

const SAVEPOINT_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Run `fn` inside a savepoint: if it throws, the surrounding transaction is left usable and unchanged, so the
 * caller can catch the error and continue (e.g. offer alternatives after a sold-out attempt).
 */
export async function withSavepoint<T>(tx: TxContext, name: string, fn: () => Promise<T>): Promise<T> {
  if (!SAVEPOINT_NAME.test(name)) throw new Error(`Invalid savepoint name "${name}"`);
  const sp = sql.raw(name);
  await sql`savepoint ${sp}`.execute(tx.db);
  try {
    const result = await fn();
    await sql`release savepoint ${sp}`.execute(tx.db);
    return result;
  } catch (err) {
    await sql`rollback to savepoint ${sp}`.execute(tx.db);
    await sql`release savepoint ${sp}`.execute(tx.db);
    throw err;
  }
}
