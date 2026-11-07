import { type ScheduledJob, sql } from '@portico/db';

/** Identity's periodic jobs (run by apps/worker through the composition root). */
export const IDENTITY_JOBS: readonly ScheduledJob[] = [
  {
    // Sign-in attempts exist only for credential-stuffing detection (15-minute window); keep 48 h, then delete.
    name: 'identity.purgeLoginAttempts',
    intervalSeconds: 3600,
    async run(database) {
      for (let i = 0; i < 100; i++) {
        const { rows } = await sql<{
          n: number;
        }>`select identity.purge_login_attempts(48, 5000) as n`.execute(database.kysely);
        if (!rows[0] || rows[0].n < 5000) return;
      }
    },
  },
  {
    // ADR-0017 rule 15: SSO links of people who no longer have a membership in the linking organization.
    name: 'identity.purgeOrphanSsoLinks',
    intervalSeconds: 3600,
    async run(database) {
      await sql`select identity.purge_orphan_sso_links()`.execute(database.kysely);
    },
  },
];
