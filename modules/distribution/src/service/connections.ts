/**
 * Channel connections: create (credential stored encrypted, webhook token shown once), verify (credential test +
 * webhook registration at the hub, outside any transaction), activate (go-live checks: verified key, mapping
 * completeness, Portico authoritative for availability and rates, live scope), pause / resume / disconnect,
 * settings, key and token rotation, full and range resync (non-destructive: values are re-sent, nothing is
 * unlisted). Live organizations cannot activate a production connection until the live-scope port allows it.
 */
import { type PorticoDatabase, sql, type TxContext, withSavepoint, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  type DateRange,
  DomainError,
  newId,
  type RequestContext,
  randomToken,
  requirePermission,
  sha256Hex,
  ValidationError,
  VersionConflictError,
} from '@portico/kernel';
import { DEFAULT_LIMITS, WEBHOOK_TOKEN_HEADER } from '../adapters/channex/wire';
import { HubError } from '../adapters/hub';
import {
  type ConnectionSettings,
  type ConnectionView,
  type CreateConnectionInput,
  connectionSettings,
  createConnectionInput,
} from '../contracts';
import { ARI_KINDS, type AriKind } from '../domain/ari';
import { clipRanges } from '../domain/ranges';
import { P, RECORD } from '../manifest';
import { activeMappings, markDirty, windowFor } from './ari-dirty';
import {
  actorKey,
  type ConnectionRow,
  type DistributionDeps,
  db,
  hubContext,
  iso,
  json,
  loadConnection,
  provenanceOfTarget,
  recordExchange,
  requireOnConnection,
  scheduleTenant,
  settingsOf,
  targetForEnvironment,
} from './common';
import { autoResolve, markCredentialsInvalid, raiseException } from './exceptions';
import { completeness } from './mappings';
import { releaseProtection } from './stop-sell';
import { webhookUrl } from './webhooks';

export function connectionView(tx: TxContext, deps: DistributionDeps, c: ConnectionRow): ConnectionView {
  const can = tx.authz.can(P.connectionManage, { propertyId: c.property_id });
  const canResync = tx.authz.can(P.ariResync, { propertyId: c.property_id });
  const canRecover = tx.authz.can(P.reservationRecover, { propertyId: c.property_id });
  const act = (action: string, label: string, ok: boolean, why: string, allowed = can) => ({
    action,
    label,
    enabled: ok && allowed,
    ...(!ok ? { reason: why } : !allowed ? { reason: 'You do not have permission for this action.' } : {}),
  });
  const issues: ConnectionView['issues'] = [];
  if (c.credential_state === 'invalid') {
    issues.push({
      code: 'credentials_invalid',
      severity: 'blocking',
      message: 'The hub refused the API key: nothing is published to this channel.',
    });
  }
  if (c.credential_state === 'unverified' && c.status !== 'disconnected') {
    const inUse = c.status === 'active' || c.status === 'paused';
    issues.push({
      code: 'credentials_unverified',
      severity: inUse ? 'blocking' : 'warning',
      message: inUse
        ? 'A new API key was entered: nothing is sent to or acknowledged at the hub until it is verified.'
        : 'The API key has not been verified yet.',
    });
  }
  if (c.health !== 'connected' && c.status === 'active') {
    issues.push({
      code: `health_${c.health}`,
      severity: c.health === 'failing' ? 'blocking' : 'warning',
      message: c.health_reason ?? c.health,
    });
  }
  return {
    id: c.id,
    propertyId: c.property_id,
    hub: c.hub,
    name: c.name,
    target: c.target,
    externalPropertyId: c.external_property_id,
    channelCode: c.channel_code,
    provenance: provenanceOfTarget(c.target),
    status: { connection: c.status, health: c.health, credentials: c.credential_state },
    webhook: {
      url: webhookUrl(deps, c.webhook_endpoint_id),
      verifier: c.webhook_verifier,
      header: WEBHOOK_TOKEN_HEADER,
    },
    settings: settingsOf(c),
    lastPushAt: iso(c.last_push_at),
    lastRevisionAt: iso(c.last_revision_at),
    lastFullSyncAt: iso(c.last_full_sync_at),
    nextFullSyncAt: iso(c.next_full_sync_at),
    activatedAt: iso(c.activated_at),
    allowedActions: [
      act(
        'verify',
        'Verify key and register notifications',
        c.status !== 'disconnected',
        'The connection is disconnected.',
      ),
      act('activate', 'Activate', c.status === 'setup', 'Only a connection in setup can be activated.'),
      act('pause', 'Pause publication', c.status === 'active', 'Only an active connection can be paused.'),
      act('resume', 'Resume', c.status === 'paused', 'Only a paused connection can be resumed.'),
      act('disconnect', 'Disconnect', c.status !== 'disconnected', 'Already disconnected.'),
      act(
        'resync',
        'Re-send availability and rates',
        c.status === 'active',
        'Only an active connection publishes.',
        canResync,
      ),
      act(
        'pullBookings',
        'Pull missed bookings',
        c.status === 'active' || c.status === 'paused',
        'The connection is not running.',
        canRecover,
      ),
    ],
    issues,
    // P3-9: the team responsible for channel connections.
    owner: { kind: 'department' as const, id: 'distribution', name: 'Revenue and distribution' },
    links: [{ rel: 'property', type: 'property', id: c.property_id }],
    version: c.version,
  };
}

