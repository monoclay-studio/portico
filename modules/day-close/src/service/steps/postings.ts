/**
 * Postings (DCL-R02.3, DCL-I01, DCL-I04, DCL-R04) — what gets posted, and when, from the agreement IN FORCE.
 *
 * Identity (review P0-1). Every line is posted under rates' stable line identity (`lineKey`: the component and its
 * occurrence — the night for nightly lines, "arrival" / "departure" / the n-th stay night otherwise — never the night
 * a line happens to be allocated to) and registered in `day_close.line_postings`. A re-price that moves a line to
 * another night keeps its identity: it is never posted twice, and a change after posting raises a follow-up.
 *
 * Items. Every stay-night (in house for D, catch-up nights, watched departed stays) is one ITEM in its own
 * transaction: lines of that night are posted, future-dated lines of the agreement are recorded as expectations
 * (`deferred_lines`, reconciled against the agreement at every close), the stay-night register row and the item's
 * progress commit together. A crash mid-item rolls the whole item back; resume skips done items. Each line posts in
 * a savepoint: finance holding the key with other content (`idempotency_conflict`) is recorded with a follow-up and
 * never rolls back the night's other lines (review P0-2).
 *
 * Decisions (review P1-1). A night a person overrode is a decision, not a gap: the catch-up never posts it until the
 * person decides "post it" (then once, with the plan key) or "posted elsewhere".
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { BusinessRuleError, DomainError, type LocalDate, type Money, newId } from '@portico/kernel';
import type { StepKey } from '../../contracts';
import { type FailureRecord, toFailure } from '../../domain/errors';
import type { AllowanceEntitlement, PostingLine, StayAgreement, StayNight } from '../../ports';
import { db, json } from '../context';
import { catchUpNights, latestDecisions, nightsClosed } from '../readiness';
import { closeIssue, loadItems, recordItem, upsertIssue } from '../repo';
import { isFatal, itemOverrideKey, type StepContext, type StepOutcome } from './shared';

type PostCtx = Pick<StepContext, 'deps' | 'run' | 'property'>;
type LineStay = { stayId: string; occupancy: StayNight['occupancy']; terms: unknown };

export interface NightResult {
  alreadyPosted: boolean;
  decided?: string;
  postingKeys: string[];
  entryIds: string[];
  expected: string[];
  skippedLines: Array<{ key: string; reason: string }>;
  amounts: Record<string, { amountMinor: number; currency: string }>;
}

function priceMode(line: PostingLine): 'inclusive' | 'exclusive' {
  const m = line.taxInclusion.mode;
  if (m === 'inclusive' || m === 'exclusive') return m;
  throw new BusinessRuleError(
    'tax_inclusion_unsupported',
    `Line ${line.lineKey} uses the tax inclusion mode "${m}", which finance cannot post yet. Nothing was posted for this stay-night; override this item to decide later (Day Close then asks whether to post it or confirm it was charged another way).`,
    { line: line.lineKey, mode: m },
  );
}

const IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
const notConnected = (err: unknown) => err instanceof DomainError && err.code === 'module_not_available';

/** Grant one night's allowance under the plan line's identity. */
async function grantAllowanceLine(
  s: PostCtx,
  tx: TxContext,
  stayId: string,
  line: PostingLine,
  ent: AllowanceEntitlement,
): Promise<{ entryId: string; replayed: boolean }> {
  const propertyId = s.property.id;
  const folioId = (await s.deps.ports.finance.defaultFolio(tx, { propertyId }, stayId))?.folioId ?? null;
  if (!folioId) {
    throw new BusinessRuleError(
      'stay_folio_missing',
      'This stay has no folio yet, so its allowance cannot be granted. Open the stay folio (check-in does this), then resume.',
      { stayId },
    );
  }
  const g = await s.deps.ports.finance.grantAllowance(
    tx,
    { propertyId },
    {
      propertyId,
      stayId,
      folioId,
      definitionRef: ent.inclusionId,
      label: ent.name,
      period: { night: line.nightDate },
      amount: line.amount,
      chargeCode: line.chargeCode,
      ...(ent.eligibleChargeCodes.length ? { eligibleChargeCodes: ent.eligibleChargeCodes } : {}),
      coversTaxes: true,
      unusedPolicy: ent.remainderPolicy === 'forfeit' ? 'forfeit' : 'carry_forward',
      idempotencyKey: line.lineKey,
    },
  );
  return { entryId: g.entryId, replayed: g.replayed };
}

/**
 * Post one agreement line by its stable identity, inside a savepoint. Already registered → never re-sent (a change
 * since raises `posted_line_changed`). Finance holding the key with other content → recorded as `conflict` with a
 * follow-up; the caller's other lines continue.
 */
