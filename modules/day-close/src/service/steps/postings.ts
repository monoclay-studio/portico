/**
 * Step 3 — room and package postings (DCL-R02.3, DCL-I01, DCL-I04, DCL-R04).
 *
 * Every stay in house for night D (plus catch-up nights and deferred lines that became due) is one ITEM. An item
 * runs in its own transaction: it posts every line of the night from the agreed (sealed) terms through rates'
 * posting plan — room, inclusions and added items through `finance.postCharge`, allowances through
 * `finance.grantAllowance` — each with the plan's deterministic key (`room:{stay}:{night}`,
 * `inclusion:{stay}:{inclusion}:{night}`), then writes the stay-night register row and the item's progress, and
 * commits all of it at once. A crash mid-item rolls the whole item back; a resume skips items that are done and
 * never calls finance for them again ("resume, never redo"). Finance's unique keys are the second guard.
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, type LocalDate, newId } from '@portico/kernel';
import type { StepKey } from '../../contracts';
import { toFailure } from '../../domain/errors';
import type { AllowanceEntitlement, PostingLine, StayNight } from '../../ports';
import { db, json } from '../context';
import { catchUpNights } from '../readiness';
import { closeIssue, loadItems, recordItem, upsertIssue } from '../repo';
import { isFatal, itemOverrideKey, type StepContext, type StepOutcome } from './shared';

export interface NightResult {
  alreadyPosted: boolean;
  postingKeys: string[];
  entryIds: string[];
  deferred: string[];
  skippedLines: Array<{ key: string; reason: string }>;
  amounts: Record<string, { amountMinor: number; currency: string }>;
}

function priceMode(line: PostingLine): 'inclusive' | 'exclusive' {
  const m = line.taxInclusion.mode;
  if (m === 'inclusive' || m === 'exclusive') return m;
  throw new BusinessRuleError(
    'tax_inclusion_unsupported',
    `Line ${line.idempotencyKey} uses the tax inclusion mode "${m}", which finance cannot post yet. Nothing was posted for this stay-night; post it by hand or override this item.`,
    { line: line.idempotencyKey, mode: m },
  );
}

/**
 * Post one stay-night from its agreed terms (inside the caller's transaction). `businessDate` is the date the
 * posting lands on (D, or a later date for a catch-up — finance then gets the late-posting reason).
 */
