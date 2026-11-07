/**
 * Readiness all day (DCL-R01) and what blocks (policy per property), overrides with permission and reason
 * (EC-DCL-008/009), the integrity gate (DCL-I02, EC-DCL-006), fail-closed policy, and sources that cannot be read.
 */
import { sql } from '@portico/db';
import { money, newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addStay,
  businessDate,
  D,
  type Harness,
  nightAudit,
  type Org,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function departedWithBalance(org: Org) {
  const s = await addStay(h, org, { arrival: '2026-11-05', departure: '2026-11-07' });
  await org.run(async (tx) => {
    await h.finance.postCharge(tx, {
      propertyId: org.propertyId,
      target: { type: 'stay', id: s.stayId },
      chargeCode: 'FB_ALACARTE',
      amount: money(4_200, 'USD'),
      serviceDate: D,
      description: 'Lunch',
      sourceRef: { type: 'pos_check', id: newId() },
      idempotencyKey: `pos:${s.stayId}`,
    });
    await h.finance.markOwnerDeparted(tx, {
      propertyId: org.propertyId,
      owner: { type: 'stay', id: s.stayId },
      departedOn: D,
    });
    await sql`update dcl_fake.stays set status = 'checked_out' where id = ${s.stayId}`.execute(tx.db);
  });
  return s;
}

describe('readiness: one running list with owners and fixes', () => {
  it('aggregates every source; each item has an owner and a fix; blocking is separate from warnings', async () => {
    const org = await setupOrg(h);
    const overstay = await addStay(h, org, { arrival: '2026-11-05', departure: D });
    const arrival = await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    const departed = await departedWithBalance(org);
    h.fakes.payments.pending.push({
      propertyId: org.propertyId,
      type: 'payment',
      id: newId(),
      amountMinor: 120_000,
      currency: 'USD',
      since: '2026-11-07T15:00:00.000Z',
    });
    h.fakes.integration.exceptions.push({
      propertyId: org.propertyId,
      id: newId(),
      severity: 'urgent',
      problem: 'The channel hub rejected 2 rate updates.',
      nextStep: 'Re-send after mapping the new room type.',
      responsibleParty: 'hotel',
      workflow: 'ari',
    });
    const [u1, u2] = [newId(), newId()];
    h.fakes.inventory.units.set(org.propertyId, [
      { id: u1, number: '101' },
      { id: u2, number: '102' },
    ]);
    h.fakes.operations.conditions.set(org.propertyId, [
      { unitId: u1, unitNumber: '101', condition: 'clean', discrepancy: 'skip' },
    ]);
    const auditor = nightAudit(h, org);
    const r = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    expect(r.unavailableSources).toEqual([]);
    expect(r.provenance).toBe('live');
    expect(r.canClose).toBe(false);
    expect(r.blocking.map((i) => [i.code, i.ref?.id])).toEqual([
      ['departure_not_checked_out', overstay.stayId],
    ]);
    const codes = r.warnings.map((i) => i.code).sort();
    expect(codes).toEqual(
      [
        'arrival_not_checked_in',
        'departed_with_balance',
        'integration_exception',
        'payment_pending_verification',
        'room_status_discrepancy',
        'unit_without_status',
      ].sort(),
    );
    expect(r.warnings.find((w) => w.code === 'arrival_not_checked_in')?.ref?.id).toBe(arrival.stayId);
    expect(r.summary).toBe('1 thing to settle before today can close, 6 warnings.');
    // Owners resolve to the property's departments; every item carries at least one fix.
    const depts = await org.run((tx) => platform.listDepartments(tx, org.propertyId));
    const fo = depts.find((d) => d.kind === 'front_office');
    expect(r.blocking[0]?.owner).toEqual({ kind: 'department', id: fo?.id, name: 'Front office' });
    for (const i of [...r.blocking, ...r.warnings]) expect(i.actions.length).toBeGreaterThan(0);
    // 10x "friendly": no blocking item without a one-click action the night auditor can take.
    for (const i of r.blocking) expect(i.actions.some((a) => a.enabled)).toBe(true);
    expect(r.blocking[0]?.actions.map((a) => a.action)).toEqual(['checkOut', 'extendStay', 'override']);
    // The finance item points at the folio of the departed guest.
    expect(r.warnings.find((w) => w.code === 'departed_with_balance')?.details.balanceMinor).toBeGreaterThan(
      0,
    );
    void departed;
    // A viewer without the permissions sees the fixes disabled with the reason.
    const viewer = org.as(['dayClose.run.read'], [org.propertyId], 'Viewer');
    const v = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), viewer);
    const checkOut = v.blocking[0]?.actions.find((a) => a.action === 'checkOut');
    expect(checkOut).toMatchObject({
      enabled: false,
      reason: 'Needs the reservations.stay.checkOut permission.',
    });
  });

  it('a source that cannot be read is listed as missing, never treated as "nothing open"', async () => {
    const org = await setupOrg(h);
    const original = h.ports.integration.listOpenExceptions;
    h.ports.integration.listOpenExceptions = async () => {
      throw new Error('connection reset');
    };
    try {
      const r = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), nightAudit(h, org));
      expect(r.unavailableSources.map((s) => s.source)).toEqual(['integration']);
      expect(r.provenance).toBe('incomplete');
      expect(r.summary).toMatch(/1 check could not run/);
    } finally {
      h.ports.integration.listOpenExceptions = original;
    }
  });
});

