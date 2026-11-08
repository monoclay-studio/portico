/**
 * ARI dispatcher (DST-R04). Per connection and kind there is at most ONE open message. Building a message:
 *   1. (transaction) take the open message's cells plus pending dirty ranges up to the cap, read CURRENT values
 *      (inventory / rates), apply stop-sells, map to channel codes, reserve one token from the connection's budget,
 *      mark the message `sending` under a lease — and commit;
 *   2. call the hub outside any transaction, with a deadline shorter than the lease;
 *   3. (transaction) record the outcome if the lease is still ours: accepted cells become the last-acknowledged
 *      channel state; refusals are classified (payload → no retry + exception; transient → backoff; auth → pause
 *      this connection only).
 * While the budget is spent, changes keep merging into the dirty set, so a burst becomes a few large messages.
 */
import { type PorticoDatabase, sql, type TxContext, withTenantTx } from '@portico/db';
import {
  addDays,
  type DateRange,
  DomainError,
  type LocalDate,
  newId,
  type RequestContext,
} from '@portico/kernel';
import { availabilityBody, restrictionsBody } from '../adapters/channex/wire';
import { type AriResult, HubError } from '../adapters/hub';
import type { AriKind, CellValue, PublishReason } from '../domain/ari';
import { BUDGET_WINDOW_MS, type BudgetState, reserveSlot, restampAtCompletion } from '../domain/budget';
import { type HubFailure, isEscalated, nextAttemptAt, RATE_LIMIT_PAUSE_MS } from '../domain/delivery';
import { countNights, normalizeRanges, takeNights } from '../domain/ranges';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { RECORD } from '../manifest';
import type { Product } from './ari-dirty';
import { type BuiltCell, buildCells, type ProductRanges, packCells } from './ari-values';
import {
  budgetNow,
  type ConnectionRow,
  type DistributionDeps,
  db,
  hubContext,
  json,
  loadConnection,
  lockAri,
  provenanceOfTarget,
  recordExchange,
  settingsOf,
} from './common';
import { autoResolve, markCredentialsInvalid, raiseException } from './exceptions';

/** A cell as stored on a message: product, night, value sent, why it differs, and the wire value carrying it. */
export interface StoredCell {
  u: string;
  r: string | null;
  d: LocalDate;
  v: CellValue;
  why?: PublishReason;
  i: number;
}

export interface DispatchResult {
  sent: boolean;
  /** When this connection/kind next has something to do (null: nothing pending). */
  nextDueAt: Date | null;
  outcome?:
    | 'accepted'
    | 'partially_accepted'
    | 'rejected'
    | 'failed_transient'
    | 'late'
    | 'pending_verification';
}

const productKey = (p: Product) => `${p.unitTypeId}|${p.ratePlanId ?? ''}`;

async function loadBudget(tx: TxContext, conn: ConnectionRow, kind: AriKind): Promise<BudgetState> {
  await db(tx)
    .insertInto('distribution.ari_budget')
    .values({ tenant_id: tx.tenantId, connection_id: conn.id, kind, sends: '{}', paused_until: null })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const row = await db(tx)
    .selectFrom('distribution.ari_budget')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('kind', '=', kind)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return {
    sends: (row.sends ?? []).map((d) => new Date(d)),
    pausedUntil: row.paused_until ? new Date(row.paused_until) : null,
  };
}

/** The budget's limit and window for a kind: the hub's 60 s plus the connection's safety margin (P2-2). */
function budgetRule(conn: ConnectionRow, kind: AriKind): { limit: number; windowMs: number } {
  const s = settingsOf(conn);
  return {
    limit: kind === 'availability' ? s.availabilityPerMinute : s.restrictionsPerMinute,
    windowMs: BUDGET_WINDOW_MS + s.budgetMarginSeconds * 1000,
  };
}

async function saveSends(tx: TxContext, connectionId: string, kind: AriKind, sends: readonly Date[]) {
  await sql`update distribution.ari_budget set sends = ${sends.map((d) => d.toISOString())}::timestamptz[]
            where connection_id = ${connectionId} and kind = ${kind}`.execute(tx.db);
}