export async function postStayNight(
  s: Pick<StepContext, 'deps' | 'run' | 'property'>,
  tx: TxContext,
  stay: StayNight,
  businessDate: LocalDate,
): Promise<NightResult> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  if (stay.propertyId !== propertyId) {
    throw new BusinessRuleError(
      'stay_other_property',
      'This stay belongs to another property; nothing was posted.',
    );
  }
  const existing = await db(tx)
    .selectFrom('day_close.night_postings')
    .select(['posting_keys', 'entry_ids'])
    .where('stay_id', '=', stay.stayId)
    .where('night', '=', stay.night)
    .executeTakeFirst();
  if (existing) {
    return {
      alreadyPosted: true,
      postingKeys: existing.posting_keys,
      entryIds: existing.entry_ids,
      deferred: [],
      skippedLines: [],
      amounts: {},
    };
  }
  if (!ports.rates.verifyTerms(stay.terms)) {
    throw new BusinessRuleError(
      'terms_seal_invalid',
      `The agreed terms of this stay fail their seal check, so Day Close will not post night ${stay.night} from them. Open the stay and re-confirm its price, then resume; or override this item and post the night by hand.`,
      { stayId: stay.stayId, night: stay.night },
    );
  }
  const plan = ports.rates.postingPlan(stay.terms, stay.stayId).filter((l) => l.nightDate === stay.night);
  if (plan.length === 0) {
    throw new BusinessRuleError(
      'night_not_in_terms',
      `The agreed terms of this stay do not include night ${stay.night} (the stay dates and its price disagree). Re-price the stay, then resume; or override this item.`,
      { stayId: stay.stayId, night: stay.night },
    );
  }
  const catchUp = stay.night < businessDate;
  const out: NightResult = {
    alreadyPosted: false,
    postingKeys: [],
    entryIds: [],
    deferred: [],
    skippedLines: [],
    amounts: {},
  };
  const allowances = ports.rates.allowances(stay.terms);
  for (const line of plan) {
    if (!Number.isSafeInteger(line.amount.amountMinor) || line.amount.amountMinor < 0) {
      throw new BusinessRuleError(
        'invalid_agreed_price',
        `Line ${line.idempotencyKey} of the agreed terms has an invalid amount (${line.amount.amountMinor}). Correct the stay's price, then resume; or override this item.`,
        { line: line.idempotencyKey },
      );
    }
    if (line.amount.amountMinor === 0) {
      out.skippedLines.push({ key: line.idempotencyKey, reason: 'zero_amount' });
      continue;
    }
    if (line.serviceDate > businessDate) {
      await db(tx)
        .insertInto('day_close.deferred_lines')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: propertyId,
          stay_id: stay.stayId,
          night: stay.night,
          service_date: line.serviceDate,
          idempotency_key: line.idempotencyKey,
          line: json({ ...line, occupancy: stay.occupancy }),
          status: 'pending',
          created_run_id: s.run.id,
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).doNothing())
        .execute();
      out.deferred.push(line.idempotencyKey);
      continue;
    }
    if (line.kind === 'allowance') {
      const ent = allowances.find((a) => a.inclusionId === line.inclusionId);
      if (ent?.kind !== 'monetary') {
        out.skippedLines.push({ key: line.idempotencyKey, reason: 'quantity_allowance_not_postable' });
        continue;
      }
      const g = await grantAllowanceLine(s, tx, stay, line, ent);
      out.postingKeys.push(line.idempotencyKey);
      out.entryIds.push(g.entryId);
    } else {
      const r = await ports.finance.postCharge(
        tx,
        { propertyId },
        {
          propertyId,
          target: { type: 'stay', id: stay.stayId },
          chargeCode: line.chargeCode,
          amount: line.amount,
          quantity: line.quantity,
          priceMode: priceMode(line),
          serviceDate: line.serviceDate,
          revenueDate: stay.night,
          description: `${line.kind === 'room' ? 'Room' : line.chargeCode} — night ${stay.night}`,
          sourceRef: { type: 'stay', id: stay.stayId },
          idempotencyKey: line.idempotencyKey,
          taxMode: 'compute',
          ...(catchUp
            ? {
                reason: `Night ${stay.night} was not posted by its own Day Close (the guest checked in after that night's postings); posted by Day Close of ${businessDate}.`,
              }
            : {}),
          occupancy: line.occupancy ?? stay.occupancy,
          ...(line.agreedRuleVersionIds.length ? { agreedRuleVersionIds: line.agreedRuleVersionIds } : {}),
        },
      );
      out.postingKeys.push(line.idempotencyKey);
      out.entryIds.push(r.entryId);
    }
    const bucket = line.kind === 'room' ? 'room' : line.kind === 'allowance' ? 'allowances' : 'inclusions';
    const prev = out.amounts[bucket] ?? { amountMinor: 0, currency: line.amount.currency };
    out.amounts[bucket] = {
      amountMinor: prev.amountMinor + line.amount.amountMinor,
      currency: prev.currency,
    };
  }
  await db(tx)
    .insertInto('day_close.night_postings')
    .values({
      tenant_id: tx.tenantId,
      property_id: propertyId,
      stay_id: stay.stayId,
      night: stay.night,
      run_id: s.run.id,
      business_date: businessDate,
      posting_keys: out.postingKeys,
      entry_ids: out.entryIds,
      amounts: json(out.amounts),
      catch_up: catchUp,
      posted_at: tx.now,
    })
    .execute();
  return out;
}

