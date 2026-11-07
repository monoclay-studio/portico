/**
 * ADR-0015: inventory's PORT surface (`inventoryProvider`). The calling module authorized the user's intent at a
 * property; inventory does not re-check its own keys for that user, but refuses records of another property
 * (`scope_mismatch`), keeps sensitive effects explicit, and its own service/HTTP checks are unchanged.
 */

import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryProvider } from '../src';
import {
  assertLedgerConsistent,
  createInventoryTestDatabase,
  inventory,
  setupProperty,
  stay,
  unitTypeWithUnits,
} from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await createInventoryTestDatabase();
});
afterAll(async () => {
  if (t) await assertLedgerConsistent(t);
  await t?.drop();
});

const N = { from: '2026-11-10', to: '2026-11-12' };
const port = inventoryProvider(inventory);
/** A desk user of another module: holds that module's keys, none of inventory's. */
const DESK = ['reservations.booking.create', 'operations.maintenance.manage'];

describe('inventory port surface (ADR-0015)', () => {
  it('does not re-check inventory keys for a caller that authorized its own command at the property', async () => {
    const p = await setupProperty(t);
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'BV', count: 2 });
    const guest = stay();
    await p.as(DESK, async (tx) => {
      await port.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: guest,
      });
      await port.assignUnit(tx, {
        propertyId: p.propertyId,
        unitId: unitIds[0] as string,
        ref: guest,
        nights: N,
      });
      const units = await port.listUnits(tx, p.propertyId);
      expect(units).toHaveLength(2);
      const cells = await port.getAvailability(tx, {
        propertyId: p.propertyId,
        unitTypeIds: [type.id],
        range: N,
      });
      expect(cells.every((c) => c.sold === 1)).toBe(true);
      const block = await port.blockUnit(tx, {
        propertyId: p.propertyId,
        unitId: unitIds[1] as string,
        nights: N,
        kind: 'out_of_order',
        reason: 'Chiller failure on the jetty',
      });
      await port.releaseBlock(tx, { propertyId: p.propertyId, blockId: block.blockId, reason: 'Repaired' });
      await port.release(tx, { propertyId: p.propertyId, ref: guest });
    });
    // The service itself (used by inventory's own HTTP routes) still checks inventory's keys.
    await expect(
      p.as(DESK, (tx) =>
        inventory.blockUnit(tx, {
          unitId: unitIds[1] as string,
          nights: N,
          kind: 'out_of_order',
          reason: 'x'.repeat(5),
        }),
      ),
    ).rejects.toThrow(/inventory.block.manage/);
  });

  it('refuses records of another property and keeps sensitive effects explicit', async () => {
    const p = await setupProperty(t);
    const other = await p.run(async (tx) => {
      const le = await platform.createLegalEntity(tx, {
        name: 'Sister',
        legalName: 'Sister Pvt Ltd',
        countryCode: 'MV',
        baseCurrency: 'USD',
      });
      return platform.createProperty(tx, {
        code: 'SIS',
        name: 'Sister Island',
        profile: 'resort',
        legalEntityId: le.id,
        countryCode: 'MV',
        timezone: 'Indian/Maldives',
        baseCurrency: 'USD',
        businessDate: '2026-11-07',
      });
    });
    const { type, unitIds } = await unitTypeWithUnits(p, { code: 'WV', count: 1 });
    const guest = stay();
    await p.run((tx) =>
      inventory.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: guest,
      }),
    );
    // Authorized at the sister property: a unit, block or stay of the first property is refused.
    await expect(
      p.as(DESK, (tx) =>
        port.assignUnit(tx, { propertyId: other.id, unitId: unitIds[0] as string, ref: guest, nights: N }),
      ),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(
      p.as(DESK, (tx) =>
        port.blockUnit(tx, {
          propertyId: other.id,
          unitId: unitIds[0] as string,
          nights: N,
          kind: 'out_of_order',
          reason: 'Leak',
        }),
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      p.as(DESK, (tx) => port.release(tx, { propertyId: other.id, ref: guest })),
    ).rejects.toMatchObject({
      code: 'scope_mismatch',
    });
    await expect(
      p.as(DESK, (tx) => port.getUnit(tx, unitIds[0] as string, { propertyId: other.id })),
    ).rejects.toMatchObject({ code: 'scope_mismatch' });
    await expect(
      p.as(DESK, (tx) =>
        port.consume(tx, { propertyId: other.id, unitTypeId: type.id, nights: N, quantity: 1, ref: stay() }),
      ),
    ).rejects.toThrow();
    // Sold out: overbooking only with the explicit capability argument; a house-use block is never implied.
    const second = stay();
    await expect(
      p.as(DESK, (tx) =>
        port.consume(tx, {
          propertyId: p.propertyId,
          unitTypeId: type.id,
          nights: N,
          quantity: 1,
          ref: second,
        }),
      ),
    ).rejects.toMatchObject({ code: 'inventory_unavailable' });
    await p.as(DESK, (tx) =>
      port.consume(tx, {
        propertyId: p.propertyId,
        unitTypeId: type.id,
        nights: N,
        quantity: 1,
        ref: second,
        overbooking: { authorizedBy: 'Duty manager', reason: 'VIP walk-in, relocation agreed' },
      }),
    );
    await expect(
      p.as(DESK, (tx) =>
        port.blockUnit(tx, {
          propertyId: p.propertyId,
          unitId: unitIds[0] as string,
          nights: N,
          kind: 'house_use',
          reason: 'Owner stay',
        }),
      ),
    ).rejects.toThrow(/inventory.houseUse.create/);
  });
});
