/**
 * Demo data: a SIMULATED Channex connection for each demo resort (demo organizations never reach a real hub).
 * Channel codes are derived from the unit type and rate plan codes; every sellable product is mapped and the
 * connection is activated, so the first scheduler tick publishes the calendar to the simulator.
 */
import { sql, type TxContext } from '@portico/db';
import { WEBHOOK_TOKEN_HEADER } from './adapters/channex/wire';
import { type DistributionDeps, db } from './service/common';
import { activateConnection, createConnection } from './service/connections';
import { setRateMapping, setRoomMapping } from './service/mappings';
import { endpointIdFromUrl, webhookUrl } from './service/webhooks';

export async function seedDistributionDemo(
  tx: TxContext,
  deps: DistributionDeps,
  org: { properties: ReadonlyArray<{ id: string; code: string; profile: string }> },
): Promise<void> {
  if (tx.environment === 'live') return;
  for (const p of org.properties.filter((x) => x.profile === 'resort')) {
    const types = (await deps.ports.inventory.listUnitTypes(tx, p.id)).filter((t) => t.sellable);
    const plans = (await deps.ports.rates.listRatePlans(tx, p.id)).filter(
      (r) => r.status === 'active' && r.channels === null,
    );
    if (types.length === 0 || plans.length === 0) continue;
    const roomCode = (code: string) => `RT-${code}`;
    const rateCode = (ut: string, rp: string) => `RP-${ut}-${rp}`;
    const created = await createConnection(tx, deps, {
      propertyId: p.id,
      name: 'Channex (simulated)',
      simulator: {
        roomTypes: types.map((t) => roomCode(t.code)),
        ratePlans: types.flatMap((t) =>
          plans.map((r) => ({ id: rateCode(t.code, r.code), roomTypeId: roomCode(t.code) })),
        ),
      },
    });
    const c = created.connection;
    const endpointId = endpointIdFromUrl(c.webhook.url) as string;
    // The simulated hub learns where to send booking notifications (a real hub learns it through Verify).
    await deps.simulator.run(
      tx.tenantId,
      c.externalPropertyId,
      (s) => {
        s.webhook = {
          callbackUrl: webhookUrl(deps, endpointId),
          headers: { [WEBHOOK_TOKEN_HEADER]: created.webhookToken },
          sendData: true,
          active: true,
        };
      },
      { tx },
    );
    await db(tx)
      .updateTable('distribution.connections')
      .set({ credential_state: 'valid', webhook_registered_at: tx.now, version: sql`version + 1` })
      .where('id', '=', c.id)
      .execute();
    for (const t of types) {
      await setRoomMapping(tx, deps, c.id, { unitTypeId: t.id, channelRoomTypeId: roomCode(t.code) });
      for (const r of plans) {
        await setRateMapping(tx, deps, c.id, {
          unitTypeId: t.id,
          ratePlanId: r.id,
          channelRatePlanId: rateCode(t.code, r.code),
        });
      }
    }
    const fresh = await db(tx)
      .selectFrom('distribution.connections')
      .select('version')
      .where('id', '=', c.id)
      .executeTakeFirstOrThrow();
    await activateConnection(tx, deps, c.id, fresh.version);
  }
}