async function validateFallback(
  tx: TxContext,
  deps: DistributionDeps,
  propertyId: string,
  s: Partial<ConnectionSettings>,
) {
  if (!s.fallbackRatePlanId) return;
  const plans = await deps.ports.rates.listRatePlans(tx, propertyId);
  if (!plans.some((p) => p.id === s.fallbackRatePlanId)) {
    throw new ValidationError(
      'fallback_rate_plan_unknown',
      'The fallback rate plan does not belong to this property.',
    );
  }
}

export async function createConnection(
  tx: TxContext,
  deps: DistributionDeps,
  raw: CreateConnectionInput,
): Promise<{ connection: ConnectionView; webhookToken: string }> {
  const input = createConnectionInput.parse(raw);
  requirePermission(tx, P.connectionManage, { propertyId: input.propertyId });
  await deps.ports.platform.getProperty(tx, input.propertyId);
  const target = targetForEnvironment(tx.environment);
  const settings = connectionSettings.parse({ ...(input.settings ?? {}) });
  await validateFallback(tx, deps, input.propertyId, settings);
  let externalPropertyId: string;
  let apiKey: string;
  if (target === 'simulator') {
    if (input.externalPropertyId || input.apiKey) {
      throw new ValidationError(
        'simulator_only',
        `A ${tx.environment} organization connects to the simulated hub: do not send a hub property id or API key.`,
      );
    }
    const sim = await deps.simulator.createProperty(tx, {
      title: input.name,
      roomTypes: input.simulator?.roomTypes ?? [],
      ratePlans: input.simulator?.ratePlans ?? [],
      limits: {
        availabilityPerMinute: DEFAULT_LIMITS.availabilityPerMinute,
        restrictionsPerMinute: DEFAULT_LIMITS.restrictionsPerMinute,
      },
    });
    externalPropertyId = sim.propertyId;
    apiKey = sim.apiKey;
  } else {
    if (!input.externalPropertyId || !input.apiKey) {
      throw new ValidationError('hub_credentials_required', 'Enter the hub property id and the hub API key.');
    }
    externalPropertyId = input.externalPropertyId;
    apiKey = input.apiKey;
  }
  const token = randomToken(32);
  const credentialRef = await deps.ports.secrets.put(tx, apiKey);
  const tokenRef = await deps.ports.secrets.put(tx, token);
  const id = newId(tx.now.getTime());
  let row: ConnectionRow;
  try {
    row = await db(tx)
      .insertInto('distribution.connections')
      .values({
        id,
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        hub: 'channex',
        name: input.name,
        status: 'setup',
        target,
        external_property_id: externalPropertyId,
        credential_ref: credentialRef,
        credential_state: 'unverified',
        webhook_endpoint_id: newId(tx.now.getTime()),
        webhook_secret_hash: sha256Hex(token),
        webhook_secret_ref: tokenRef,
        webhook_registered_at: null,
        webhook_verifier: 'header_secret',
        channel_code: input.channelCode,
        settings: json(settings),
        health: 'not_active',
        health_reason: null,
        health_changed_at: tx.now,
        last_push_at: null,
        last_revision_at: null,
        inbound_gap_at: null,
        last_feed_pull_at: null,
        next_feed_pull_at: null,
        last_full_sync_at: null,
        next_full_sync_at: null,
        activated_at: null,
        verified_at: null,
        webhook_hub_id: null,
        verify_lease_until: null,
        created_by: actorKey(tx),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(
        'connection_exists',
        'This property already has a connection to this hub, or this hub property is already connected in this organization. Disconnect the other connection first.',
      );
    }
    throw err;
  }
  await tx.audit({
    action: 'distribution.connection.created',
    target: { type: RECORD.connection, id },
    propertyId: input.propertyId,
    after: { name: input.name, hub: 'channex', target, externalPropertyId, settings },
  });
  return { connection: connectionView(tx, deps, row), webhookToken: token };
}

/**
 * Verify the key (harmless read) and register booking notifications at the hub with the webhook token. Hub calls
 * happen between two transactions; the outcome is recorded on the connection and in the exchange log, and that
 * record COMMITS before a failure is reported (a refused key stays recorded as refused).
 *
 * P2-6: the first successful Verify is the proof of control that claims a production hub property globally
 * (`verified_at`). A hub property another connection has already proven is refused BEFORE any hub call; a race
 * between two proofs is decided by the directory's unique index (the later one is refused).
 */
export async function verifyConnection(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
): Promise<ConnectionView> {
  const pre = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    requireOnConnection(tx, conn, P.connectionManage);
    if (conn.status === 'disconnected')
      throw new BusinessRuleError('connection_disconnected', 'The connection is disconnected.');
    if (await claimedElsewhere(tx, conn.id)) throw claimedError();
    const hubCtx = await hubContext(tx, deps, conn);
    const token = await deps.ports.secrets.get(tx, conn.webhook_secret_ref);
    // P3-1: one Verify at a time per connection (two concurrent ones would register the webhook twice).
    const leased = await db(tx)
      .updateTable('distribution.connections')
      .set({ verify_lease_until: new Date(tx.now.getTime() + 2 * deps.config.callDeadlineMs) })
      .where('id', '=', conn.id)
      .where((eb) => eb.or([eb('verify_lease_until', 'is', null), eb('verify_lease_until', '<', tx.now)]))
      .returning('id')
      .executeTakeFirst();
    if (!leased) {
      throw new ConflictError(
        'verification_in_progress',
        'Another verification of this connection is running. Try again in a minute.',
      );
    }
    return { conn, hubCtx, token };
  });
  let failure: HubError | null = null;
  let propertyName: string | null = null;
  let webhookId: string | null = null;
  try {
    propertyName = (await deps.hub.testCredentials(pre.hubCtx)).propertyName;
    if (!pre.conn.webhook_registered_at) {
      // P3-1: after a token rotation the old registration is removed first, so the hub never delivers twice
      // (once with the old token, refused).
      if (pre.conn.webhook_hub_id) await deps.hub.removeWebhook(pre.hubCtx, pre.conn.webhook_hub_id);
      webhookId = (
        await deps.hub.registerWebhook(pre.hubCtx, {
          callbackUrl: webhookUrl(deps, pre.conn.webhook_endpoint_id),
          token: pre.token,
        })
      ).webhookId;
    }
  } catch (err) {
    if (!(err instanceof HubError)) throw err;
    failure = err;
  }
  const out = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId, { forUpdate: true });
    await recordExchange(tx, {
      connectionId: conn.id,
      direction: 'outbound',
      operation: 'connection.verify',
      httpStatus: failure?.failure.httpStatus ?? 200,
      outcome: failure ? failure.failure.class : 'ok',
      detail: failure ? { message: failure.message } : { propertyName },
      provenance: provenanceOfTarget(conn.target),
    });
    if (failure?.failure.class === 'auth') await markCredentialsInvalid(tx, conn, failure.message);
    const state = failure ? (failure.failure.class === 'auth' ? 'invalid' : conn.credential_state) : 'valid';
    const inUse = conn.status === 'active' || conn.status === 'paused';
    let claimed = true;
    let updated = conn;
    try {
      updated = await withSavepoint(tx, 'dst_verify', () =>
        db(tx)
          .updateTable('distribution.connections')
          .set({
            credential_state: state,
            ...(failure ? {} : { webhook_registered_at: conn.webhook_registered_at ?? tx.now }),
            ...(failure ? {} : { verified_at: conn.verified_at ?? tx.now }),
            ...(webhookId ? { webhook_hub_id: webhookId } : {}),
            verify_lease_until: null,
            // The unblocking transition (P1-1): bookings the hub may have sent while the key was refused or
            // unverified are pulled at once, and queued ARI and acknowledgements become due again.
            ...(!failure && inUse ? { next_feed_pull_at: tx.now } : {}),
            updated_at: tx.now,
            version: sql`version + 1`,
          })
          .where('id', '=', conn.id)
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      claimed = false; // another connection proved this hub property first (race)
      await db(tx)
        .updateTable('distribution.connections')
        .set({ verify_lease_until: null })
        .where('id', '=', conn.id)
        .execute();
    }
    if (!failure && claimed) {
      await autoResolve(tx, conn.id, 'credentials_invalid', 'The API key was verified.');
      if (inUse) await scheduleTenant(tx, tx.now);
    }
    await tx.audit({
      action: 'distribution.connection.verified',
      target: { type: RECORD.connection, id: conn.id },
      propertyId: conn.property_id,
      after: { credentials: state, ok: !failure && claimed },
      reason: failure?.message ?? (claimed ? null : 'hub property already proven by another connection'),
    });
    return { view: connectionView(tx, deps, updated), claimed };
  });
  if (failure) {
    throw new DomainError(
      'hub_verification_failed',
      `${failure.message} The connection was not verified; nothing changed at the channel.`,
      {
        status: 502,
        details: { class: failure.failure.class },
        retryable: failure.failure.class !== 'payload',
      },
    );
  }
  if (!out.claimed) throw claimedError();
  return out.view;
}

