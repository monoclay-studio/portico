import { sourcesFromManifests, withTenantTx } from '@portico/db';
import { newId } from '@portico/kernel';
import { createTestDatabase, type TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platform, platformManifest } from '../src';
import { makeOrg } from './helpers';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(sourcesFromManifests([platformManifest]));
});
afterAll(async () => t?.drop());

describe('data authority hardening (G-01, G-06, G-07)', () => {
  it('rejects external + exclusive and lists the tenth domain guestCommunications', async () => {
    const org = await makeOrg(t);
    const p = await org.property('DA1');
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.setDataAuthority(tx, {
          propertyId: p.id,
          domain: 'roomStatus',
          authority: 'external',
          connectionId: newId(),
          writeMode: 'exclusive',
          reason: 'try',
        }),
      ),
    ).rejects.toThrow('Use read-only or forward for an external system of record.');
    const list = await withTenantTx(t.db, org.as(), (tx) => platform.listDataAuthority(tx, p.id));
    expect(list).toHaveLength(10);
    expect(list.map((a) => a.domain)).toContain('guestCommunications');
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.setDataAuthority(tx, {
        propertyId: p.id,
        domain: 'guestCommunications',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy messaging',
        writeMode: 'read_only',
        reason: 'hotel keeps its messaging tool for now',
      }),
    );
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'guestCommunications')),
    ).rejects.toThrow(/Legacy messaging is the system of record/);
  });

  it('the database itself refuses external without a connection, and portico with one (G-07)', async () => {
    const org = await makeOrg(t);
    const p = await org.property('DA2');
    const insert = (authority: string, connectionId: string | null, writeMode: string) =>
      t.admin.kysely
        .insertInto('platform.data_authority')
        .values({
          id: newId(),
          tenant_id: org.tenantId,
          property_id: p.id,
          domain: 'rates',
          authority,
          connection_id: connectionId,
          write_mode: writeMode,
          effective_from: new Date(),
          updated_by: 'test',
          reason: 'direct insert',
        })
        .execute();
    await expect(insert('external', null, 'read_only')).rejects.toThrow(/data_authority_connection_check/);
    await expect(insert('portico', newId(), 'exclusive')).rejects.toThrow(/data_authority_connection_check/);
    await expect(insert('external', newId(), 'exclusive')).rejects.toThrow(/write_mode_combination_check/);
  });

  it('keeps an append-only version history (ST-13) and refuses direct changes of money domains (CR-10)', async () => {
    const org = await makeOrg(t);
    const p = await org.property('DA3');
    const conn = newId();
    for (const writeMode of ['read_only', 'forward'] as const) {
      await withTenantTx(t.db, org.as(), (tx) =>
        platform.setDataAuthority(tx, {
          propertyId: p.id,
          domain: 'roomStatus',
          authority: 'external',
          connectionId: conn,
          systemName: 'OPERA',
          writeMode,
          reason: `step ${writeMode}`,
        }),
      );
    }
    const history = await withTenantTx(t.db, org.as(), (tx) =>
      platform.listDataAuthorityHistory(tx, p.id, 'roomStatus'),
    );
    expect(history.map((h) => [h.version, h.writeMode, h.effectiveTo === null])).toEqual([
      [1, 'read_only', false],
      [2, 'forward', true],
    ]);
    await expect(
      t.db.kysely.transaction().execute(async (trx) => {
        const { sql } = await import('@portico/db');
        await sql`select set_config('app.tenant_id', ${org.tenantId}, true)`.execute(trx);
        await trx.deleteFrom('platform.data_authority_history').where('property_id', '=', p.id).execute();
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      withTenantTx(t.db, org.as(), (tx) =>
        platform.setDataAuthority(tx, {
          propertyId: p.id,
          domain: 'charges',
          authority: 'external',
          connectionId: conn,
          writeMode: 'read_only',
          reason: 'keep folios in PMS',
        }),
      ),
    ).rejects.toMatchObject({ code: 'second_approval_required' });
  });
});