/**
 * Atomically spend one token of the connection's budget for `kind` (row lock: concurrent dispatchers serialize and
 * never exceed the limit), stamped on the budget clock read AFTER the lock is held. Returns the stamp (re-stamped at
 * completion), or when the next token is free.
 */
export async function reserveBudget(
  tx: TxContext,
  deps: Pick<DistributionDeps, 'config'>,
  conn: ConnectionRow,
  kind: AriKind,
): Promise<{ ok: true; stamp: Date } | { ok: false; retryAt: Date }> {
  const { limit, windowMs } = budgetRule(conn, kind);
  const state = await loadBudget(tx, conn, kind);
  const now = await budgetNow(tx, deps);
  const r = reserveSlot(state, now, limit, windowMs);
  await saveSends(tx, conn.id, kind, r.sends);
  // retryAt is on the budget clock: hand the scheduler the same DELAY on the transaction's clock.
  return r.ok
    ? { ok: true, stamp: r.stamp }
    : { ok: false, retryAt: new Date(tx.now.getTime() + (r.retryAt.getTime() - now.getTime())) };
}

/** Count the request's slot from its completion (P2-2). Caller holds the connection and message locks. */
async function restampBudget(
  tx: TxContext,
  deps: Pick<DistributionDeps, 'config'>,
  conn: ConnectionRow,
  kind: AriKind,
  reserved: Date,
): Promise<void> {
  const { windowMs } = budgetRule(conn, kind);
  const state = await loadBudget(tx, conn, kind);
  await saveSends(
    tx,
    conn.id,
    kind,
    restampAtCompletion(state.sends, reserved, await budgetNow(tx, deps), windowMs),
  );
}

async function pauseBudget(tx: TxContext, connectionId: string, kind: AriKind, until: Date): Promise<void> {
  await db(tx)
    .updateTable('distribution.ari_budget')
    .set({ paused_until: until })
    .where('connection_id', '=', connectionId)
    .where('kind', '=', kind)
    .execute();
}

export async function nextBudgetSlot(
  tx: TxContext,
  deps: Pick<DistributionDeps, 'config'>,
  conn: ConnectionRow,
  kind: AriKind,
): Promise<Date> {
  const { limit, windowMs } = budgetRule(conn, kind);
  const row = await db(tx)
    .selectFrom('distribution.ari_budget')
    .selectAll()
    .where('connection_id', '=', conn.id)
    .where('kind', '=', kind)
    .executeTakeFirst();
  if (!row) return tx.now;
  const now = await budgetNow(tx, deps);
  const r = reserveSlot(
    {
      sends: (row.sends ?? []).map((d) => new Date(d)),
      pausedUntil: row.paused_until ? new Date(row.paused_until) : null,
    },
    now,
    limit,
    windowMs,
  );
  return r.ok ? tx.now : new Date(tx.now.getTime() + (r.retryAt.getTime() - now.getTime()));
}

