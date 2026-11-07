import { type Clock, systemClock } from '@portico/kernel';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Parse Postgres types safely:
//  - DATE stays a 'YYYY-MM-DD' string (never a JS Date with an implied time zone)
//  - INT8 becomes a number, but only within the safe-integer range (money is stored in minor units)
//  - NUMERIC stays a string (use Decimal)
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${v} exceeds the safe integer range`);
  return n;
});

// biome-ignore lint/suspicious/noExplicitAny: modules narrow this with their own table typings via `typed<DB>()`.
export type AnyDB = any;
export type Db = Kysely<AnyDB>;

export interface PorticoDatabase {
  readonly kysely: Db;
  readonly pool: pg.Pool;
  readonly clock: Clock;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
  clock?: Clock;
  applicationName?: string;
  statementTimeoutMs?: number;
}

export function createDatabase(opts: DatabaseOptions): PorticoDatabase {
  const pool = new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? 'portico',
    statement_timeout: opts.statementTimeoutMs ?? 30_000,
  });
  const kysely = new Kysely<AnyDB>({ dialect: new PostgresDialect({ pool }) });
  return {
    kysely,
    pool,
    clock: opts.clock ?? systemClock,
    async close() {
      await kysely.destroy();
    },
  };
}

/** Narrow the untyped transaction handle to a module's table typings. */
export function typed<DB>(db: Db): Kysely<DB> {
  return db as unknown as Kysely<DB>;
}