async function postLine(
  s: PostCtx,
  tx: TxContext,
  stay: LineStay,
  line: PostingLine,
  businessDate: LocalDate,
  reason: string | null,
): Promise<{ outcome: 'posted' | 'already' | 'conflict' | 'not_postable'; entryId: string | null }> {
  const propertyId = s.property.id;
  const prior = await db(tx)
    .selectFrom('day_close.line_postings')
    .selectAll()
    .where('stay_id', '=', stay.stayId)
    .where('line_key', '=', line.lineKey)
    .executeTakeFirst();
  if (prior) {
    if (prior.service_date !== line.serviceDate || Number(prior.amount_minor) !== line.amount.amountMinor) {
      await upsertIssue(tx, {
        propertyId,
        businessDate: s.run.business_date,
        runId: s.run.id,
        code: 'posted_line_changed',
        severity: 'warning',
        dedupeKey: `posted_line_changed:${stay.stayId}:${line.lineKey}:${line.serviceDate}:${line.amount.amountMinor}`,
        ref: { type: 'stay', id: stay.stayId },
        message: `${line.chargeCode} was already charged once (service ${prior.service_date}, ${(Number(prior.amount_minor) / 100).toFixed(2)} ${prior.currency}); the agreement now says service ${line.serviceDate}, ${(line.amount.amountMinor / 100).toFixed(2)} ${line.amount.currency}. Day Close never charges it twice; correct the charge in finance if what was charged did not happen.`,
        owner: { kind: 'department', id: 'finance' },
        details: {
          lineKey: line.lineKey,
          postedServiceDate: prior.service_date,
          nowServiceDate: line.serviceDate,
        },
      });
    }
    return { outcome: 'already', entryId: prior.entry_id };
  }
  const register = (outcome: 'posted' | 'conflict', entryId: string | null) =>
    db(tx)
      .insertInto('day_close.line_postings')
      .values({
        tenant_id: tx.tenantId,
        property_id: propertyId,
        stay_id: stay.stayId,
        line_key: line.lineKey,
        night: line.nightDate,
        service_date: line.serviceDate,
        kind: line.kind,
        amount_minor: line.amount.amountMinor,
        currency: line.amount.currency,
        outcome,
        entry_id: entryId,
        run_id: s.run.id,
        business_date: businessDate,
        posted_at: tx.now,
      })
      .execute();
  try {
    const entryId = await withSavepoint(tx, 'dcl_line', async () => {
      if (line.kind === 'allowance') {
        const ents = stay.terms ? s.deps.ports.rates.allowances(stay.terms) : [];
        const ent = ents.find((a) => a.inclusionId === line.inclusionId);
        if (ent?.kind !== 'monetary') return null;
        return (await grantAllowanceLine(s, tx, stay.stayId, line, ent)).entryId;
      }
      const r = await s.deps.ports.finance.postCharge(
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
          revenueDate: line.nightDate,
          description: `${line.kind === 'room' ? 'Room' : line.chargeCode} — ${line.occurrence.rhythm === 'nightly' ? `night ${line.nightDate}` : `${line.occurrence.rhythm.replace('_', ' ')} (${line.serviceDate})`}`,
          sourceRef: { type: 'stay', id: stay.stayId },
          idempotencyKey: line.lineKey,
          taxMode: 'compute',
          ...(reason ? { reason } : {}),
          occupancy: line.occupancy ?? stay.occupancy,
          ...(line.agreedRuleVersionIds.length ? { agreedRuleVersionIds: line.agreedRuleVersionIds } : {}),
        },
      );
      return r.entryId;
    });
    if (entryId === null) return { outcome: 'not_postable', entryId: null };
    await register('posted', entryId);
    return { outcome: 'posted', entryId };
  } catch (err) {
    if (!(err instanceof DomainError) || err.code !== IDEMPOTENCY_CONFLICT) throw err;
    await register('conflict', null);
    await upsertIssue(tx, {
      propertyId,
      businessDate: s.run.business_date,
      runId: s.run.id,
      code: 'posting_conflict',
      severity: 'warning',
      dedupeKey: `posting_conflict:${stay.stayId}:${line.lineKey}`,
      ref: { type: 'stay', id: stay.stayId },
      message: `${line.chargeCode} for ${line.nightDate} was already posted with different details (for example before the guest count changed). Day Close posted the rest of the night and left this line as it is; review it in finance.`,
      owner: { kind: 'department', id: 'finance' },
      details: { lineKey: line.lineKey, amount: line.amount },
    });
    return { outcome: 'conflict', entryId: null };
  }
}

/**
 * Expectations (review P0-1): every future-dated line of the agreement in force (served after its night, e.g. the
 * departure transfer) is recorded pending; a pending line the agreement no longer contains is cancelled. Posted
 * lines are never touched.
 */