async function claimedElsewhere(tx: TxContext, connectionId: string): Promise<boolean> {
  const r = await sql<{
    claimed: boolean;
  }>`select distribution.hub_property_claimed_elsewhere(${connectionId}::uuid) as claimed`.execute(tx.db);
  return r.rows[0]?.claimed === true;
}

function claimedError(): ConflictError {
  return new ConflictError(
    'hub_property_claimed',
    'This hub property is already connected and verified by another connection (possibly another organization). Nothing was sent to the hub. If the hub property is yours, contact Monoclay support.',
  );
}

async function assertAuthority(tx: TxContext, deps: DistributionDeps, conn: ConnectionRow) {
  for (const domain of ['availability', 'rates', 'reservations'] as const) {
    const a = await deps.ports.platform.getDataAuthority(tx, conn.property_id, domain);
    if (a.authority === 'external') {
      throw new BusinessRuleError(
        'external_system_of_record',
        `${a.systemName ?? 'Another system'} is the system of record for ${domain} at this property. A channel connection publishing from Portico would let two systems control the same live inventory, so it cannot be activated (DST-R15).`,
        { domain },
      );
    }
  }
}

async function guard(tx: TxContext, connectionId: string, expectedVersion: number) {
  const conn = await loadConnection(tx, connectionId, { forUpdate: true });
  requireOnConnection(tx, conn, P.connectionManage);
  if (conn.version !== expectedVersion) {
    throw new VersionConflictError('channel_connection', connectionId, expectedVersion, conn.version);
  }
  return conn;
}

