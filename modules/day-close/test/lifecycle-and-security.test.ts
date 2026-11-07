/**
 * Run lifecycle (cancel with nothing posted, previous run first, earliest start, connected mode, entitlement),
 * isolation and permissions (another organization, another property, the sensitive advance permission),
 * environment safety (non-live organizations simulate notifications), records, search and immutability.
 */
import { withTenantTx } from '@portico/db';
import { ROLE_TEMPLATES } from '@portico/identity';
import { newId, staticAuthorizer, systemAuthorizer } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY_CLOSE_ROLE_GRANTS, dayCloseSearch, SimulatedCrash } from '../src';
import {
  addStay,
  businessDate,
  checkOut,
  D,
  entriesByKey,
  type Harness,
  NIGHT,
  nightAudit,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

describe('the 10x attention target: a normal day is one page and one press', () => {
  it('a day with nothing blocking: readiness says so in one sentence; one Start closes the day; nobody else acts', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 40; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    const page = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    expect(page.summary).toBe('Ready to close: nothing open.');
    expect(page.canClose).toBe(true);
    const started = Date.now();
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId }); // the only human action
    const seconds = (Date.now() - started) / 1000;
    expect(run.runStatus).toBe('completed');
    expect(run.summary).toBe('Day closed: business date advanced to 2026-11-08.');
    expect(seconds).toBeLessThan(60); // machine time for 40 stay-nights; the auditor is free meanwhile
    const human = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action', 'actor_key'])
      .where('tenant_id', '=', org.tenantId)
      .where('action', 'like', 'dayClose.%')
      .where('actor_key', 'like', 'user:%')
      .execute();
    // Every Day Close audit entry of this close comes from the one Start (no overrides, resumes or fixes needed).
    expect(new Set(human.map((x) => x.action))).toEqual(
      new Set(['dayClose.run.start', 'dayClose.businessDate.advanced', 'dayClose.run.complete']),
    );
  });
});