async function openMessage(tx: TxContext, connectionId: string, kind: AriKind, forUpdate: boolean) {
  let q = db(tx)
    .selectFrom('distribution.ari_messages')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('kind', '=', kind)
    .where('status', 'in', ['queued', 'sending', 'failed_transient']);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

type Claim =
  | { kind: 'skip'; nextDueAt: Date | null }
  | {
      kind: 'send';
      connectionId: string;
      messageId: string;
      token: string;
      hubCtx: Awaited<ReturnType<typeof hubContext>>;
      batch: ReturnType<typeof packCells>;
      provenance: 'live' | 'sandbox' | 'simulated';
      /** The budget slot's reservation stamp (re-stamped at completion). */
      budgetStamp: Date;
    };

/**
 * DST-R15 / DST-I05: no ARI at all while another system is authoritative for availability (two systems would
 * control live inventory); no rates or restrictions while another system is authoritative for rates.
 */
export async function publicationBlockedBy(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  kind: AriKind,
): Promise<string | null> {
  const domains =
    kind === 'availability' ? (['availability'] as const) : (['availability', 'rates'] as const);
  for (const domain of domains) {
    const a = await deps.ports.platform.getDataAuthority(tx, conn.property_id, domain);
    if (a.authority === 'external') {
      return `${a.systemName ?? 'Another system'} is the system of record for ${domain} at this property, so Portico does not publish ${kind} to channels (no two systems control live inventory).`;
    }
  }
  return null;
}

async function claim(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  kind: AriKind,
): Promise<Claim> {
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (conn.status !== 'active' || conn.credential_state !== 'valid')
      return { kind: 'skip', nextDueAt: null };
    await lockAri(tx, conn.id, kind);
    const blocked = await publicationBlockedBy(tx, deps, conn, kind);
    if (blocked) {
      await raiseException(
        tx,
        {
          connectionId: conn.id,
          propertyId: conn.property_id,
          code: 'publication_blocked',
          dedupeKey: `publication_blocked:${kind}`,
          severity: 'routine',
          problem: blocked,
          businessImpact: 'The channel keeps the values it had; changes made in Portico are not published.',
          responsibleParty: 'hotel',
          nextStep:
            'Publish from the system of record, or make Portico the system of record again; Portico then re-sends everything.',
        },
        { standing: true },
      );
      return { kind: 'skip', nextDueAt: null };
    }
    await autoResolve(tx, conn.id, `publication_blocked:${kind}`, 'Portico is the system of record again.');
    let hubCtx: Awaited<ReturnType<typeof hubContext>>;
    try {
      hubCtx = await hubContext(tx, deps, conn);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      await raiseException(
        tx,
        {
          connectionId: conn.id,
          propertyId: conn.property_id,
          code: 'publication_refused',
          dedupeKey: `publication_refused:${err.code}`,
          severity: 'urgent',
          problem: err.message,
          businessImpact: 'Availability and rates are not published to this channel.',
          responsibleParty: 'monoclay',
          nextStep: 'Contact Monoclay support; the connection must be set up for this environment.',
        },
        { standing: true },
      );
      return { kind: 'skip', nextDueAt: null };
    }
    const open = await openMessage(tx, conn.id, kind, true);
    if (open?.status === 'sending' && open.lease_until && new Date(open.lease_until) > tx.now) {
      return { kind: 'skip', nextDueAt: new Date(open.lease_until) };
    }
    if (open?.next_attempt_at && new Date(open.next_attempt_at) > tx.now) {
      return { kind: 'skip', nextDueAt: new Date(open.next_attempt_at) };
    }
    const dirty = await db(tx)
      .selectFrom('distribution.ari_dirty')
      .selectAll()
      .where('connection_id', '=', conn.id)
      .where('kind', '=', kind)
      .orderBy('first_dirty_at')
      .execute();
    if (!open && dirty.length === 0) return { kind: 'skip', nextDueAt: null };
    const settings = settingsOf(conn);
    const wanted = new Map<string, ProductRanges>();
    const add = (p: Product, ranges: DateRange[]) => {
      const k = productKey(p);
      const cur = wanted.get(k);
      wanted.set(k, { product: p, ranges: normalizeRanges([...(cur?.ranges ?? []), ...ranges]) });
    };
    for (const c of (open?.cells ?? []) as StoredCell[]) {
      add({ unitTypeId: c.u, ratePlanId: c.r }, [{ from: c.d, to: addDays(c.d, 1) }]);
    }
    let room =
      settings.maxCellsPerMessage - [...wanted.values()].reduce((n, w) => n + countNights(w.ranges), 0);
    const consumed: Array<{ id: string; rest: DateRange[]; merged: number; since: Date }> = [];
    for (const row of dirty) {
      if (room <= 0) break;
      const { taken, rest } = takeNights(row.ranges as DateRange[], room);
      if (taken.length === 0) continue;
      add({ unitTypeId: row.unit_type_id, ratePlanId: row.rate_plan_id }, taken);
      room -= countNights(taken);
      consumed.push({ id: row.id, rest, merged: row.merged_deltas, since: new Date(row.first_dirty_at) });
    }
    const built = await buildCells(tx, deps, conn, kind, [...wanted.values()]);
    if (built.cells.length === 0) {
      // Nothing mapped is left to send (mappings changed): close the work without spending budget.
      for (const c of consumed)
        await db(tx).deleteFrom('distribution.ari_dirty').where('id', '=', c.id).execute();
      if (open) {
        await db(tx)
          .updateTable('distribution.ari_messages')
          .set({
            status: 'superseded',
            lease_token: null,
            lease_until: null,
            next_attempt_at: null,
            updated_at: tx.now,
            last_error: 'Nothing mapped is left to send.',
          })
          .where('id', '=', open.id)
          .execute();
      }
      return { kind: 'skip', nextDueAt: null };
    }
    const budget = await reserveBudget(tx, deps, conn, kind);
    if (!budget.ok) return { kind: 'skip', nextDueAt: budget.retryAt };
    for (const c of consumed) {
      if (c.rest.length === 0)
        await db(tx).deleteFrom('distribution.ari_dirty').where('id', '=', c.id).execute();
      else
        await db(tx)
          .updateTable('distribution.ari_dirty')
          .set({ ranges: json(c.rest), merged_deltas: 0, updated_at: tx.now })
          .where('id', '=', c.id)
          .execute();
    }
    const batch = packCells(kind, built.cells);
    const valueIndexOfCell = new Map<number, number>();
    batch.valueCells.forEach((cellIdx, valueIdx) => {
      for (const i of cellIdx) valueIndexOfCell.set(i, valueIdx);
    });
    const stored: StoredCell[] = built.cells.map((c: BuiltCell, i) => ({
      u: c.unitTypeId,
      r: c.ratePlanId,
      d: c.date,
      v: c.value,
      ...(c.reason ? { why: c.reason } : {}),
      i: valueIndexOfCell.get(i) ?? -1,
    }));
    const payload =
      kind === 'availability'
        ? availabilityBody(conn.external_property_id, batch.availability)
        : restrictionsBody(conn.external_property_id, batch.restrictions);
    const token = newId(tx.now.getTime());
    const coalesced = consumed.reduce((n, c) => n + c.merged, 0);
    const oldest = [open ? new Date(open.oldest_change_at) : null, ...consumed.map((c) => c.since)]
      .filter((d): d is Date => d !== null)
      .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b), tx.now);
    const provenance = provenanceOfTarget(conn.target);
    const leaseUntil = new Date(tx.now.getTime() + deps.config.leaseMs);
    let messageId: string;
    if (open) {
      messageId = open.id;
      await db(tx)
        .updateTable('distribution.ari_messages')
        .set({
          status: 'sending',
          cells: json(stored),
          payload: json(payload),
          cell_count: stored.length,
          value_count: batch.valueCells.length,
          coalesced_deltas: open.coalesced_deltas + coalesced,
          oldest_change_at: oldest,
          attempts: open.attempts + 1,
          lease_token: token,
          lease_until: leaseUntil,
          next_attempt_at: null,
          sent_at: tx.now,
          updated_at: tx.now,
          version: sql`version + 1`,
        })
        .where('id', '=', open.id)
        .execute();
    } else {
      messageId = newId(tx.now.getTime());
      await db(tx)
        .insertInto('distribution.ari_messages')
        .values({
          id: messageId,
          tenant_id: tx.tenantId,
          connection_id: conn.id,
          property_id: conn.property_id,
          kind,
          trigger: stored.some((c) => c.why === 'protection') ? 'protection' : 'delta',
          status: 'sending',
          cells: json(stored),
          payload: json(payload),
          cell_count: stored.length,
          value_count: batch.valueCells.length,
          coalesced_deltas: coalesced,
          oldest_change_at: oldest,
          attempts: 1,
          lease_token: token,
          lease_until: leaseUntil,
          next_attempt_at: null,
          first_failed_at: null,
          sent_at: tx.now,
          accepted_at: null,
          last_error_class: null,
          last_error: null,
          rejected_cells: null,
          provenance,
          created_at: tx.now,
          updated_at: tx.now,
        })
        .execute();
    }
    return {
      kind: 'send',
      connectionId: conn.id,
      messageId,
      token,
      hubCtx,
      batch,
      provenance,
      budgetStamp: budget.stamp,
    };
  });
}