async function setStatus(
  tx: TxContext,
  conn: ConnectionRow,
  patch: Record<string, unknown>,
  action: string,
  reason?: string,
) {
  const updated = await db(tx)
    .updateTable('distribution.connections')
    .set({ ...patch, updated_at: tx.now, version: sql`version + 1` })
    .where('id', '=', conn.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: `distribution.connection.${action}`,
    target: { type: RECORD.connection, id: conn.id },
    propertyId: conn.property_id,
    before: { status: conn.status },
    after: { status: updated.status },
    ...(reason ? { reason } : {}),
  });
  return updated;
}

/** Mark every mapped product dirty for a window (non-destructive full or range resync). */
export async function requestResync(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  input: {
    trigger: 'connect' | 'nightly' | 'on_demand' | 'resume' | 'authority';
    range?: DateRange;
    kinds?: AriKind[];
  },
): Promise<{ products: number; range: DateRange }> {
  const window = await windowFor(tx, deps, conn);
  const range = input.range ? (clipRanges([input.range], window)[0] ?? null) : window;
  if (!range)
    throw new ValidationError('resync_outside_window', 'The dates are outside the publication window.');
  const m = await activeMappings(tx, conn.id);
  let products = 0;
  for (const kind of input.kinds ?? ARI_KINDS) {
    const list =
      kind === 'availability'
        ? m.rooms.map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: null }))
        : m.rates.map((r) => ({ unitTypeId: r.unit_type_id, ratePlanId: r.rate_plan_id }));
    await markDirty(tx, deps, conn, { kind, products: list, ranges: [range] });
    products += list.length;
  }
  await db(tx)
    .insertInto('distribution.resync_runs')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      trigger: input.trigger,
      range_from: range.from,
      range_to: range.to,
      products_marked: products,
      requested_by: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  const full = !input.range && !input.kinds;
  if (full) {
    await db(tx)
      .updateTable('distribution.connections')
      .set({
        last_full_sync_at: tx.now,
        next_full_sync_at: new Date(tx.now.getTime() + settingsOf(conn).fullResyncHours * 3_600_000),
      })
      .where('id', '=', conn.id)
      .execute();
  }
  await scheduleTenant(tx, tx.now);
  return { products, range };
}