describe('blocking, overrides and policy', () => {
  it('a blocking item stops the run; an override needs the permission and a reason; resume completes (EC-DCL-009)', async () => {
    const org = await setupOrg(h);
    const overstay = await addStay(h, org, { arrival: '2026-11-05', departure: D });
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('blocked');
    expect(run.blockers.map((b) => b.code)).toEqual(['departure_not_checked_out']);
    expect(run.summary).toBe('1 thing to settle before Day Close can continue.');
    expect(await businessDate(org)).toBe(D);
    // Duty roles are notified (comms delivers; the request records the delivery mode).
    const blocked = await h.t.admin.kysely
      .selectFrom('core.outbox')
      .select('payload')
      .where('tenant_id', '=', org.tenantId)
      .where('type', '=', 'dayClose.run.blocked')
      .execute();
    expect(blocked).toHaveLength(1);
    expect((blocked[0] as { payload: { notification: { mode: string } } }).payload.notification.mode).toBe(
      'live',
    );
    const key = run.blockers[0]?.key as string;
    // Without the permission: refused. Without a reason: refused. Nothing recorded.
    const noRight = org.as(['dayClose.run.read', 'dayClose.run.resume'], [org.propertyId]);
    await expect(
      org.run(
        (tx) => h.service.overrideItem(tx, run.id, { itemKey: key, reason: 'guest left by boat' }),
        noRight,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      org.run((tx) => h.service.overrideItem(tx, run.id, { itemKey: key, reason: '  ' }), auditor),
    ).rejects.toMatchObject({ code: 'override_reason_required' });
    const reason = 'Guest left on the 06:00 speedboat without checking out; folio settled by card.';
    const after = await org.run(
      (tx) => h.service.overrideItem(tx, run.id, { itemKey: key, reason }),
      auditor,
    );
    expect(after.overrides).toEqual([
      expect.objectContaining({ itemKey: key, code: 'departure_not_checked_out', reason }),
    ]);
    await expect(
      org.run((tx) => h.service.overrideItem(tx, run.id, { itemKey: key, reason }), auditor),
    ).rejects.toMatchObject({ code: 'already_overridden' });
    const done = await h.service.resumeRun(h.t.db, auditor, run.id, after.version);
    expect(done.runStatus).toBe('completed');
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    expect(report.pack.overrides).toEqual([expect.objectContaining({ itemKey: key, reason })]);
    const audit = await h.t.admin.kysely
      .selectFrom('core.audit_log')
      .select(['action', 'reason'])
      .where('tenant_id', '=', org.tenantId)
      .where('action', '=', 'dayClose.exception.override')
      .execute();
    expect(audit).toEqual([{ action: 'dayClose.exception.override', reason }]);
    void overstay;
  });

  it('policy decides what blocks: departures demoted to warnings; pending payments promoted to blocking (S05)', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-05', departure: D });
    h.fakes.payments.pending.push({
      propertyId: org.propertyId,
      type: 'payment',
      id: newId(),
      amountMinor: 50_000,
      currency: 'USD',
      since: '2026-11-07T15:00:00.000Z',
    });
    const auditor = nightAudit(h, org);
    const p = await org.run((tx) => h.service.getPolicy(tx, org.propertyId), auditor);
    await org.run((tx) =>
      h.service.updatePolicy(
        tx,
        org.propertyId,
        {
          policy: {
            warningCodes: ['departure_not_checked_out'],
            blockingCodes: ['payment_pending_verification'],
          },
          reason:
            'Island guesthouse: guests leave on the early ferry; unverified payments must be checked first',
        },
        p.version,
      ),
    );
    const r = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    expect(r.blocking.map((i) => i.code)).toEqual(['payment_pending_verification']);
    expect(r.warnings.map((i) => i.code)).toContain('departure_not_checked_out');
    // Saving a policy that would demote an integrity check is refused (and changes nothing).
    const p2 = await org.run((tx) => h.service.getPolicy(tx, org.propertyId), auditor);
    await expect(
      org.run((tx) =>
        h.service.updatePolicy(
          tx,
          org.propertyId,
          { policy: { warningCodes: ['entry_unbalanced'] }, reason: 'try' },
          p2.version,
        ),
      ),
    ).rejects.toMatchObject({ code: 'policy_unusable' });
    expect(
      (await org.run((tx) => h.service.getPolicy(tx, org.propertyId), auditor)).policy.blockingCodes,
    ).toEqual(['payment_pending_verification']);
    // A stale If-Match is refused.
    await expect(
      org.run((tx) => h.service.updatePolicy(tx, org.propertyId, { policy: {}, reason: 'stale' }, 0)),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    // Changing the policy needs the sensitive permission.
    await expect(
      org.run(
        (tx) => h.service.updatePolicy(tx, org.propertyId, { policy: {}, reason: 'x' }, p2.version),
        org.as(['dayClose.run.read', 'dayClose.run.start']),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('an unreadable stored policy fails closed: defaults apply and a non-overridable blocking item says what to fix', async () => {
    const org = await setupOrg(h);
    await org.run((tx) =>
      platform.setPolicy(tx, {
        key: 'dayClose.policy',
        scopeType: 'property',
        scopeId: org.propertyId,
        value: { warningCodes: 'all of them', noShow: { mode: 'sometimes' } },
        reason: 'typo',
      }),
    );
    const r = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), nightAudit(h, org));
    const item = r.blocking.find((i) => i.code === 'policy_invalid');
    expect(item).toMatchObject({ blocking: true, overridable: false });
    expect(item?.actions.map((a) => a.action)).toEqual(['editPolicy']);
  });
});

describe('integrity gate (DCL-I02, EC-DCL-006)', () => {
  it('a failed integrity check stops before the advance, raises an alarm to finance, is never overridden or auto-retried', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    h.fakes.inventory.discrepancies = [{ unitTypeId: newId(), night: D, sold: 3, consumed: 2 }];
    let run: Awaited<ReturnType<typeof h.service.startRun>>;
    try {
      run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
      expect(run.runStatus).toBe('failed');
      expect(run.failure).toMatchObject({
        step: 'integrity',
        code: 'integrity_failed',
        retryable: false,
        integrity: true,
      });
      expect(run.execution.nextRetryAt).toBeNull();
      expect(await businessDate(org)).toBe(D);
      const issue = (await org.run((tx) => h.service.listIssues(tx, org.propertyId), auditor)).find(
        (i) => i.code === 'integrity_failed',
      );
      expect(issue).toMatchObject({ severity: 'blocking', owner: { kind: 'department', id: 'finance' } });
      const ready = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
      const alarm = ready.blocking.find((i) => i.code === 'integrity_failed');
      expect(alarm).toMatchObject({ overridable: false });
      await expect(
        org.run(
          (tx) => h.service.overrideItem(tx, run.id, { itemKey: alarm?.key as string, reason: 'skip it' }),
          auditor,
        ),
      ).rejects.toMatchObject({ code: 'integrity_not_overridable' });
      await expect(
        org.run(
          (tx) => h.service.resolveIssue(tx, issue?.id as string, issue?.version as number, 'fixed'),
          auditor,
        ),
      ).rejects.toMatchObject({ code: 'integrity_not_resolvable' });
    } finally {
      h.fakes.inventory.discrepancies = [];
    }
    // Finance corrected the cause; resume re-runs the integrity step only; the alarm closes itself.
    const done = await h.service.resumeRun(h.t.db, auditor, run.id, run.version);
    expect(done.runStatus).toBe('completed');
    expect(done.steps.find((s) => s.key === 'integrity')?.attempts).toBe(2);
    expect(done.steps.find((s) => s.key === 'room_and_package_postings')?.attempts).toBe(1);
    const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), auditor);
    expect(issues.filter((i) => i.code === 'integrity_failed')).toEqual([]);
    expect(await businessDate(org)).toBe('2026-11-08');
  });

  it('the database refuses to complete the advance step unless integrity completed in the same run', async () => {
    const org = await setupOrg(h);
    const run = await org.run(
      (tx) => h.service.createRun(tx, { propertyId: org.propertyId }),
      nightAudit(h, org),
    );
    await expect(
      org.run((tx) =>
        sql`update day_close.steps set status = 'completed' where run_id = ${run.run.id} and key = 'advance'`.execute(
          tx.db,
        ),
      ),
    ).rejects.toThrow(/integrity step/);
  });
});