async function syncExpectations(
  s: PostCtx,
  tx: TxContext,
  stayId: string,
  plan: PostingLine[],
  night: LocalDate,
) {
  const future = plan.filter((l) => l.serviceDate > l.nightDate);
  const rows = await db(tx)
    .selectFrom('day_close.deferred_lines')
    .selectAll()
    .where('stay_id', '=', stayId)
    .forUpdate()
    .execute();
  const byKey = new Map(rows.map((p) => [p.line_key, p]));
  for (const l of future) {
    const row = byKey.get(l.lineKey);
    if (!row) {
      await db(tx)
        .insertInto('day_close.deferred_lines')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: s.property.id,
          stay_id: stayId,
          line_key: l.lineKey,
          night: l.nightDate,
          service_date: l.serviceDate,
          line: json(l),
          status: 'pending',
          created_run_id: s.run.id,
          updated_run_id: s.run.id,
          updated_at: tx.now,
        })
        .execute();
    } else if (
      row.status !== 'posted' &&
      (row.service_date !== l.serviceDate || row.status === 'cancelled')
    ) {
      await db(tx)
        .updateTable('day_close.deferred_lines')
        .set({
          night: l.nightDate,
          service_date: l.serviceDate,
          line: json(l),
          status: 'pending',
          status_reason: null,
          updated_run_id: s.run.id,
          updated_at: tx.now,
          version: row.version + 1,
        })
        .where('id', '=', row.id)
        .execute();
    }
  }
  const inPlan = new Set(plan.map((l) => l.lineKey));
  for (const row of rows) {
    if (row.status === 'pending' && !inPlan.has(row.line_key)) {
      await db(tx)
        .updateTable('day_close.deferred_lines')
        .set({
          status: 'cancelled',
          status_reason: `no longer in the agreement in force at the close of ${night}`,
          updated_run_id: s.run.id,
          updated_at: tx.now,
          version: row.version + 1,
        })
        .where('id', '=', row.id)
        .execute();
    }
  }
  return future.map((l) => l.lineKey);
}

/** The latest decision on a stay-night a person took over (null when nobody decided anything). */
export async function decisionFor(tx: TxContext, stayId: string, night: LocalDate): Promise<string | null> {
  const d = await db(tx)
    .selectFrom('day_close.night_decisions')
    .select(['decision'])
    .where('stay_id', '=', stayId)
    .where('night', '=', night)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return d?.decision ?? null;
}

/** A zero-price night (complimentary / house use) still owes its statutory levies (review P2-11, CR-10). */
async function raiseLevyNotPosted(s: PostCtx, tx: TxContext, stay: StayNight, businessDate: LocalDate) {
  const levy: Money | null = s.deps.ports.rates.nightLevies(stay.terms, stay.night);
  if (!levy || levy.amountMinor <= 0) return;
  await upsertIssue(tx, {
    propertyId: s.property.id,
    businessDate,
    runId: s.run.id,
    code: 'levy_not_posted',
    severity: 'warning',
    dedupeKey: `levy_not_posted:${stay.stayId}:${stay.night}`,
    ref: { type: 'stay', id: stay.stayId },
    message: `Night ${stay.night} is free of charge, but its statutory levy (${(levy.amountMinor / 100).toFixed(2)} ${levy.currency}, e.g. Green Tax per person) is still owed. Finance cannot post a levy on a zero-price night yet: post it by hand and mark this handled.`,
    owner: { kind: 'department', id: 'finance' },
    details: { night: stay.night, levy },
  });
}

/**
 * Post one stay-night from the agreement in force (inside the caller's transaction). `businessDate` is the date the
 * postings land on (D, or later for a catch-up — finance then gets the late-posting reason).
 */