export async function activateConnection(
  tx: TxContext,
  deps: DistributionDeps,
  connectionId: string,
  expectedVersion: number,
): Promise<ConnectionView> {
  const conn = await guard(tx, connectionId, expectedVersion);
  if (conn.status !== 'setup')
    throw new BusinessRuleError('connection_not_in_setup', 'Only a connection in setup can be activated.');
  if (conn.credential_state !== 'valid' || !conn.webhook_registered_at) {
    throw new BusinessRuleError(
      'connection_not_verified',
      'Verify the API key and register booking notifications first (Verify), so bookings can reach Portico from the first minute.',
    );
  }
  await assertAuthority(tx, deps, conn);
  if (conn.target === 'production') {
    await deps.ports.liveScope.assertLiveChannelAllowed(tx, {
      propertyId: conn.property_id,
      connectionId: conn.id,
    });
  }
  const c = await completeness(tx, deps, conn);
  if (!c.complete) {
    throw new BusinessRuleError(
      'mapping_incomplete',
      `Go-live is blocked: ${c.summary}${c.invalid.length ? `, ${c.invalid.length} invalid` : ''}. Map every sellable product (or exclude it from this channel in its rate plan) first.`,
      { mapped: c.mapped, total: c.total, unmapped: c.unmapped.slice(0, 20), invalid: c.invalid },
    );
  }
  const updated = await setStatus(
    tx,
    conn,
    {
      status: 'active',
      activated_at: tx.now,
      health: 'connected',
      health_changed_at: tx.now,
      next_feed_pull_at: tx.now,
    },
    'activated',
  );
  await requestResync(tx, deps, updated, { trigger: 'connect' });
  return connectionView(tx, deps, await loadConnection(tx, conn.id));
}

export async function pauseConnection(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  v: number,
  reason: string,
) {
  const conn = await guard(tx, id, v);
  if (conn.status !== 'active')
    throw new BusinessRuleError('connection_not_active', 'Only an active connection can be paused.');
  const updated = await setStatus(
    tx,
    conn,
    { status: 'paused', health: 'paused', health_changed_at: tx.now },
    'paused',
    reason,
  );
  return connectionView(tx, deps, updated);
}