export async function upsertChannelState(
  tx: TxContext,
  connectionId: string,
  kind: AriKind,
  message: { id: string; seq: number },
  cells: readonly StoredCell[],
): Promise<void> {
  for (let i = 0; i < cells.length; i += 500) {
    const chunk = cells.slice(i, i + 500);
    await db(tx)
      .insertInto('distribution.channel_state')
      .values(
        chunk.map((c) => ({
          tenant_id: tx.tenantId,
          connection_id: connectionId,
          kind,
          unit_type_id: c.u,
          rate_plan_id: c.r,
          stay_date: c.d,
          last_acked: json(c.v),
          acked_message_id: message.id,
          acked_message_seq: message.seq,
          acked_at: tx.now,
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'connection_id', 'kind', 'unit_type_id', 'rate_plan_id', 'stay_date'])
          .doUpdateSet((eb) => ({
            last_acked: eb.ref('excluded.last_acked'),
            acked_message_id: eb.ref('excluded.acked_message_id'),
            acked_message_seq: eb.ref('excluded.acked_message_seq'),
            acked_at: eb.ref('excluded.acked_at'),
          }))
          // DST-I04 under reordering: an older message's late acceptance never overwrites a newer one's state.
          .where('distribution.channel_state.acked_message_seq', '<=', (eb) =>
            eb.ref('excluded.acked_message_seq'),
          ),
      )
      .execute();
  }
}

/**
 * A recognised acceptance confirms its cells: earlier messages left "pending verification" (P2-3) drop those cells,
 * and are superseded once none is left; the exception resolves itself when no such message remains for the kind.
 */
async function settleUnverified(
  tx: TxContext,
  connectionId: string,
  kind: AriKind,
  seq: number,
  accepted: readonly StoredCell[],
): Promise<void> {
  if (accepted.length === 0) return;
  const confirmed = new Set(accepted.map((c) => `${c.u}|${c.r ?? ''}|${c.d}`));
  const open = await db(tx)
    .selectFrom('distribution.ari_messages')
    .select(['id', 'cells'])
    .where('connection_id', '=', connectionId)
    .where('kind', '=', kind)
    .where('status', '=', 'pending_verification')
    .where('seq', '<', seq)
    .forUpdate()
    .execute();
  for (const m of open) {
    const left = (m.cells as StoredCell[]).filter((c) => !confirmed.has(`${c.u}|${c.r ?? ''}|${c.d}`));
    if (left.length === (m.cells as StoredCell[]).length) continue;
    await db(tx)
      .updateTable('distribution.ari_messages')
      .set({
        cells: json(left),
        cell_count: left.length,
        ...(left.length === 0 ? { status: 'superseded' as const } : {}),
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', m.id)
      .execute();
  }
  const remaining = await db(tx)
    .selectFrom('distribution.ari_messages')
    .select('id')
    .where('connection_id', '=', connectionId)
    .where('kind', '=', kind)
    .where('status', '=', 'pending_verification')
    .executeTakeFirst();
  if (!remaining)
    await autoResolve(
      tx,
      connectionId,
      `ari_answer_unrecognized:${kind}`,
      'A later update of the same values was confirmed by the hub.',
    );
}

async function record(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  c: Extract<Claim, { kind: 'send' }>,
  kind: AriKind,
  outcome: { ok: true; result: AriResult; ms: number } | { ok: false; failure: HubFailure; ms: number },
): Promise<DispatchResult> {
  return withTenantTx(database, ctx, async (tx) => {
    // Lock order everywhere: connection row → ARI advisory lock → message row → budget row (no cycles).
    const conn = await loadConnection(tx, c.connectionId, { forUpdate: true });
    const msg = await db(tx)
      .selectFrom('distribution.ari_messages')
      .selectAll()
      .where('id', '=', c.messageId)
      .forUpdate()
      .executeTakeFirst();
    // Whatever the answer (even a late one), the request is complete: count its slot from now (P2-2).
    await restampBudget(tx, deps, conn, kind, c.budgetStamp);
    if (msg?.status !== 'sending' || msg.lease_token !== c.token) {
      // A late answer for a send that was already taken over or decided: logged, never applied.
      await recordExchange(tx, {
        connectionId: conn.id,
        direction: 'outbound',
        operation: `ari.${kind}`,
        ref: c.messageId,
        httpStatus: outcome.ok ? outcome.result.httpStatus : outcome.failure.httpStatus,
        outcome: 'late_answer_ignored',
        durationMs: outcome.ms,
        provenance: c.provenance,
      });
      return { sent: true, nextDueAt: null, outcome: 'late' };
    }
    const cells = msg.cells as StoredCell[];
    const base = {
      lease_token: null,
      lease_until: null,
      updated_at: tx.now,
      version: sql<number>`version + 1`,
    };
    if (outcome.ok && outcome.result.unrecognizedAnswer) {
      // P2-3: fail closed. The hub answered 2xx in a shape Portico does not recognise: nothing is assumed accepted
      // (channel_state keeps its previous values), the cells show "pending verification", and nothing is resent
      // automatically (an unchanged resend would get the same unreadable answer). A later recognised acceptance of
      // the same cells, a re-push or the nightly resync resolves them.
      await db(tx)
        .updateTable('distribution.ari_messages')
        .set({
          ...base,
          status: 'pending_verification',
          accepted_at: null,
          next_attempt_at: null,
          last_error: `The hub's answer was not recognised: ${outcome.result.unrecognizedWhy ?? 'unknown shape'}.`,
          last_error_class: 'unrecognized_answer',
        })
        .where('id', '=', msg.id)
        .execute();
      await raiseException(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        code: 'ari_answer_unrecognized',
        dedupeKey: `ari_answer_unrecognized:${kind}`,
        severity: 'urgent',
        problem: `The hub answered a ${kind} update with HTTP ${outcome.result.httpStatus} in a format Portico does not recognise (${outcome.result.unrecognizedWhy ?? 'unknown shape'}), so Portico cannot tell whether the channel took the values.`,
        businessImpact: `${cells.length} ${kind} value(s) are shown as "pending verification" on the channel calendar; the channel may still show its previous values.`,
        responsibleParty: 'monoclay',
        nextStep:
          'Monoclay support checks the hub’s answer format. Meanwhile compare the dates with the channel extranet; a re-push (channel calendar) sends them again.',
        refs: [{ type: RECORD.ariMessage, id: msg.id }],
      });
      await recordExchange(tx, {
        connectionId: conn.id,
        direction: 'outbound',
        operation: `ari.${kind}`,
        ref: msg.id,
        httpStatus: outcome.result.httpStatus,
        outcome: 'pending_verification',
        durationMs: outcome.ms,
        detail: { values: msg.value_count, cells: cells.length, why: outcome.result.unrecognizedWhy ?? null },
        provenance: c.provenance,
      });
      return { sent: true, nextDueAt: tx.now, outcome: 'pending_verification' };
    }
    if (outcome.ok) {
      const refusedIdx = new Set(outcome.result.refused.map((r) => r.index));
      const refused = cells.filter((x) => refusedIdx.has(x.i));
      const accepted = cells.filter((x) => !refusedIdx.has(x.i));
      const status =
        refused.length === 0 ? 'accepted' : accepted.length === 0 ? 'rejected' : 'partially_accepted';
      await upsertChannelState(tx, conn.id, kind, { id: msg.id, seq: msg.seq }, accepted);
      await settleUnverified(tx, conn.id, kind, msg.seq, accepted);
      await db(tx)
        .updateTable('distribution.ari_messages')
        .set({
          ...base,
          status,
          accepted_at: accepted.length ? tx.now : null,
          next_attempt_at: null,
          rejected_cells: refused.length ? json(refused) : null,
          last_error: refused.length
            ? outcome.result.refused
                .map((r) => r.message)
                .slice(0, 5)
                .join(' | ')
            : null,
          last_error_class: refused.length ? 'payload' : null,
        })
        .where('id', '=', msg.id)
        .execute();
      if (accepted.length) {
        await db(tx)
          .updateTable('distribution.connections')
          .set({ last_push_at: tx.now })
          .where('id', '=', conn.id)
          .execute();
      }
      await autoResolve(
        tx,
        conn.id,
        `ari_delivery:${kind}`,
        `The channel accepted the update at ${tx.now.toISOString()}.`,
      );
      // Verify is the ONLY path to a valid key (P2-6): a send claimed with the old key never validates a key that was
      // replaced or refused meanwhile.
      if (refused.length) {
        await raiseException(tx, {
          connectionId: conn.id,
          propertyId: conn.property_id,
          code: 'ari_refused',
          dedupeKey: `ari_refused:${kind}:${msg.id}`,
          severity: accepted.length ? 'routine' : 'urgent',
          problem: `The channel refused ${refused.length} of ${cells.length} ${kind} value(s): ${outcome.result.refused[0]?.message ?? 'no reason given'}.`,
          businessImpact: `Those nights show "not accepted by channel": the channel keeps its previous ${kind} for them.`,
          responsibleParty: 'hotel',
          nextStep:
            kind === 'restrictions'
              ? 'Check the price or restriction against the channel’s rules (for example a minimum price) and change it in Portico; the change is sent automatically. Portico does not resend refused values unchanged.'
              : 'Check the room mapping at the hub; then re-push the dates from the channel calendar.',
          refs: [{ type: RECORD.ariMessage, id: msg.id }],
        });
      }
      if (accepted.length) {
        await tx.emit({
          type: E.ariAccepted,
          propertyId: conn.property_id,
          aggregate: { type: RECORD.ariMessage, id: msg.id },
          aggregateVersion: msg.version + 1,
          payload: {
            connectionId: conn.id,
            propertyId: conn.property_id,
            messageId: msg.id,
            kind,
            cells: accepted.length,
            refusedCells: refused.length,
          },
        });
      }
      if (refused.length) {
        await tx.emit({
          type: E.ariRejected,
          propertyId: conn.property_id,
          aggregate: { type: RECORD.ariMessage, id: msg.id },
          aggregateVersion: msg.version + 1,
          payload: {
            connectionId: conn.id,
            propertyId: conn.property_id,
            messageId: msg.id,
            kind,
            cells: accepted.length,
            refusedCells: refused.length,
          },
        });
      }
      await recordExchange(tx, {
        connectionId: conn.id,
        direction: 'outbound',
        operation: `ari.${kind}`,
        ref: msg.id,
        httpStatus: outcome.result.httpStatus,
        outcome: status,
        durationMs: outcome.ms,
        detail: {
          values: msg.value_count,
          cells: cells.length,
          refused: refused.length,
          ...(outcome.result.unrecognizedAnswer ? { unrecognizedAnswer: true } : {}),
        },
        provenance: c.provenance,
      });
      return { sent: true, nextDueAt: tx.now, outcome: status };
    }
    const f = outcome.failure;
    await recordExchange(tx, {
      connectionId: conn.id,
      direction: 'outbound',
      operation: `ari.${kind}`,
      ref: msg.id,
      httpStatus: f.httpStatus,
      outcome: f.class,
      durationMs: outcome.ms,
      detail: { message: f.message, outcomeUnknown: f.outcomeUnknown },
      provenance: c.provenance,
    });
    if (f.class === 'payload') {
      await db(tx)
        .updateTable('distribution.ari_messages')
        .set({
          ...base,
          status: 'rejected',
          next_attempt_at: null,
          rejected_cells: json(cells),
          last_error: f.message,
          last_error_class: 'payload',
        })
        .where('id', '=', msg.id)
        .execute();
      await raiseException(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        code: 'ari_refused',
        dedupeKey: `ari_refused:${kind}:${msg.id}`,
        severity: 'urgent',
        problem: f.message,
        businessImpact: `None of these ${kind} values reached the channel; it keeps its previous values for those nights.`,
        responsibleParty: 'monoclay',
        nextStep:
          'Portico does not resend a refused request unchanged. Monoclay support checks the request against the hub’s rules; once fixed, re-push the dates from the channel calendar.',
        refs: [{ type: RECORD.ariMessage, id: msg.id }],
      });
      await tx.emit({
        type: E.ariRejected,
        propertyId: conn.property_id,
        aggregate: { type: RECORD.ariMessage, id: msg.id },
        aggregateVersion: msg.version + 1,
        payload: {
          connectionId: conn.id,
          propertyId: conn.property_id,
          messageId: msg.id,
          kind,
          cells: 0,
          refusedCells: cells.length,
        },
      });
      return { sent: true, nextDueAt: tx.now, outcome: 'rejected' };
    }
    const firstFailed = msg.first_failed_at ? new Date(msg.first_failed_at) : tx.now;
    const next = nextAttemptAt(tx.now, msg.attempts, f);
    await db(tx)
      .updateTable('distribution.ari_messages')
      .set({
        ...base,
        status: 'failed_transient',
        next_attempt_at: next,
        first_failed_at: firstFailed,
        last_error: f.message,
        last_error_class: f.class,
      })
      .where('id', '=', msg.id)
      .execute();
    if (f.class === 'rate_limited') {
      await pauseBudget(
        tx,
        conn.id,
        kind,
        new Date(tx.now.getTime() + Math.max(RATE_LIMIT_PAUSE_MS, (f.retryAfterSeconds ?? 0) * 1000)),
      );
    }
    if (f.class === 'auth') {
      await markCredentialsInvalid(tx, conn, f.message);
    } else {
      const urgent = isEscalated(firstFailed, tx.now);
      await raiseException(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        code: 'ari_delivery_failing',
        dedupeKey: `ari_delivery:${kind}`,
        severity: urgent ? 'urgent' : 'routine',
        problem: `${f.message} Failing since ${firstFailed.toISOString()}; next attempt ${next.toISOString()}.`,
        businessImpact: urgent
          ? `The channel has not confirmed ${kind} changes for more than 30 minutes: it may sell nights Portico no longer has.`
          : `The channel may show outdated ${kind} until the retry succeeds.`,
        responsibleParty: 'vendor',
        nextStep: urgent
          ? 'Check the hub’s status page; consider closing the last units on this channel (stop-sell). Portico keeps retrying every minute.'
          : 'No action needed yet: Portico retries automatically.',
        refs: [{ type: RECORD.ariMessage, id: msg.id }],
      });
    }
    return { sent: true, nextDueAt: f.class === 'auth' ? null : next, outcome: 'failed_transient' };
  });
}