export async function postStayNight(
  s: PostCtx,
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
  const out: NightResult = {
    alreadyPosted: false,
    postingKeys: [],
    entryIds: [],
    expected: [],
    skippedLines: [],
    amounts: {},
  };
  const existing = await db(tx)
    .selectFrom('day_close.night_postings')
    .select(['posting_keys', 'entry_ids'])
    .where('stay_id', '=', stay.stayId)
    .where('night', '=', stay.night)
    .executeTakeFirst();
  if (existing)
    return { ...out, alreadyPosted: true, postingKeys: existing.posting_keys, entryIds: existing.entry_ids };
  const decision = await decisionFor(tx, stay.stayId, stay.night);
  if (decision === 'skip_pending' || decision === 'posted_elsewhere') return { ...out, decided: decision };
  if (!ports.rates.verifyTerms(stay.terms)) {
    throw new BusinessRuleError(
      'terms_seal_invalid',
      `The agreed terms of this stay fail their seal check, so Day Close will not post night ${stay.night} from them. Open the stay and re-confirm its price, then resume; or override this item to decide later (Day Close then asks whether to post it or confirm it was charged another way).`,
      { stayId: stay.stayId, night: stay.night },
    );
  }
  const plan = ports.rates.postingPlan(stay.terms, stay.stayId);
  const nightLines = plan.filter((l) => l.nightDate === stay.night);
  if (nightLines.length === 0) {
    throw new BusinessRuleError(
      'night_not_in_terms',
      `The agreed terms of this stay do not include night ${stay.night} (the stay dates and its price disagree). Re-price the stay, then resume; or override this item to decide later.`,
      { stayId: stay.stayId, night: stay.night },
    );
  }
  const catchUp = stay.night < businessDate;
  const reason = catchUp
    ? `Night ${stay.night} was not posted by its own Day Close (the guest checked in after that night's postings); posted by Day Close of ${businessDate}.`
    : null;
  out.expected = await syncExpectations(s, tx, stay.stayId, plan, stay.night);
  // Due now: this night's lines served by now, plus once-per-stay lines served by now whose allocated night was
  // already closed (a re-price moved them there) and that were never posted.
  const due = [
    ...nightLines.filter((l) => l.serviceDate <= businessDate),
    ...plan.filter(
      (l) => l.occurrence.rhythm !== 'nightly' && l.nightDate < stay.night && l.serviceDate <= businessDate,
    ),
  ];
  let roomZero = false;
  for (const line of due) {
    if (!Number.isSafeInteger(line.amount.amountMinor) || line.amount.amountMinor < 0) {
      throw new BusinessRuleError(
        'invalid_agreed_price',
        `Line ${line.lineKey} of the agreed terms has an invalid amount (${line.amount.amountMinor}). Correct the stay's price, then resume; or override this item to decide later.`,
        { line: line.lineKey },
      );
    }
    if (line.amount.amountMinor === 0) {
      out.skippedLines.push({ key: line.lineKey, reason: 'zero_amount' });
      if (line.kind === 'room') roomZero = true;
      continue;
    }
    const why =
      reason ??
      (line.serviceDate < businessDate
        ? `Agreement line served on ${line.serviceDate}, posted by Day Close of ${businessDate}.`
        : null);
    const r = await postLine(s, tx, stay, line, businessDate, why);
    if (r.outcome === 'conflict' || r.outcome === 'not_postable')
      out.skippedLines.push({ key: line.lineKey, reason: r.outcome });
    if (r.outcome === 'posted' || r.outcome === 'already') {
      out.postingKeys.push(line.lineKey);
      if (r.entryId) out.entryIds.push(r.entryId);
    }
    if (r.outcome === 'posted') {
      const bucket = line.kind === 'room' ? 'room' : line.kind === 'allowance' ? 'allowances' : 'inclusions';
      const prev = out.amounts[bucket] ?? { amountMinor: 0, currency: line.amount.currency };
      out.amounts[bucket] = {
        amountMinor: prev.amountMinor + line.amount.amountMinor,
        currency: prev.currency,
      };
    }
  }
  if (roomZero) await raiseLevyNotPosted(s, tx, stay, businessDate);
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
  if (decision === 'post_by_day_close')
    await closeIssue(
      tx,
      `night_decision:${stay.stayId}:${stay.night}`,
      `Posted by Day Close of ${businessDate}`,
    );
  return out;
}

/** Build the stay-night of a stay from its agreement (for stays no longer in house). */
export function stayNightFromAgreement(a: StayAgreement, night: LocalDate): StayNight | null {
  const seg = a.segments.find((g) => night >= g.from && night < g.to);
  if (!seg) return null;
  return {
    stayId: a.stayId,
    bookingId: a.bookingId,
    propertyId: a.propertyId,
    night,
    arrival: a.arrival,
    departure: a.departure,
    commercialType: a.commercialType,
    unitId: null,
    unitTypeId: '',
    ratePlanId: '',
    occupancy: a.occupancy,
    terms: seg.terms,
  };
}

export interface WorkItem {
  key: string;
  ref: { type: string; id: string };
  kind: 'night' | 'due';
  stay?: StayNight;
  stayId?: string;
}

async function readAgreement(s: StepContext, tx: TxContext, stayId: string): Promise<StayAgreement | null> {
  try {
    return await withSavepoint(tx, 'dcl_agreement', () =>
      s.deps.ports.reservations.getStayAgreement(tx, { propertyId: s.property.id, stayId }),
    );
  } catch (err) {
    if (notConnected(err)) return null;
    throw err;
  }
}