/** Grant one night's allowance from the plan line (key = the plan's key, so a pre-grant and the posting step agree). */
async function grantAllowanceLine(
  s: Pick<StepContext, 'deps' | 'property'>,
  tx: TxContext,
  stay: StayNight,
  line: PostingLine,
  ent: AllowanceEntitlement,
): Promise<{ entryId: string; replayed: boolean }> {
  const propertyId = s.property.id;
  const folioId = (await s.deps.ports.finance.defaultFolio(tx, { propertyId }, stay.stayId))?.folioId ?? null;
  if (!folioId) {
    throw new BusinessRuleError(
      'stay_folio_missing',
      'This stay has no folio yet, so its allowance cannot be granted. Open the stay folio (check-in does this), then resume.',
      { stayId: stay.stayId },
    );
  }
  const g = await s.deps.ports.finance.grantAllowance(
    tx,
    { propertyId },
    {
      propertyId,
      stayId: stay.stayId,
      folioId,
      definitionRef: ent.inclusionId,
      label: ent.name,
      period: { night: line.nightDate },
      amount: line.amount,
      chargeCode: line.chargeCode,
      ...(ent.eligibleChargeCodes.length ? { eligibleChargeCodes: ent.eligibleChargeCodes } : {}),
      coversTaxes: true,
      unusedPolicy: ent.remainderPolicy === 'forfeit' ? 'forfeit' : 'carry_forward',
      idempotencyKey: line.idempotencyKey,
    },
  );
  return { entryId: g.entryId, replayed: g.replayed };
}

/**
 * After the advance to N: grant tonight's (N) allowances of stays continuing into N, so guests can use them during
 * the day; the posting step of N replays the same keys (never granted twice). Failures never undo the close: the
 * posting step of N grants whatever is missing.
 */
export async function pregrantAllowances(s: StepContext, night: LocalDate): Promise<Record<string, unknown>> {
  const propertyId = s.property.id;
  const stays = await s.inTx((tx) =>
    s.deps.ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: night }),
  );
  let granted = 0;
  const failed: Array<{ stayId: string; code: string }> = [];
  for (const stay of stays) {
    const ents = s.deps.ports.rates.allowances(stay.terms).filter((a) => a.kind === 'monetary');
    if (!ents.length || !s.deps.ports.rates.verifyTerms(stay.terms)) continue;
    const lines = s.deps.ports.rates
      .postingPlan(stay.terms, stay.stayId)
      .filter((l) => l.kind === 'allowance' && l.nightDate === night && l.amount.amountMinor > 0);
    for (const line of lines) {
      const ent = ents.find((a) => a.inclusionId === line.inclusionId);
      if (!ent) continue;
      try {
        await s.inTx((tx) => grantAllowanceLine(s, tx, stay, line, ent));
        granted++;
      } catch (err) {
        if (isFatal(err)) throw err;
        failed.push({ stayId: stay.stayId, code: toFailure(err).code });
      }
    }
  }
  return { night, granted, failed };
}

interface WorkItem {
  key: string;
  ref: { type: string; id: string };
  kind: 'night' | 'deferred';
  stay?: StayNight;
  deferredId?: string;
}

