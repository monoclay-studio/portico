/**
 * file.csv: a file exchange is never a live connection. Sample files drive mapping suggestions during setup;
 * after activation, imports are deduplicated and ordered (re-importing the same file has no effect, an older file
 * never overwrites newer information), unreadable files are explained, and exports are "exported", not "synced".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integration } from '../src';
import { catalogIds, type Harness, setupOrg, startHarness, tx } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const HEADER =
  'reservation_id,modified_at,property_code,status,arrival,departure,room_type_code,rate_plan_code,guest_name,adults,total_amount_minor,currency';
const row = (id: string, modified: string, rt = 'BV', status = 'CNF') =>
  `${id},${modified},LGN,${status},2026-12-01,2026-12-04,${rt},BAR,"Guest, ${id}",2,150000,USD`;

describe('file.csv connector', () => {
  it('runs the journey from a sample file, imports idempotently and exports without claiming confirmation', async () => {
    const org = await setupOrg(h);
    const ctx = org.ctx;
    let conn = await tx(h, ctx, (t) =>
      integration.createConnection(t, h.deps, {
        connectorKey: 'file.csv',
        name: 'Old PMS exports',
        propertyIds: [org.propertyId],
      }),
    );
    expect(conn.exchangeProvenance).toBe('file');
    const review = await tx(h, ctx, (t) =>
      integration.reviewCompatibility(t, h.deps, conn.id, conn.version, {
        workflows: [
          { workflow: 'reservations', operations: ['read'] },
          { workflow: 'journals', operations: ['create'] },
        ],
        authority: [{ domain: 'reservations', writeMode: 'read_only' }],
      }),
    );
    expect(
      review.report.checks
        .filter((c) => c.code === 'file_exchange')
        .map((c) => c.message)
        .join(' '),
    ).toMatch(/not a live connection/);
    conn = review.connection;
    conn = await integration.authorize(h.t.db, h.deps, ctx, conn.id, conn.version, {
      credentials: {},
      label: 'Files',
    });
    // A sample file during setup is stored, not applied.
    const sample = `${HEADER}\r\n${row('F100', '2026-11-01T08:00:00+05:00')}\r\n${row('F101', '2026-11-01T08:05:00+05:00', 'WV', 'TEN')}\r\n`;
    const stored = await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'sample.csv',
        content: sample,
      }),
    );
    expect(stored).toMatchObject({ storedAsSample: true, syncRun: null });
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const set = await integration.suggestConnectionMappings(h.t.db, h.deps, ctx, conn.id, conn.version);
    expect(set.items.map((m) => `${m.kind}:${m.externalId}`).sort()).toEqual(
      [
        'property:LGN',
        'ratePlan:BAR',
        'status:bookingStatus:CNF',
        'status:bookingStatus:TEN',
        'unitType:BV',
        'unitType:WV',
      ].sort(),
    );
    for (const m of set.items.filter((x) => x.requiresReview)) {
      await tx(h, ctx, (t) =>
        integration.reviewMapping(
          t,
          h.deps,
          m.id,
          m.version,
          m.internalId ? { decision: 'confirm' } : { decision: 'ignore' },
        ),
      );
    }
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    conn = await tx(h, ctx, (t) => integration.resolveIssues(t, h.deps, conn.id, conn.version));
    const vr = await integration.runValidation(h.t.db, h.deps, ctx, conn.id, conn.version);
    expect(vr.status).toBe('passed');
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    const preview = await integration.previewActivation(h.t.db, h.deps, ctx, conn.id, conn.version);
    expect(preview.warnings.join(' ')).toMatch(/File exchange — not a live connection/);
    expect(preview.impact.hotelFunctions[0]?.effect).toMatch(/file-based/);
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    conn = await tx(h, ctx, (t) =>
      integration.activate(t, h.deps, conn.id, conn.version, {
        previewId: preview.id,
        previewHash: preview.hash,
      }),
    );
    expect(conn.integrationStatus).not.toBe('live');
    await expect(
      integration.runSync(h.t.db, h.deps, ctx, conn.id, { trigger: 'manual' }),
    ).rejects.toMatchObject({ code: 'file_based_connection' });

    // Import: applied; the same file again: all duplicates; an OLDER file later: stale, never overwrites.
    const day2 = `${HEADER}\r\n${row('F100', '2026-11-02T08:00:00+05:00', 'WV')}\r\n${row('F102', '2026-11-02T09:00:00+05:00')}\r\n`;
    const first = await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'day2.csv',
        content: day2,
      }),
    );
    expect(first.syncRun).toMatchObject({
      trigger: 'file',
      status: 'succeeded',
      provenance: 'file',
      counts: { applied: 2 },
    });
    const again = await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'day2.csv',
        content: day2,
      }),
    );
    expect(again.syncRun?.counts).toMatchObject({ applied: 0, duplicates: 2 });
    const older = await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'day1.csv',
        content: sample,
      }),
    );
    expect(older.syncRun?.counts).toMatchObject({ applied: 1, stale: 1 }); // F101 is new; F100 day1 is older than day2
    conn = await tx(h, ctx, (t) => integration.getConnection(t, h.deps, conn.id));
    expect(conn.state).toBe('monitoring');
    const health = await tx(h, ctx, (t) => integration.getConnectionHealth(t, h.deps, conn.id));
    expect(health.workflows[0]).toMatchObject({
      exchangeLabel: 'File exchange — not a live connection',
      freshnessTargetSeconds: null,
    });

    // A malformed file is explained in plain language; nothing applied.
    const bad = await tx(h, ctx, (t) =>
      integration.importFile(t, h.deps, conn.id, {
        workflow: 'reservations',
        fileName: 'bad.csv',
        content: `${HEADER}\r\nF200,yesterday,LGN,CNF,2026-12-01,2026-12-02,BV,BAR,X,2,1,USD\r\n`,
      }),
    );
    expect(bad.syncRun?.status).toBe('failed');
    const ex = await tx(h, ctx, (t) =>
      integration.listExceptions(t, { connectionId: conn.id, status: 'unresolved' }),
    );
    expect(ex.find((e) => e.code === 'file_unreadable')?.problem).toMatch(
      /modified_at "yesterday" is not an ISO date-time/,
    );

    // Export: queued journal lines become a CSV file, marked exported (not confirmed).
    for (const n of [1, 2]) {
      await tx(h, ctx, (t) =>
        integration.enqueueOutbound(t, h.deps, {
          connectionId: conn.id,
          propertyId: org.propertyId,
          workflow: 'journals',
          operation: 'create',
          idempotencyKey: `journal:2026-11-07:${n}`,
          payload: {
            businessDate: '2026-11-07',
            propertyCode: 'LGN',
            ledgerAccount: '4000',
            description: n === 1 ? '=HYPERLINK("x")' : 'Room revenue',
            debitMinor: 0,
            creditMinor: 150000,
            currency: 'USD',
          },
        }),
      );
    }
    const exported = await tx(h, ctx, (t) =>
      integration.exportFile(t, h.deps, conn.id, { workflow: 'journals' }),
    );
    expect(exported.rows).toBe(2);
    expect(exported.notice).toMatch(/not confirmed.*duplicate entries/);
    expect(exported.content.split('\r\n')[0]).toBe(
      'reference,business_date,property_code,ledger_account,description,debit_minor,credit_minor,currency',
    );
    expect(exported.content).toContain(`'=HYPERLINK`);
    const cmds = await tx(h, ctx, (t) => integration.listOutbound(t, conn.id));
    expect(cmds.every((c) => c.status === 'exported')).toBe(true);
    const nothing = await tx(h, ctx, (t) =>
      integration.exportFile(t, h.deps, conn.id, { workflow: 'journals' }),
    );
    expect(nothing.rows).toBe(0);
    void catalogIds;
  });
});