/** Watched stays (checked in after one of their nights closed, or a decided night) that left (review P2-2). */
async function watchedDeparted(s: StepContext, tx: TxContext, inHouse: Set<string>): Promise<WorkItem[]> {
  const propertyId = s.property.id;
  const D = s.run.business_date;
  const watched = await db(tx)
    .selectFrom('day_close.watched_stays')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('resolved_at', 'is', null)
    .execute();
  if (!watched.length) return [];
  const items: WorkItem[] = [];
  const closed = await nightsClosed(tx, propertyId, D);
  for (const w of watched) {
    if (inHouse.has(w.stay_id)) continue; // still in house: the catch-up finds its nights
    const agreement = await readAgreement(s, tx, w.stay_id);
    const decided = await latestDecisions(tx, w.stay_id);
    const posted = new Set(
      (
        await db(tx)
          .selectFrom('day_close.night_postings')
          .select('night')
          .where('stay_id', '=', w.stay_id)
          .execute()
      ).map((r) => r.night),
    );
    const until = agreement?.departure ?? w.departure;
    const missing = closed
      .filter(
        (n) =>
          n >= w.from_night &&
          n < until &&
          (!agreement || n >= agreement.arrival) &&
          !posted.has(n) &&
          !['skip_pending', 'posted_elsewhere'].includes(decided.get(n) ?? ''),
      )
      .sort();
    if (missing.length === 0) {
      await db(tx)
        .updateTable('day_close.watched_stays')
        .set({ resolved_at: tx.now })
        .where('stay_id', '=', w.stay_id)
        .execute();
      continue;
    }
    if (!agreement) {
      await upsertIssue(tx, {
        propertyId,
        businessDate: D,
        runId: s.run.id,
        code: 'night_not_posted_departed',
        severity: 'blocking',
        dedupeKey: `night_not_posted_departed:${w.stay_id}`,
        ref: { type: 'stay', id: w.stay_id },
        message: `This stay was in house on ${missing.join(', ')} after that night's postings and has left; ${missing.length === 1 ? 'that night has' : 'those nights have'} no room charge. Day Close cannot read the stay's agreement any more: post the night(s) in finance, then mark this handled.`,
        owner: { kind: 'department', id: 'front_office' },
        details: { nights: missing },
      });
      continue;
    }
    for (const n of missing) {
      const st = stayNightFromAgreement(agreement, n);
      if (st)
        items.push({
          key: `night:${w.stay_id}:${n}`,
          ref: { type: 'stay', id: w.stay_id },
          kind: 'night',
          stay: st,
        });
    }
  }
  return items;
}

async function workList(s: StepContext): Promise<WorkItem[]> {
  const { ports } = s.deps;
  const D = s.run.business_date;
  const propertyId = s.property.id;
  return s.inTx(async (tx) => {
    const items: WorkItem[] = [];
    const seen = new Set<string>();
    const add = (i: WorkItem) => {
      if (seen.has(i.key)) return;
      seen.add(i.key);
      items.push(i);
    };
    const night = (stay: StayNight): WorkItem => ({
      key: `night:${stay.stayId}:${stay.night}`,
      ref: { type: 'stay', id: stay.stayId },
      kind: 'night',
      stay,
    });
    // Catch-up first (DCL-R04): nights before D their own Day Close could not post (decided nights excluded).
    const missing = await catchUpNights(s.deps, tx, propertyId, D, s.policy, null);
    const byNight = new Map<string, Set<string>>();
    for (const m of missing) byNight.set(m.night, (byNight.get(m.night) ?? new Set()).add(m.stayId));
    for (const [n, stayIds] of [...byNight.entries()].sort()) {
      for (const st of await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: n }))
        if (stayIds.has(st.stayId)) add(night(st));
    }
    const tonight = await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D });
    for (const st of tonight) add(night(st));
    for (const i of await watchedDeparted(s, tx, new Set(tonight.map((t) => t.stayId)))) add(i);
    return items;
  });
}

/** A person's override of a stay-night item becomes a pending decision with a blocking follow-up (P1-1). */
async function recordNightDecisionPending(s: StepContext, tx: TxContext, step: StepKey, item: WorkItem) {
  const m = /^night:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/.exec(item.key);
  if (!m?.[1] || !m[2]) return;
  const stayId = m[1];
  const night = m[2];
  const override = await db(tx)
    .selectFrom('day_close.overrides')
    .select(['reason', 'actor'])
    .where('run_id', '=', s.run.id)
    .where('item_key', '=', itemOverrideKey(step, item.key))
    .executeTakeFirst();
  await db(tx)
    .insertInto('day_close.night_decisions')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: s.property.id,
      stay_id: stayId,
      night,
      decision: 'skip_pending',
      run_id: s.run.id,
      reason: override?.reason ?? 'overridden',
      actor: override?.actor ?? 'unknown',
      created_at: tx.now,
    })
    .execute();
  await upsertIssue(tx, {
    propertyId: s.property.id,
    businessDate: s.run.business_date,
    runId: s.run.id,
    code: 'night_decision_needed',
    severity: 'blocking',
    dedupeKey: `night_decision:${stayId}:${night}`,
    ref: { type: 'stay', id: stayId },
    message: `Night ${night} of this stay was left out of Day Close by an override. Decide: let Day Close post it (once, from the agreement), or confirm it was charged another way. Day Close never posts it on its own.`,
    owner: { kind: 'department', id: 'night_audit' },
    details: { night, step },
  });
}

