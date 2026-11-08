/**
 * A global claim on a production hub property is taken only by proof of control (review P2-6; probe B7 inverted):
 * creating a connection proves nothing and blocks no one; the first successful Verify claims the hub property; a
 * later Verify of the same hub property is refused before any hub call; a race between two proofs is decided by
 * the directory's unique index. (Live organizations cannot reach a hub in tests — the live scope refuses — so the
 * proof is recorded directly where noted.)
 */
import { sql, withTenantTx } from '@portico/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as svc from '../src/services';
import { connect, type Harness, type Org, setupOrg, startHarness, sys } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const HUB_PROPERTY = 'real-hotel-channex-property';

const create = (org: Org, name: string) =>
  org.run((tx) =>
    svc.createConnection(tx, h.dist.deps, {
      propertyId: org.propertyId,
      name,
      externalPropertyId: HUB_PROPERTY,
      apiKey: `prod-key-${name}-not-real`,
    }),
  );

/** Record a successful proof (what Verify writes) for a live connection that cannot reach a hub in tests. */
const recordProof = (org: Org, connectionId: string) =>
  withTenantTx(h.t.db, sys(org), (tx) =>
    sql`update distribution.connections set verified_at = now() where id = ${connectionId}::uuid`.execute(
      tx.db,
    ),
  );

describe('claiming a production hub property (P2-6)', () => {
  it('B7 inverted: an unverified connection blocks no one; the proven one refuses later proofs before any hub call', async () => {
    const squatter = await setupOrg(h, { environment: 'live' });
    const hotel = await setupOrg(h, { environment: 'live' });
    const sq = await create(squatter, 'Squat');
    // Creating proves nothing: the real hotel can create its own connection to the same hub property.
    const real = await create(hotel, 'Kandu');
    await recordProof(hotel, real.connection.id);
    const sent = h.httpSent.length;
    await expect(
      svc.verifyConnection(h.t.db, h.dist.deps, squatter.ctx, sq.connection.id),
    ).rejects.toMatchObject({
      code: 'hub_property_claimed',
    });
    expect(h.httpSent.length).toBe(sent); // refused before any hub call
  });

  it('two proofs racing for one hub property: the directory admits one', async () => {
    const a = await setupOrg(h, { environment: 'live' });
    const b = await setupOrg(h, { environment: 'live' });
    const ca = await a.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: a.propertyId,
        name: 'A',
        externalPropertyId: 'race-hub-property',
        apiKey: 'prod-key-a-not-real',
      }),
    );
    const cb = await b.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: b.propertyId,
        name: 'B',
        externalPropertyId: 'race-hub-property',
        apiKey: 'prod-key-b-not-real',
      }),
    );
    await recordProof(a, ca.connection.id);
    await expect(recordProof(b, cb.connection.id)).rejects.toMatchObject({ code: '23505' });
  });

  it('a disconnected proven connection releases the claim', async () => {
    const a = await setupOrg(h, { environment: 'live' });
    const b = await setupOrg(h, { environment: 'live' });
    const ca = await a.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: a.propertyId,
        name: 'A',
        externalPropertyId: 'moved-hub-property',
        apiKey: 'prod-key-a-not-real',
      }),
    );
    await recordProof(a, ca.connection.id);
    await a.run((tx) =>
      svc.disconnectConnection(tx, h.dist.deps, ca.connection.id, ca.connection.version, 'moved'),
    );
    const cb = await b.run((tx) =>
      svc.createConnection(tx, h.dist.deps, {
        propertyId: b.propertyId,
        name: 'B',
        externalPropertyId: 'moved-hub-property',
        apiKey: 'prod-key-b-not-real',
      }),
    );
    await expect(recordProof(b, cb.connection.id)).resolves.toBeDefined();
  });

  it('sibling: a failed Verify is recorded (committed) before it is reported — a refused key stays refused', async () => {
    const org = await setupOrg(h);
    const c = await connect(org);
    await org.run((tx) =>
      svc.injectFault(tx, h.dist.deps, c.connectionId, {
        endpoint: 'property',
        kind: 'unauthorized',
        times: 1,
      }),
    );
    await expect(svc.verifyConnection(h.t.db, h.dist.deps, org.ctx, c.connectionId)).rejects.toMatchObject({
      code: 'hub_verification_failed',
    });
    const conn = await org.run((tx) => svc.getConnection(tx, h.dist.deps, c.connectionId));
    expect(conn.status.credentials).toBe('invalid');
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.map((e) => e.code)).toContain('credentials_invalid');
  });
});