export async function resumeConnection(tx: TxContext, deps: DistributionDeps, id: string, v: number) {
  const conn = await guard(tx, id, v);
  if (conn.status !== 'paused')
    throw new BusinessRuleError('connection_not_paused', 'Only a paused connection can be resumed.');
  await assertAuthority(tx, deps, conn);
  const updated = await setStatus(tx, conn, { status: 'active', next_feed_pull_at: tx.now }, 'resumed');
  // Non-destructive: what changed while paused is re-sent in full; nothing is unlisted.
  await requestResync(tx, deps, updated, { trigger: 'resume' });
  return connectionView(tx, deps, await loadConnection(tx, conn.id));
}

/**
 * Disconnect: refused while any booking revision is not settled and acknowledged (a booking could be lost).
 * The key is destroyed (crypto-shredding); pending ARI work is dropped.
 */
export async function disconnectConnection(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  v: number,
  reason: string,
) {
  const conn = await guard(tx, id, v);
  if (conn.status === 'disconnected')
    throw new BusinessRuleError('connection_disconnected', 'Already disconnected.');
  const pending = await db(tx)
    .selectFrom('distribution.revision_processing')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('connection_id', '=', conn.id)
    .where((eb) =>
      eb.or([
        eb('state', 'in', ['received', 'failed', 'parked']),
        eb('ack_state', 'in', ['pending', 'sending', 'failed']),
      ]),
    )
    .executeTakeFirst();
  if ((pending?.n ?? 0) > 0) {
    throw new BusinessRuleError(
      'unsettled_bookings',
      `${pending?.n} channel booking revision(s) are not settled or not acknowledged yet. Disconnecting now could lose a booking: resolve them first (revision list), then disconnect.`,
      { pending: pending?.n },
    );
  }
  await releaseProtection(tx, deps, conn, 'The connection was disconnected.');
  await db(tx).deleteFrom('distribution.ari_dirty').where('connection_id', '=', conn.id).execute();
  await db(tx)
    .updateTable('distribution.ari_messages')
    .set({
      status: 'superseded',
      lease_token: null,
      lease_until: null,
      next_attempt_at: null,
      updated_at: tx.now,
      last_error: 'Connection disconnected.',
    })
    .where('connection_id', '=', conn.id)
    .where('status', 'in', ['queued', 'sending', 'failed_transient'])
    .execute();
  if (conn.credential_ref) await deps.ports.secrets.destroy(tx, conn.credential_ref);
  const updated = await setStatus(
    tx,
    conn,
    { status: 'disconnected', credential_ref: null, health: 'not_active', health_changed_at: tx.now },
    'disconnected',
    reason,
  );
  return connectionView(tx, deps, updated);
}

export async function updateSettings(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  v: number,
  patch: Partial<ConnectionSettings>,
) {
  const conn = await guard(tx, id, v);
  const next = connectionSettings.parse({ ...settingsOf(conn), ...patch });
  await validateFallback(tx, deps, conn.property_id, next);
  const updated = await db(tx)
    .updateTable('distribution.connections')
    .set({ settings: json(next), updated_at: tx.now, version: sql`version + 1` })
    .where('id', '=', conn.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'distribution.connection.settingsChanged',
    target: { type: RECORD.connection, id: conn.id },
    propertyId: conn.property_id,
    before: settingsOf(conn),
    after: next,
  });
  return connectionView(tx, deps, updated);
}

/**
 * Replace the hub API key (the old one is destroyed). The connection must be verified again: until Verify proves the
 * new key against this connection's hub property, no hub work uses it (`hubBlocker`), and Verify is the transition
 * that pulls the schedule — rotation alone contributes no due instant.
 */
export async function rotateCredential(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  v: number,
  apiKey: string,
) {
  const conn = await guard(tx, id, v);
  if (conn.status === 'disconnected')
    throw new BusinessRuleError('connection_disconnected', 'The connection is disconnected.');
  if (conn.target === 'simulator') {
    throw new BusinessRuleError(
      'simulator_key_fixed',
      'The simulated hub has a fixed key; nothing to replace.',
    );
  }
  const ref = await deps.ports.secrets.put(tx, apiKey);
  if (conn.credential_ref) await deps.ports.secrets.destroy(tx, conn.credential_ref);
  const updated = await setStatus(
    tx,
    conn,
    { credential_ref: ref, credential_state: 'unverified' },
    'credentialRotated',
  );
  return connectionView(tx, deps, updated);
}