/**
 * A person overrode a failed agreement-line item: the pending lines are cancelled with the override's reason, so Day
 * Close never posts them later behind the person's back (a hand posting would then be charged twice, review P1-1).
 */
async function cancelDueLinesByOverride(s: StepContext, tx: TxContext, step: StepKey, item: WorkItem) {
  if (!item.stayId) return;
  const override = await db(tx)
    .selectFrom('day_close.overrides')
    .select(['reason'])
    .where('run_id', '=', s.run.id)
    .where('item_key', '=', itemOverrideKey(step, item.key))
    .executeTakeFirst();
  const rows = await db(tx)
    .selectFrom('day_close.deferred_lines')
    .select(['id', 'version', 'line'])
    .where('stay_id', '=', item.stayId)
    .where('status', '=', 'pending')
    .forUpdate()
    .execute();
  for (const row of rows)
    await db(tx)
      .updateTable('day_close.deferred_lines')
      .set({
        status: 'cancelled',
        status_reason: `overridden: ${override?.reason ?? 'no reason recorded'}`,
        updated_run_id: s.run.id,
        updated_at: tx.now,
        version: row.version + 1,
      })
      .where('id', '=', row.id)
      .execute();
  if (rows.length)
    await upsertIssue(tx, {
      propertyId: s.property.id,
      businessDate: s.run.business_date,
      runId: s.run.id,
      code: 'agreement_lines_not_posted',
      severity: 'warning',
      dedupeKey: `agreement_lines_not_posted:${item.stayId}:${s.run.id}`,
      ref: { type: 'stay', id: item.stayId },
      message: `${rows.length} agreement line(s) of this stay (${rows.map((r) => (r.line as PostingLine).chargeCode).join(', ')}) were left out of Day Close by an override and will not be posted by it. Charge them in finance if they are owed.`,
      owner: { kind: 'department', id: 'finance' },
      details: { lines: rows.map((r) => (r.line as PostingLine).lineKey) },
    });
}

/**
 * Process items for a step: one transaction per item, progress committed with the effect, failures recorded (the
 * step continues with the other items), done items never redone, overridden failed items become decisions.
 */
export async function processItems(
  s: StepContext,
  step: StepKey,
  items: WorkItem[],
  done: (tx: TxContext, item: WorkItem) => Promise<Record<string, unknown>>,
  opts: { retriedBy?: 'resume' | 'next_close' } = {},
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
        if (item.kind === 'due') await cancelDueLinesByOverride(s, tx, step, item);
        else await recordNightDecisionPending(s, tx, step, item);
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
      const f: FailureRecord = toFailure(err);
      await s.inTx(async (tx) => {
        await recordItem(tx, {
          runId: s.run.id,
          step,
          itemKey: item.key,
          ref: item.ref,
          status: 'failed',
          error: f,
        });
        if (opts.retriedBy === 'next_close') {
          // After the advance the run cannot be resumed for this item: the next Day Close retries it (the line stays
          // pending / the night stays unposted); a warning makes the gap visible until then.
          await upsertIssue(tx, {
            propertyId: s.property.id,
            businessDate: s.run.business_date,
            runId: s.run.id,
            code: 'posting_after_close_failed',
            severity: 'warning',
            dedupeKey: `posting_after_close_failed:${step}:${item.key}`,
            ref: item.ref,
            message: `Day Close could not post "${item.key}" after the date advanced (${f.code}). The next Day Close retries it; fix the cause before then.`,
            owner: { kind: 'department', id: 'night_audit' },
            details: { step, itemKey: item.key, code: f.code },
          });
        } else if (!f.retryable) {
          await upsertIssue(tx, {
            propertyId: s.property.id,
            businessDate: s.run.business_date,
            runId: s.run.id,
            code: 'step_item_failed',
            severity: 'blocking',
            dedupeKey: `step_item_failed:${s.run.id}:${step}:${item.key}`,
            ref: item.ref,
            message: `Day Close could not finish "${item.key}" (${f.code}). Fix the cause and resume, or override the item to decide later.`,
            owner: { kind: 'department', id: 'night_audit' },
            details: { step, itemKey: item.key, code: f.code },
          });
        }
      });
    }
  }
  return { failed };
}

function failedOutcome(
  recorded: Map<string, { status: string; error: unknown }>,
  what: string,
): StepOutcome | null {
  const failed = [...recorded.values()].filter((i) => i.status === 'failed');
  if (!failed.length) return null;
  return {
    status: 'failed',
    total: recorded.size,
    error: {
      code: 'items_failed',
      message: `${failed.length} ${what} could not be posted. Everything else is posted and kept. Fix the listed items, then resume (only they are retried), or override an item to decide later.`,
      retryable: failed.every((i) => (i.error as { retryable?: boolean } | null)?.retryable !== false),
    },
  };
}

