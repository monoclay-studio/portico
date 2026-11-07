/**
 * An SMB PMS export (ASSUMED Little Hotelier layout — unverified until a real sample exists): column hints plus
 * auto-detection, DD/MM dates detected, guests derived from reservation rows, unit types derived from the codes
 * used, every status imported (incl. cancelled and no-show history). The source stays labelled "unverified".
 */
import { withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migration, sampleGuesthouseWorkbook, sampleSmbExport } from '../src';
import { db } from '../src/service/context';
import { ALL_MIGRATION, type Harness, setupOrg, startHarness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('Little Hotelier export (assumed layout) → trial', () => {
  it('detects the columns, derives guests and unit types, imports every status and certifies', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const lead = org.user('Lead', ALL_MIGRATION);
    const job = await org.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: org.propertyId,
          sourceAdapter: 'littlehotelier.csv',
          sourceSystem: 'Little Hotelier (Coral Sands)',
        }),
      lead,
    );
    const preview = await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
      files: [sampleSmbExport(org.businessDate)],
      preview: true,
    });
    expect(preview.stored).toBe(false);
    expect(preview.review[0]).toMatchObject({
      kind: 'reservations',
      missingRequired: [],
      needsConfirmation: false,
    });
    expect(preview.counts).toEqual({ reservation: 6, guest: 4 });
    expect(
      await org.run((tx) =>
        db(tx).selectFrom('migration.extracts').select('seq').where('job_id', '=', job.id).execute(),
      ),
    ).toEqual([]);
    await migration.uploadFiles(h.t.db, h.deps, lead, job.id, { files: [sampleSmbExport(org.businessDate)] });
    const r = await migration.runPipeline(h.t.db, h.deps, lead, job.id);
    expect(r.executed.map((e) => `${e.step}:${e.status}`)).toEqual([
      'discover:succeeded',
      'extract:succeeded',
      'map:succeeded',
      'validate:succeeded',
      'rehearse:succeeded',
      'reconcile:succeeded',
      'signoff:succeeded',
      'delta_sync:waiting',
    ]);
    const v = await org.run(async (tx) => migration.jobView(tx, await migration.loadJob(tx, job.id)));
    expect(v.source.verification).toBe('unverified');
    expect(v.issues.map((i) => i.code)).toContain('source_format_unverified');
    const plan = (await org.run((tx) => migration.loadJob(tx, job.id))).plan;
    expect(plan.unitTypes.map((u) => [u.sourceCode, u.action, u.targetCode])).toEqual([
      ['GARDEN VIEW', 'create', 'GARDEN-VIEW'],
      ['SEA VIEW', 'create', 'SEA-VIEW'],
    ]);
    const listed = await org.run((tx) =>
      h.reservations.listImported(tx, { propertyId: org.propertyId, sourceSystem: 'littlehotelier.csv' }),
    );
    expect(listed.map((b) => [b.sourceKey, b.status]).sort()).toEqual([
      ['LH-2001', 'confirmed'],
      ['LH-2002', 'in_house'],
      ['LH-2003', 'cancelled'],
      ['LH-2004', 'departed'],
      ['LH-2005', 'no_show'],
      ['LH-2006', 'tentative'],
    ]);
    expect(listed.find((b) => b.sourceKey === 'LH-2002')).toMatchObject({
      arrival: '2026-11-30',
      taxTotalMinor: 8840,
      totalMinor: 60840,
    });
    // The export holds no room list: the unit types are derived and the stays wait for units (flagged, not hidden).
    const ex = await withTenantTx(h.t.db, org.admin, (tx) =>
      db(tx)
        .selectFrom('migration.exceptions')
        .select(['code'])
        .where('job_id', '=', job.id)
        .where('status', '=', 'open')
        .execute(),
    );
    expect(new Set(ex.map((e) => e.code))).toEqual(
      new Set(['unit_type_derived', 'in_house_without_balance', 'inventory_conflict']),
    );
  });

  it('the guesthouse pack as one Excel workbook gives the same records as the CSV files', async () => {
    const org = await setupOrg(h, { environment: 'trial' });
    const lead = org.user('Lead', ALL_MIGRATION);
    const job = await org.run(
      (tx) =>
        migration.createJob(tx, h.deps, {
          propertyId: org.propertyId,
          sourceAdapter: 'portico.pack.v1',
          sourceSystem: 'Workbook',
        }),
      lead,
    );
    const up = await migration.uploadFiles(h.t.db, h.deps, lead, job.id, {
      files: [sampleGuesthouseWorkbook(org.businessDate)],
    });
    expect(up.counts).toEqual({
      unit_type: 3,
      unit: 6,
      rate_plan: 2,
      guest: 6,
      reservation: 8,
      deposit: 2,
      in_house_balance: 1,
      ar_open_item: 2,
    });
    expect(up.review.every((r) => !r.needsConfirmation)).toBe(true);
  });
});
