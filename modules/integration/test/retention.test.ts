/** F18: settled raw payloads and file contents are redacted after the retention period; the history stays. */
import { sql } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import { activeSimulatorConnection, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('personal data retention (F18)', () => {
  it('redacts settled inbound payloads and purges file contents, keeping identifiers and hashes', async () => {
    const org = await setupOrg(h);
    const { conn, account } = await activeSimulatorConnection(h, org);
    await account.createReservation(h.clock.now(), { reservationId: 'RET1' });
    await integration.runSync(h.t.db, h.deps, org.ctx, conn.id, {
      trigger: 'manual',
      workflow: 'reservations',
    });
    let files = await tx(h, org.ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'file.csv',
        name: 'Old PMS files',
        propertyIds: [org.propertyId],
      }),
    );
    files = (
      await tx(h, org.ctx, (t) =>
        integration.reviewCompatibility(t, h.deps, files.id, files.version, {
          workflows: [{ workflow: 'reservations', operations: ['read'] }],
          authority: [],
        }),
      )
    ).connection;
    files = await integration.authorize(h.t.db, h.deps, org.ctx, files.id, files.version, {
      credentials: {},
      label: 'Files',
    });
    await tx(h, org.ctx, (t) =>
      integration.importFile(t, h.deps, files.id, {
        workflow: 'reservations',
        fileName: 'guests.csv',
        content:
          'reservation_id,modified_at,property_code,status,arrival,departure,room_type_code,rate_plan_code,guest_name,adults,total_amount_minor,currency\r\nS1,2026-11-01T08:00:00+05:00,LGN,CNF,2026-12-01,2026-12-04,BV,BAR,"Private Person",2,150000,USD\r\n',
      }),
    );

    // Nothing is redacted inside the retention period.
    expect(await tx(h, org.ctx, (t) => integration.applyRetention(t))).toEqual({
      redactedMessages: 0,
      purgedFiles: 0,
    });
    h.clock.advance((integration.RAW_PAYLOAD_RETENTION_DAYS + 1) * 86_400_000);
    const done = await tx(h, org.ctx, (t) => integration.applyRetention(t));
    expect(done.redactedMessages).toBeGreaterThanOrEqual(1);
    expect(done.purgedFiles).toBe(1);

    const msg = await sql<{
      payload: unknown;
      canonical: unknown;
      redacted_at: Date | null;
      revision: string;
    }>`
      select payload, canonical, redacted_at, revision from integration.inbound_messages
       where tenant_id = ${org.tenantId}::uuid and external_id = 'RET1'`.execute(h.t.admin.kysely);
    expect(msg.rows[0]).toMatchObject({ payload: {}, canonical: null, revision: expect.any(String) });
    expect(msg.rows[0]?.redacted_at).not.toBeNull();
    const file = await sql<{ content: string | null; sha256: string; name: string }>`
      select content, sha256, name from integration.files where tenant_id = ${org.tenantId}::uuid`.execute(
      h.t.admin.kysely,
    );
    expect(file.rows).toEqual([{ content: null, sha256: expect.any(String), name: 'guests.csv' }]);
    const leftovers = await sql<{ n: number }>`
      select count(*)::int as n from integration.inbound_messages
       where tenant_id = ${org.tenantId}::uuid and payload::text like '%Private Person%'`.execute(
      h.t.admin.kysely,
    );
    expect(leftovers.rows[0]?.n).toBe(0);
  });
});