export async function roomAndPackagePostings(s: StepContext): Promise<StepOutcome> {
  const D = s.run.business_date;
  const step: StepKey = 'room_and_package_postings';
  const all = new Map<string, WorkItem>();
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
    await processItems(s, step, list, async (tx, item) => ({
      ...(await postStayNight(s, tx, item.stay as StayNight, D)),
    }));
  }
  // Agreement lines served by D still pending (normally posted right after the previous advance; retried here).
  await postDueLines(s, step, D);
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  return (
    failedOutcome(recorded, 'stay-night(s) or agreement line(s)') ?? {
      status: 'completed',
      total: recorded.size,
    }
  );
}

/** In-house stays of `night` with no posting, no person's decision and not already handled by `handledSteps`. */
export async function unpostedInHouse(
  s: StepContext,
  tx: TxContext,
  night: LocalDate,
  handledSteps: StepKey[],
): Promise<StayNight[]> {
  const stays = await s.deps.ports.reservations.listInHouseStaysForNight(tx, {
    propertyId: s.property.id,
    date: night,
  });
  if (!stays.length) return [];
  const posted = await db(tx)
    .selectFrom('day_close.night_postings')
    .select('stay_id')
    .where('property_id', '=', s.property.id)
    .where('night', '=', night)
    .execute();
  const done = new Set(posted.map((p) => p.stay_id));
  const handled = new Set<string>();
  for (const step of handledSteps)
    for (const k of (await loadItems(tx, s.run.id, step)).keys()) handled.add(k);
  const out: StayNight[] = [];
  for (const st of stays) {
    if (done.has(st.stayId) || handled.has(`night:${st.stayId}:${night}`)) continue;
    const decision = await decisionFor(tx, st.stayId, night);
    if (decision === 'skip_pending' || decision === 'posted_elsewhere') continue;
    out.push(st);
  }
  return out;
}

export const SWEEP_HANDLED: StepKey[] = [
  'room_and_package_postings',
  'final_sweep',
  'advance',
  'post_advance',
];

/**
 * Sweep: in-house stays of D without a posting (checked in after the posting step, or during the advance). Items are
 * recorded under `step`; `businessDate` is the date they land on (D before the advance, D+1 after it).
 */
export async function sweepNight(
  s: StepContext,
  step: StepKey,
  businessDate: LocalDate,
  opts: { retriedBy?: 'resume' | 'next_close' } = {},
): Promise<{ failed: StepOutcome | null; swept: number }> {
  const D = s.run.business_date;
  const missing = await s.inTx((tx) => unpostedInHouse(s, tx, D, SWEEP_HANDLED));
  if (!missing.length) return { failed: null, swept: 0 };
  const items: WorkItem[] = missing.map((st) => ({
    key: `night:${st.stayId}:${st.night}`,
    ref: { type: 'stay', id: st.stayId },
    kind: 'night',
    stay: st,
  }));
  const r = await processItems(
    s,
    step,
    items,
    async (tx, item) => ({
      ...(await postStayNight(s, tx, item.stay as StayNight, businessDate)),
      sweep: true,
    }),
    opts,
  );
  if (r.failed > 0 && opts.retriedBy !== 'next_close')
    return {
      failed: failedOutcome(
        await s.inTx((tx) => loadItems(tx, s.run.id, step)),
        'stay-night(s) checked in during Day Close',
      ),
      swept: items.length,
    };
  return { failed: null, swept: items.length };
}

/**
 * Agreement lines served after their night (e.g. the departure transfer). After the advance to D+1 every pending
 * expectation served by D+1 is reconciled against the agreement in force and posted under its line identity, so the
 * departure transfer is on the folio before the guest checks out (review P2-10). Stays no longer in house with
 * pending lines are reconciled at once (a shortened stay's departure transfer, review P0-1). Departed stays use
 * reservations' agreement lookup (CR-18); while it is not connected the last known line is posted on its service
 * date and a follow-up says so. Terms failing their seal never post (the item fails).
 */