describe('authority transitions (G-02, source-of-truth-matrix §6)', () => {
  it('plan → approve by someone else → freeze blocks writes → effective writes history once', async () => {
    const org = await makeOrg(t);
    const p = await org.property('TR1');
    const planner = newId();
    const approver = newId();
    const conn = newId();
    const plan = await withTenantTx(t.db, org.as(planner), (tx) =>
      platform.planAuthorityTransition(tx, p.id, {
        changes: [
          {
            domain: 'charges',
            authority: 'external',
            connectionId: conn,
            systemName: 'OPERA',
            writeMode: 'read_only',
          },
          {
            domain: 'roomStatus',
            authority: 'external',
            connectionId: conn,
            systemName: 'OPERA',
            writeMode: 'forward',
          },
        ],
        reason: 'connect alongside OPERA',
        freezeMinutes: 30,
      }),
    );
    expect(plan).toMatchObject({ status: 'planned', approvalRequired: true });
    // A second open transition for the same domain is refused.
    await expect(
      withTenantTx(t.db, org.as(planner), (tx) =>
        platform.planAuthorityTransition(tx, p.id, {
          changes: [{ domain: 'roomStatus', authority: 'portico', writeMode: 'exclusive' }],
          reason: 'dup',
          freezeMinutes: 5,
        }),
      ),
    ).rejects.toMatchObject({ code: 'transition_already_open' });
    // Freeze before approval is refused; the planner cannot approve (ST-11).
    await expect(
      withTenantTx(t.db, org.as(planner), (tx) => platform.freezeAuthorityTransition(tx, plan.id)),
    ).rejects.toMatchObject({ code: 'approval_required' });
    await expect(
      withTenantTx(t.db, org.as(planner), (tx) => platform.approveAuthorityTransition(tx, plan.id)),
    ).rejects.toMatchObject({ code: 'segregation_of_duties' });
    await withTenantTx(t.db, org.as(approver), (tx) =>
      platform.approveAuthorityTransition(tx, plan.id, 'ok'),
    );
    // While planned, writes still work (Portico is still authoritative).
    expect(await withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'charges'))).toBe(
      'portico',
    );
    const frozen = await withTenantTx(t.db, org.as(planner), (tx) =>
      platform.freezeAuthorityTransition(tx, plan.id),
    );
    expect(frozen.expectedEndAt).not.toBeNull();
    // ST-07: during the freeze nobody may write in the moved domains.
    const err = await withTenantTx(t.db, org.as(), (tx) =>
      platform.assertWritable(tx, p.id, 'charges'),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'authority_transition_in_progress',
      status: 409,
      retryable: true,
      details: { expectedEndAt: frozen.expectedEndAt },
    });
    expect(
      await withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'reservations')),
    ).toBe('portico');
    // ST-08: pending forwarded operations block completion.
    const blocked = {
      transitionGuard: { pendingOperations: async () => [{ ref: 'op-1', description: 'room 101 clean' }] },
    };
    await expect(
      withTenantTx(t.db, org.as(planner), (tx) => platform.completeAuthorityTransition(tx, blocked, plan.id)),
    ).rejects.toMatchObject({ code: 'pending_operations' });
    const done = await withTenantTx(t.db, org.as(planner), (tx) =>
      platform.completeAuthorityTransition(tx, {}, plan.id),
    );
    expect(done.status).toBe('effective');
    await expect(
      withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'charges')),
    ).rejects.toMatchObject({
      code: 'external_system_of_record',
    });
    expect(await withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'roomStatus'))).toBe(
      'forward',
    );
    const history = await withTenantTx(t.db, org.as(), (tx) => platform.listDataAuthorityHistory(tx, p.id));
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.transitionId === plan.id && h.approvedBy === `user:${approver}`)).toBe(
      true,
    );
    const events = await t.admin.kysely
      .selectFrom('core.outbox')
      .select('type')
      .where('tenant_id', '=', org.tenantId)
      .where('type', '=', 'platform.dataAuthority.changed')
      .execute();
    expect(events).toHaveLength(2);
  });

  it('a cancelled transition releases the domains', async () => {
    const org = await makeOrg(t);
    const p = await org.property('TR2');
    const plan = await withTenantTx(t.db, org.as(), (tx) =>
      platform.planAuthorityTransition(tx, p.id, {
        changes: [
          { domain: 'roomStatus', authority: 'external', connectionId: newId(), writeMode: 'forward' },
        ],
        reason: 'pilot housekeeping',
        freezeMinutes: 5,
      }),
    );
    expect(plan.approvalRequired).toBe(false);
    await withTenantTx(t.db, org.as(), (tx) => platform.freezeAuthorityTransition(tx, plan.id));
    await withTenantTx(t.db, org.as(), (tx) =>
      platform.cancelAuthorityTransition(tx, plan.id, 'vendor not ready'),
    );
    expect(await withTenantTx(t.db, org.as(), (tx) => platform.assertWritable(tx, p.id, 'roomStatus'))).toBe(
      'portico',
    );
  });

  it('requires data-authority permission for the property', async () => {
    const org = await makeOrg(t);
    const p = await org.property('TR3');
    const other = await org.property('TR4');
    const scoped = org.as(newId(), [
      { permission: 'platform.dataAuthority.manage', propertyIds: [other.id] },
    ]);
    await expect(
      withTenantTx(t.db, scoped, (tx) =>
        platform.planAuthorityTransition(tx, p.id, {
          changes: [{ domain: 'roomStatus', authority: 'portico', writeMode: 'exclusive' }],
          reason: 'x',
          freezeMinutes: 5,
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