/**
 * Build and send at most one message for (connection, kind). `onRecorded` (health refresh and protection) runs
 * after the outcome committed, in its own transaction, so health always reflects the outcome it follows.
 */
export async function dispatchKind(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  kind: AriKind,
  onRecorded: (tx: TxContext, conn: ConnectionRow) => Promise<void> = async () => {},
): Promise<DispatchResult> {
  const c = await claim(database, deps, ctx, connectionId, kind);
  if (c.kind === 'skip') return { sent: false, nextDueAt: c.nextDueAt };
  const started = Date.now();
  let outcome: { ok: true; result: AriResult; ms: number } | { ok: false; failure: HubFailure; ms: number };
  try {
    const result =
      kind === 'availability'
        ? await deps.hub.pushAvailability(c.hubCtx, c.batch.availability)
        : await deps.hub.pushRestrictions(c.hubCtx, c.batch.restrictions);
    outcome = { ok: true, result, ms: Date.now() - started };
  } catch (err) {
    if (!(err instanceof HubError)) {
      outcome = {
        ok: false,
        failure: {
          class: 'transient',
          message: 'An unexpected error happened while calling the hub; Portico retries automatically.',
          httpStatus: null,
          retryAfterSeconds: null,
          outcomeUnknown: true,
          detail: { error: err instanceof Error ? err.name : 'unknown' },
        },
        ms: Date.now() - started,
      };
    } else {
      outcome = { ok: false, failure: err.failure, ms: Date.now() - started };
    }
  }
  const result = await record(database, deps, ctx, c, kind, outcome);
  // Health and protection follow the committed outcome, in their own transaction (protection marks cells dirty
  // under the ARI lock, which must never be awaited while holding a message row).
  if (result.outcome !== 'late') {
    await withTenantTx(database, ctx, async (tx) => onRecorded(tx, await loadConnection(tx, c.connectionId)));
  }
  return result;
}
