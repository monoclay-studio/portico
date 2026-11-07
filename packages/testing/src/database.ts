import { randomBytes } from 'node:crypto';
import { createDatabase, type MigrationSource, migrate, type PorticoDatabase } from '@portico/db';
import { type Clock, systemClock } from '@portico/kernel';
import pg from 'pg';

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres';
const APP_PASSWORD = 'portico_app_test';

export interface TestDatabase {
  name: string;
  /** Connected as the restricted application role — Row Level Security applies. Use this in tests. */
  db: PorticoDatabase;
  /** Superuser connection for test setup/inspection only. Bypasses RLS — never use for behavior under test. */
  admin: PorticoDatabase;
  appUrl: string;
  adminUrl: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, database: string, user?: { name: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}

/**
 * Create an isolated, fully migrated database for one test file.
 * Set PORTICO_TEST_DB_PREFIX to a unique value per agent/worktree to avoid collisions.
 */
export async function createTestDatabase(
  sources: MigrationSource[],
  opts: { clock?: Clock } = {},
): Promise<TestDatabase> {
  const prefix = (process.env.PORTICO_TEST_DB_PREFIX ?? 'portico_test')
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase();
  const name = `${prefix}_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const adminUrl = withDatabase(ADMIN_URL, name);
  await migrate({ connectionString: adminUrl, sources, appRolePassword: APP_PASSWORD });
  const appUrl = withDatabase(ADMIN_URL, name, { name: 'portico_app', password: APP_PASSWORD });
  const clock = opts.clock ?? systemClock;
  const db = createDatabase({ connectionString: appUrl, max: 8, clock, applicationName: 'portico-test' });
  const adminDb = createDatabase({
    connectionString: adminUrl,
    max: 2,
    clock,
    applicationName: 'portico-test-admin',
  });
  return {
    name,
    db,
    admin: adminDb,
    appUrl,
    adminUrl,
    async drop() {
      await db.close();
      await adminDb.close();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      try {
        await c.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}