export async function postDueLines(
  s: StepContext,
  step: StepKey,
  businessDate: LocalDate,
  opts: { retriedBy?: 'resume' | 'next_close' } = {},
): Promise<StepOutcome | null> {
  const propertyId = s.property.id;
  const D = s.run.business_date;
  // The stay's agreement as reservations serves it for the latest night it is in house (D, or D+1 after the advance:
  // a guest leaving on D+1 is in house for D only).
  const inHouse = new Map<string, StayNight>();
  for (const night of businessDate > D ? [D, businessDate] : [businessDate])
    for (const x of await s.inTx((tx) =>
      s.deps.ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: night }),
    ))
      inHouse.set(x.stayId, x);
  const pendingRows = await s.inTx((tx) =>
    db(tx)
      .selectFrom('day_close.deferred_lines')
      .select(['stay_id', 'service_date'])
      .where('property_id', '=', propertyId)
      .where('status', '=', 'pending')
      .execute(),
  );
  const stayIds = [
    ...new Set(
      pendingRows
        .filter((r) => r.service_date <= businessDate || !inHouse.has(r.stay_id))
        .map((r) => r.stay_id),
    ),
  ];
  if (!stayIds.length) return null;
  const items: WorkItem[] = stayIds.sort().map((id) => ({
    key: `due:${id}:${businessDate}`,
    ref: { type: 'stay', id },
    kind: 'due',
    stayId: id,
  }));
  const sealRefused = (stayId: string) =>
    new BusinessRuleError(
      'terms_seal_invalid',
      `The agreed terms of this stay fail their seal check, so Day Close will not post its remaining agreement lines (e.g. the departure transfer) from them. Re-confirm the stay's price; the next Day Close posts them.`,
      { stayId },
    );
  const r = await processItems(
    s,
    step,
    items,
    async (tx, item) => {
      const stayId = item.stayId as string;
      let plan: PostingLine[] | null = null;
      let stay: LineStay | null = null;
      const here = inHouse.get(stayId);
      if (here) {
        if (!s.deps.ports.rates.verifyTerms(here.terms)) throw sealRefused(stayId);
        plan = s.deps.ports.rates.postingPlan(here.terms, stayId);
        stay = here;
      } else {
        const a = await readAgreement(s, tx, stayId);
        if (a && a.status !== 'cancelled' && a.status !== 'no_show') {
          plan = [];
          for (const seg of a.segments) {
            if (!s.deps.ports.rates.verifyTerms(seg.terms)) throw sealRefused(stayId);
            plan.push(...s.deps.ports.rates.postingPlan(seg.terms, stayId));
            stay = { stayId, occupancy: a.occupancy, terms: seg.terms };
          }
        } else if (a) {
          plan = [];
          stay = { stayId, occupancy: a.occupancy, terms: null };
        }
      }
      const rows = await db(tx)
        .selectFrom('day_close.deferred_lines')
        .selectAll()
        .where('stay_id', '=', stayId)
        .where('status', '=', 'pending')
        .forUpdate()
        .execute();
      const posted: string[] = [];
      const cancelled: string[] = [];
      let lastKnown = false;
      for (const row of rows) {
        const setStatus = (status: 'posted' | 'cancelled', why: string | null) =>
          db(tx)
            .updateTable('day_close.deferred_lines')
            .set({
              status,
              status_reason: why,
              updated_run_id: s.run.id,
              updated_at: tx.now,
              version: row.version + 1,
            })
            .where('id', '=', row.id)
            .execute();
        let line: PostingLine | undefined;
        let lineStay: LineStay | null = stay;
        if (plan && stay) {
          line = plan.find((l) => l.lineKey === row.line_key);
          if (!line) {
            await setStatus('cancelled', 'no longer in the agreement in force');
            cancelled.push(row.line_key);
            continue;
          }
          if (line.serviceDate > businessDate) {
            if (line.serviceDate !== row.service_date)
              await db(tx)
                .updateTable('day_close.deferred_lines')
                .set({
                  night: line.nightDate,
                  service_date: line.serviceDate,
                  line: json(line),
                  updated_run_id: s.run.id,
                  updated_at: tx.now,
                  version: row.version + 1,
                })
                .where('id', '=', row.id)
                .execute();
            continue;
          }
        } else {
          // The agreement cannot be read (lookup not connected): the last known line, on its own service date, flagged.
          line = row.line as PostingLine;
          if (line.serviceDate > businessDate) continue;
          lineStay = { stayId, occupancy: line.occupancy, terms: null };
          lastKnown = true;
          await upsertIssue(tx, {
            propertyId,
            businessDate,
            runId: s.run.id,
            code: 'posted_from_last_known_agreement',
            severity: 'warning',
            dedupeKey: `posted_from_last_known_agreement:${stayId}:${row.line_key}`,
            ref: { type: 'stay', id: stayId },
            message: `${line.chargeCode} (served ${line.serviceDate}) was posted from the agreement Day Close last saw, because the stay's current agreement cannot be read. Check that it still applies; correct it in finance if not.`,
            owner: { kind: 'department', id: 'finance' },
            details: { lineKey: row.line_key },
          });
        }
        if (line.amount.amountMinor === 0) {
          await setStatus('posted', 'zero amount: nothing to post');
          continue;
        }
        const why =
          line.serviceDate < businessDate
            ? `Agreement line served on ${line.serviceDate}, posted by Day Close of ${D}.`
            : null;
        await postLine(s, tx, lineStay as LineStay, line, businessDate, why);
        await setStatus('posted', null);
        posted.push(row.line_key);
      }
      return { posted, cancelled, lastKnown };
    },
    opts,
  );
  if (r.failed > 0 && opts.retriedBy !== 'next_close')
    return failedOutcome(await s.inTx((tx) => loadItems(tx, s.run.id, step)), 'agreement line(s)');
  return null;
}