describe('lifecycle', () => {
  it('a blocked run can be cancelled with a reason (nothing posted) and a new one started; never after postings', async () => {
    const org = await setupOrg(h);
    const overstay = await addStay(h, org, { arrival: '2026-11-05', departure: D });
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    const blocked = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(blocked.runStatus).toBe('blocked');
    expect(blocked.allowedActions.find((a) => a.action === 'cancel')?.enabled).toBe(true);
    const cancelled = await org.run(
      (tx) => h.service.cancelRun(tx, blocked.id, blocked.version, 'Started too early by mistake'),
      auditor,
    );
    expect(cancelled.runStatus).toBe('cancelled');
    expect(await entriesByKey(h, org.tenantId, 'room:')).toEqual([]);
    // Cancelled is final (DB trigger), and a new run can start for the same date.
    await expect(
      org.run((tx) =>
        tx.db
          .updateTable('day_close.runs')
          .set({ status: 'preflight' })
          .where('id', '=', blocked.id)
          .execute(),
      ),
    ).rejects.toThrow(/cannot change/);
    await checkOut(org, overstay.stayId);
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(run.id).not.toBe(blocked.id);
    expect(run.runStatus).toBe('completed');
    // A run that posted cannot be cancelled.
    await expect(
      org.run((tx) => h.service.cancelRun(tx, run.id, run.version, 'no'), auditor),
    ).rejects.toMatchObject({
      code: 'run_not_cancellable',
    });
  });

  it('the next date cannot close before the previous run completed (it stopped after the advance)', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10' });
    const auditor = nightAudit(h, org);
    await expect(
      h.service.startRun(h.t.db, auditor, {
        propertyId: org.propertyId,
        hooks: {
          beforeStep: (s) => (s === 'post_advance' ? Promise.reject(new SimulatedCrash('x')) : undefined),
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    expect(await businessDate(org)).toBe('2026-11-08');
    await expect(
      org.run((tx) => h.service.createRun(tx, { propertyId: org.propertyId }), auditor),
    ).rejects.toMatchObject({ code: 'previous_run_incomplete' });
  });

  it('refuses a start before the earliest local time, for another date, in connected mode, or without the entitlement', async () => {
    const org = await setupOrg(h);
    const auditor = nightAudit(h, org);
    await org.run(async (tx) => {
      const p = await h.service.getPolicy(tx, org.propertyId);
      await h.service.updatePolicy(
        tx,
        org.propertyId,
        { policy: { earliestStartLocalTime: '23:00' }, reason: 'close after the last restaurant shift' },
        p.version,
      );
    });
    h.clock.set('2026-11-07T15:00:00.000Z'); // 20:00 in Malé
    await expect(
      org.run((tx) => h.service.createRun(tx, { propertyId: org.propertyId }), auditor),
    ).rejects.toMatchObject({
      code: 'too_early_to_close',
      details: { earliestStartAt: '2026-11-07T18:00:00.000Z' },
    });
    h.clock.set(NIGHT);
    await expect(
      org.run(
        (tx) => h.service.createRun(tx, { propertyId: org.propertyId, businessDate: '2026-11-06' }),
        auditor,
      ),
    ).rejects.toMatchObject({ code: 'not_current_business_date' });
    await org.run((tx) =>
      platform.setDataAuthority(
        { ...tx, actor: { kind: 'system', process: 'test' }, authz: systemAuthorizer },
        {
          propertyId: org.propertyId,
          domain: 'reservations',
          authority: 'external',
          connectionId: newId(),
          systemName: 'OPERA Cloud',
          writeMode: 'read_only',
          reason: 'connected mode',
        },
      ),
    );
    await expect(
      org.run((tx) => h.service.createRun(tx, { propertyId: org.propertyId }), auditor),
    ).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
    // Charges kept in another system: refused the same way.
    const charges = await setupOrg(h);
    await charges.run((tx) =>
      platform.setDataAuthority(
        { ...tx, actor: { kind: 'system', process: 'test' }, authz: systemAuthorizer },
        {
          propertyId: charges.propertyId,
          domain: 'charges',
          authority: 'external',
          connectionId: newId(),
          systemName: 'Infor HMS',
          writeMode: 'read_only',
          reason: 'connected mode',
        },
      ),
    );
    await expect(
      charges.run((tx) => h.service.createRun(tx, { propertyId: charges.propertyId }), charges.auditor),
    ).rejects.toMatchObject({ code: 'external_system_of_record', details: { domain: 'charges' } });
    const connect = await setupOrg(h, { planCode: 'connect' });
    await expect(
      connect.run((tx) => h.service.createRun(tx, { propertyId: connect.propertyId }), connect.auditor),
    ).rejects.toMatchObject({ code: 'feature_not_enabled' });
  });
});

describe('isolation and permissions', () => {
  it('another organization cannot read, resume or override a run by id; another property is refused', async () => {
    const org = await setupOrg(h);
    const other = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-05', departure: D });
    const run = await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    expect(run.runStatus).toBe('blocked');
    await expect(other.run((tx) => h.service.getRun(tx, run.id), other.auditor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(h.service.resumeRun(h.t.db, other.auditor, run.id, run.version)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      other.run(
        (tx) =>
          h.service.overrideItem(tx, run.id, { itemKey: run.blockers[0]?.key as string, reason: 'mine' }),
        other.auditor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    // Same organization, user scoped to another property: refused and not even visible.
    const elsewhere = org.as(
      ['dayClose.*', 'platform.businessDate.advance'],
      [newId()],
      'Other property auditor',
    );
    await expect(org.run((tx) => h.service.getRun(tx, run.id), elsewhere)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      org.run((tx) => h.service.getReadiness(tx, org.propertyId), elsewhere),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(h.service.startRun(h.t.db, elsewhere, { propertyId: org.propertyId })).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
    // Search and hover previews respect the same scope.
    const hits = await org.run((tx) => dayCloseSearch.search(tx, D, { limit: 5 }), org.auditor);
    expect(hits.map((x) => x.id)).toEqual([run.id]);
    expect(await org.run((tx) => dayCloseSearch.search(tx, D, { limit: 5 }), elsewhere)).toEqual([]);
    expect(
      await other.run(
        async (tx) => (await dayCloseSearch.summarize?.(tx, 'day_close_run', run.id)) ?? null,
        other.auditor,
      ),
    ).toBeNull();
  });

  it('executing a run needs the start or resume permission at its property (a reader cannot drive it)', async () => {
    const org = await setupOrg(h);
    const { run } = await org.run(
      (tx) => h.service.createRun(tx, { propertyId: org.propertyId }),
      nightAudit(h, org),
    );
    const reader = org.as(['dayClose.run.read'], [org.propertyId], 'Reader');
    await expect(h.service.executeRun(h.t.db, reader, run.id)).rejects.toMatchObject({ code: 'forbidden' });
    const view = await org.run((tx) => h.service.getRun(tx, run.id), org.auditor);
    expect(view.execution.executions).toEqual([]);
  });

  it('advancing needs platform.businessDate.advance on the person: without it the run stops before the date moves', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    nightAudit(h, org);
    const helper = org.as(['dayClose.*'], [org.propertyId], 'Desk helper');
    const run = await h.service.startRun(h.t.db, helper, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('failed');
    expect(run.failure).toMatchObject({ step: 'advance', code: 'forbidden', retryable: false });
    expect(await businessDate(org)).toBe(D);
    const done = await h.service.resumeRun(h.t.db, org.auditor, run.id, run.version);
    expect(done.runStatus).toBe('completed');
    expect(await businessDate(org)).toBe('2026-11-08');
  });

  it("identity's night-auditor template holds every grant Day Close needs; the role grants are documented", () => {
    const tpl = ROLE_TEMPLATES.find((r) => r.key === 'night_auditor')?.permissions ?? [];
    const authz = staticAuthorizer(tpl.map((permission) => ({ permission, propertyIds: 'all' as const })));
    for (const g of DAY_CLOSE_ROLE_GRANTS.night_auditor)
      expect(authz.can(g.replace('.*', '.run.start'), { propertyId: newId() })).toBe(true);
    const gm = ROLE_TEMPLATES.find((r) => r.key === 'general_manager')?.permissions ?? [];
    expect(gm).toContain('dayClose.*');
    expect(gm).toContain('platform.businessDate.advance');
  });
});

describe('environment safety and immutability', () => {
  it('a demo organization closes its day with notifications simulated, never sent', async () => {
    const org = await setupOrg(h, { environment: 'demo' });
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const run = await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    expect(run.runStatus).toBe('completed');
    expect(run.notifications.mode).toBe('simulate');
    expect(run.provenance).toBe('simulated');
    const events = await h.t.admin.kysely
      .selectFrom('core.outbox')
      .select(['type', 'payload'])
      .where('tenant_id', '=', org.tenantId)
      .where('type', 'in', ['dayClose.run.started', 'dayClose.run.completed'])
      .execute();
    expect(events).toHaveLength(2);
    for (const e of events)
      expect((e.payload as { notification: { mode: string } }).notification.mode).toBe('simulate');
  });

  it('day facts and reports are immutable; the stay-night register is append-only', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    const tx = <T>(fn: Parameters<typeof withTenantTx<T>>[2]) => withTenantTx(h.t.db, org.admin, fn);
    await expect(
      tx((t) =>
        t.db.updateTable('day_close.day_facts').set({ facts: '{}' }).where('business_date', '=', D).execute(),
      ),
    ).rejects.toThrow();
    await expect(
      tx((t) => t.db.deleteFrom('day_close.day_reports').where('business_date', '=', D).execute()),
    ).rejects.toThrow();
    await expect(
      tx((t) => t.db.deleteFrom('day_close.night_postings').where('night', '=', D).execute()),
    ).rejects.toThrow();
    await expect(
      tx((t) =>
        t.db
          .updateTable('day_close.step_items')
          .set({ status: 'failed' })
          .where('status', '=', 'done')
          .execute(),
      ),
    ).rejects.toThrow(/never redone/);
    await expect(
      tx((t) =>
        t.db
          .updateTable('day_close.steps')
          .set({ status: 'pending' })
          .where('status', '=', 'completed')
          .execute(),
      ),
    ).rejects.toThrow(/never re-run/);
    await expect(
      tx((t) =>
        t.db
          .updateTable('day_close.runs')
          .set({ status: 'running' })
          .where('status', '=', 'completed')
          .execute(),
      ),
    ).rejects.toThrow(/cannot change/);
  });
});