async function workList(s: StepContext): Promise<WorkItem[]> {
  const { ports } = s.deps;
  const D = s.run.business_date;
  const propertyId = s.property.id;
  return s.inTx(async (tx) => {
    const items: WorkItem[] = [];
    const seen = new Set<string>();
    const add = (stay: StayNight) => {
      const key = `night:${stay.stayId}:${stay.night}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ key, ref: { type: 'stay', id: stay.stayId }, kind: 'night', stay });
    };
    // Catch-up first (DCL-R04): nights before D that their own Day Close could not post.
    const missing = await catchUpNights(s.deps, tx, propertyId, D, s.policy, null);
    const byNight = new Map<string, Set<string>>();
    for (const m of missing) byNight.set(m.night, (byNight.get(m.night) ?? new Set()).add(m.stayId));
    for (const [night, stayIds] of [...byNight.entries()].sort()) {
      for (const st of await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: night }))
        if (stayIds.has(st.stayId)) add(st);
    }
    for (const st of await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D })) add(st);
    const deferred = await db(tx)
      .selectFrom('day_close.deferred_lines')
      .select(['id', 'idempotency_key', 'stay_id'])
      .where('property_id', '=', propertyId)
      .where('status', '=', 'pending')
      .where('service_date', '<=', D)
      .orderBy('service_date')
      .orderBy('idempotency_key')
      .execute();
    for (const d of deferred) {
      items.push({
        key: `deferred:${d.idempotency_key}`,
        ref: { type: 'stay', id: d.stay_id },
        kind: 'deferred',
        deferredId: d.id,
      });
    }
    return items;
  });
}

async function postDeferred(
  s: StepContext,
  tx: TxContext,
  deferredId: string,
): Promise<Record<string, unknown>> {
  const row = await db(tx)
    .selectFrom('day_close.deferred_lines')
    .selectAll()
    .where('id', '=', deferredId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (row.status === 'posted') return { alreadyPosted: true, entryId: row.entry_id };
  const line = row.line as PostingLine;
  const propertyId = s.property.id;
  const r = await s.deps.ports.finance.postCharge(
    tx,
    { propertyId },
    {
      propertyId,
      target: { type: 'stay', id: row.stay_id },
      chargeCode: line.chargeCode,
      amount: line.amount,
      quantity: line.quantity,
      priceMode: priceMode(line),
      serviceDate: row.service_date,
      revenueDate: row.night,
      description: `${line.chargeCode} — service ${row.service_date} (night ${row.night})`,
      sourceRef: { type: 'stay', id: row.stay_id },
      idempotencyKey: row.idempotency_key,
      taxMode: 'compute',
      occupancy: line.occupancy,
      ...(line.agreedRuleVersionIds?.length ? { agreedRuleVersionIds: line.agreedRuleVersionIds } : {}),
    },
  );
  await db(tx)
    .updateTable('day_close.deferred_lines')
    .set({
      status: 'posted',
      posted_run_id: s.run.id,
      entry_id: r.entryId,
      posted_at: tx.now,
      version: row.version + 1,
    })
    .where('id', '=', row.id)
    .execute();
  return { entryId: r.entryId, key: row.idempotency_key };
}

/**
 * Process a list of items for a step: one transaction per item, item progress committed with the effect, failures
 * recorded (and the step continues with the other items), done items never redone.
 */
export async function processItems(
  s: StepContext,
  step: StepKey,
  items: WorkItem[],
  done: (tx: TxContext, item: WorkItem) => Promise<Record<string, unknown>>,
): Promise<{ failed: number }> {
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  const overrides = await s.inTx((tx) =>
    db(tx).selectFrom('day_close.overrides').select(['item_key']).where('run_id', '=', s.run.id).execute(),
  );
  const overridden = new Set(overrides.map((o) => o.item_key));
  let failed = 0;
  let index = 0;
  for (const item of items) {
    index++;
    const prior = recorded.get(item.key);
    if (prior && (prior.status === 'done' || prior.status === 'skipped')) continue;
    if (prior?.status === 'failed' && overridden.has(itemOverrideKey(step, item.key))) {
      await s.inTx(async (tx) => {
        await recordItem(tx, {
          runId: s.run.id,
          step,
          itemKey: item.key,
          ref: item.ref,
          status: 'skipped',
          result: { reason: 'override' },
        });
        await closeIssue(tx, `step_item_failed:${s.run.id}:${step}:${item.key}`, 'Overridden with a reason');
      });
      continue;
    }
    try {
      await s.inTx(async (tx) => {
        const result = await done(tx, item);
        await recordItem(tx, {
          runId: s.run.id,
          step,
          itemKey: item.key,
          ref: item.ref,
          status: 'done',
          result,
        });
        if (prior?.status === 'failed')
          await closeIssue(tx, `step_item_failed:${s.run.id}:${step}:${item.key}`, 'Succeeded on resume');
        await s.hooks.insideItem?.(step, index);
      });
      await s.hooks.afterItem?.(step, index);
    } catch (err) {
      if (isFatal(err)) throw err;
      failed++;
      const f = toFailure(err);
      await s.inTx(async (tx) => {
        await recordItem(tx, {
          runId: s.run.id,
          step,
          itemKey: item.key,
          ref: item.ref,
          status: 'failed',
          error: f,
        });
        if (!f.retryable) {
          await upsertIssue(tx, {
            propertyId: s.property.id,
            businessDate: s.run.business_date,
            runId: s.run.id,
            code: 'step_item_failed',
            severity: 'blocking',
            dedupeKey: `step_item_failed:${s.run.id}:${step}:${item.key}`,
            ref: item.ref,
            message: `Day Close could not finish "${item.key}": ${f.message}`,
            owner: { kind: 'department', id: 'night_audit' },
            details: { step, itemKey: item.key, code: f.code },
          });
        }
      });
    }
  }
  return { failed };
}

export async function roomAndPackagePostings(s: StepContext): Promise<StepOutcome> {
  const D = s.run.business_date;
  const step: StepKey = 'room_and_package_postings';
  const all = new Map<string, WorkItem>();
  let failed = 0;
  for (let round = 0; round < s.deps.config.sweepRounds; round++) {
    const list = (await workList(s)).filter((i) => !all.has(i.key));
    if (round > 0 && list.length === 0) break;
    for (const i of list) all.set(i.key, i);
    const total = await s.inTx(async (tx) => {
      const recorded = await loadItems(tx, s.run.id, step);
      return new Set([...recorded.keys(), ...all.keys()]).size;
    });
    await s.inTx((tx) =>
      db(tx)
        .updateTable('day_close.steps')
        .set({ total })
        .where('run_id', '=', s.run.id)
        .where('key', '=', step)
        .execute(),
    );
    const r = await processItems(s, step, list, async (tx, item) => {
      if (item.kind === 'deferred') return postDeferred(s, tx, item.deferredId as string);
      const res = await postStayNight(s, tx, item.stay as StayNight, D);
      return { ...res };
    });
    failed = r.failed;
  }
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  const stillFailed = [...recorded.values()].filter((i) => i.status === 'failed');
  if (stillFailed.length) {
    const retryable = stillFailed.every(
      (i) => (i.error as { retryable?: boolean } | null)?.retryable !== false,
    );
    return {
      status: 'failed',
      total: recorded.size,
      error: {
        code: 'items_failed',
        message: `${stillFailed.length} stay-night(s) could not be posted. Every other stay-night is posted and kept. Fix the listed items, then resume (only they are retried), or override an item with a reason.`,
        retryable,
      },
    };
  }
  void failed;
  return { status: 'completed', total: recorded.size };
}

/** Sweep before the advance: in-house stays of D without a posting (checked in after step 3) — EC-DCL-004. */
export async function sweepNight(s: StepContext): Promise<StepOutcome | null> {
  const D = s.run.business_date;
  const propertyId = s.property.id;
  const missing = await s.inTx(async (tx) => {
    const stays = await s.deps.ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D });
    if (!stays.length) return [];
    const posted = await db(tx)
      .selectFrom('day_close.night_postings')
      .select('stay_id')
      .where('property_id', '=', propertyId)
      .where('night', '=', D)
      .execute();
    const done = new Set(posted.map((p) => p.stay_id));
    return stays.filter((st) => !done.has(st.stayId));
  });
  if (!missing.length) return null;
  const items: WorkItem[] = missing.map((st) => ({
    key: `night:${st.stayId}:${st.night}`,
    ref: { type: 'stay', id: st.stayId },
    kind: 'night',
    stay: st,
  }));
  const r = await processItems(s, 'advance', items, async (tx, item) => ({
    ...(await postStayNight(s, tx, item.stay as StayNight, D)),
    sweep: true,
  }));
  if (r.failed > 0) {
    return {
      status: 'failed',
      error: {
        code: 'items_failed',
        message: `${r.failed} stay-night(s) checked in during Day Close could not be posted. Fix them and resume, or override them with a reason.`,
        retryable: true,
      },
    };
  }
  return null;
}