/** New webhook token (shown once); registration at the hub must be repeated (Verify). */
export async function rotateWebhookToken(tx: TxContext, deps: DistributionDeps, id: string, v: number) {
  const conn = await guard(tx, id, v);
  const token = randomToken(32);
  const ref = await deps.ports.secrets.put(tx, token);
  await deps.ports.secrets.destroy(tx, conn.webhook_secret_ref);
  const updated = await setStatus(
    tx,
    conn,
    { webhook_secret_hash: sha256Hex(token), webhook_secret_ref: ref, webhook_registered_at: null },
    'webhookTokenRotated',
  );
  return { connection: connectionView(tx, deps, updated), webhookToken: token };
}

export async function getConnection(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
): Promise<ConnectionView> {
  const conn = await loadConnection(tx, id);
  requireOnConnection(tx, conn, P.channelRead);
  return connectionView(tx, deps, conn);
}

export async function listConnections(tx: TxContext, deps: DistributionDeps, q: { propertyId: string }) {
  requirePermission(tx, P.channelRead, { propertyId: q.propertyId });
  const rows = await db(tx)
    .selectFrom('distribution.connections')
    .selectAll()
    .where('property_id', '=', q.propertyId)
    .orderBy('created_at')
    .execute();
  return rows.map((r) => connectionView(tx, deps, r));
}

export async function resyncConnection(
  tx: TxContext,
  deps: DistributionDeps,
  id: string,
  input: { from?: string; to?: string; kinds?: AriKind[] },
) {
  const conn = await loadConnection(tx, id);
  requireOnConnection(tx, conn, P.ariResync);
  if (conn.status !== 'active')
    throw new BusinessRuleError('connection_not_active', 'Only an active connection publishes.');
  if ((input.from && !input.to) || (!input.from && input.to)) {
    throw new ValidationError('resync_range_incomplete', 'Give both dates, or neither for a full resync.');
  }
  if (input.from && input.to && input.from >= input.to) {
    throw new ValidationError('invalid_date_range', 'The end date must be after the start date.');
  }
  const r = await requestResync(tx, deps, conn, {
    trigger: 'on_demand',
    ...(input.from && input.to ? { range: { from: input.from, to: input.to } } : {}),
    ...(input.kinds ? { kinds: input.kinds } : {}),
  });
  await tx.audit({
    action: 'distribution.connection.resync',
    target: { type: RECORD.connection, id: conn.id },
    propertyId: conn.property_id,
    after: r,
  });
  return r;
}

/** platform.dataAuthority.changed: publication stops at the switch to external; a switch back re-sends everything. */
export async function onAuthorityChanged(
  tx: TxContext,
  deps: DistributionDeps,
  propertyId: string,
  domain: string,
) {
  if (domain !== 'availability' && domain !== 'rates') return;
  const conns = await db(tx)
    .selectFrom('distribution.connections')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', '=', 'active')
    .execute();
  const a = await deps.ports.platform.getDataAuthority(tx, propertyId, domain);
  for (const conn of conns) {
    if (a.authority === 'external') {
      await raiseException(
        tx,
        {
          connectionId: conn.id,
          propertyId,
          code: 'publication_blocked',
          dedupeKey: `publication_blocked:${domain === 'availability' ? 'availability' : 'restrictions'}`,
          severity: 'routine',
          problem: `${a.systemName ?? 'Another system'} became the system of record for ${domain}: Portico stopped publishing it to this channel.`,
          businessImpact: 'The channel keeps the last values Portico sent until the other system publishes.',
          responsibleParty: 'hotel',
          nextStep: 'Publish from the system of record, or make Portico the system of record again.',
        },
        { standing: true },
      );
    } else {
      // Authority returned: the unblocking transition pulls the schedule (requestResync → markDirty → schedule).
      // Availability authority also blocks restrictions (no ARI at all), so its return re-sends both kinds.
      await requestResync(tx, deps, conn, {
        trigger: 'authority',
        kinds: domain === 'availability' ? ['availability', 'restrictions'] : ['restrictions'],
      });
    }
  }
}
