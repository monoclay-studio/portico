/**
 * The ordered Day Close steps (DCL-R02). Each is idempotent: completed steps are never re-run, partially done steps
 * re-run safely because every effect is keyed and every item's progress commits with its effect.
 *
 * Cut-over (DCL-R04, DCL-I03/I04, review P2-2/P2-3): the final sweep posts stays checked in during the close; the
 * advance transaction re-checks under the advance lock that no in-house stay of D is unposted (looping back to the
 * sweep when one appeared), freezes the day facts from that same state and moves the date. Stays checked in after
 * that are posted by the post-advance sweep or, if they leave first, found again through Day Close's own record of
 * late check-ins (`watched_stays`).
 */
import { sql, type TxContext, withSavepoint } from '@portico/db';
import { addDays, DomainError, type LocalDate, ModuleUnavailableError, money } from '@portico/kernel';
import type { DayFacts, ReadinessItem, StepKey } from '../../contracts';
import { toFailure } from '../../domain/errors';
import { isIntegrityCode } from '../../domain/policy';
import { transferDelayed } from '../../domain/readiness';
import { earliestStart } from '../../domain/schedule';
import { computeKpis } from '../../domain/statistics';
import { DAY_CLOSE_EVENTS } from '../../events';
import type { DueStay } from '../../ports';
import { db, json } from '../context';
import { collectReadiness } from '../readiness';
import { closeIssue, emitRunEvent, loadItems, setStep, upsertIssue } from '../repo';
import {
  postDueLines,
  processItems,
  roomAndPackagePostings,
  SWEEP_HANDLED,
  sweepNight,
  unpostedInHouse,
} from './postings';
import type { StepContext, StepFn, StepOutcome } from './shared';

/** The kernel's code for "collaborating module not connected" (taken from the kernel, never copied). */
const MODULE_NOT_AVAILABLE = new ModuleUnavailableError('kernel').code;
const notConnected = (err: unknown): boolean =>
  err instanceof ModuleUnavailableError || (err instanceof DomainError && err.code === MODULE_NOT_AVAILABLE);

// ───────────────────────────── posted after close (review P2-4) ─────────────────────────────

/**
 * Revenue stamped with a closed date that committed after its Day Close froze the day: a posting that read the
 * business date before the advance and committed after it (FR-1 `lockBusinessDate` is still the real fix). Raised as
 * a named follow-up for that date, owned by finance; checked right after the advance and again at the next close.
 */
async function checkPostedAfterClose(s: StepContext, tx: TxContext, date: LocalDate): Promise<number> {
  const propertyId = s.property.id;
  const frozen = await db(tx)
    .selectFrom('day_close.day_facts')
    .select('facts')
    .where('property_id', '=', propertyId)
    .where('business_date', '=', date)
    .executeTakeFirst();
  if (!frozen) return 0;
  const closed = (frozen.facts as DayFacts).revenueByChargeCode ?? [];
  const now = await s.deps.ports.finance.dailyRevenue(tx, { propertyId }, { businessDate: date });
  const codes = new Set([...closed.map((c) => c.chargeCode), ...now.byChargeCode.map((c) => c.chargeCode)]);
  const delta = [...codes]
    .sort()
    .map((chargeCode) => ({
      chargeCode,
      closedMinor: closed.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
      nowMinor: now.byChargeCode.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
    }))
    .filter((d) => d.closedMinor !== d.nowMinor);
  if (!delta.length) return 0;
  const accounting = await s.deps.ports.platform.getDataAuthority(tx, propertyId, 'accounting');
  await upsertIssue(tx, {
    propertyId,
    businessDate: date,
    runId: s.run.id,
    code: 'posted_after_close',
    severity: 'warning',
    dedupeKey: `posted_after_close:${propertyId}:${date}:${delta.map((d) => `${d.chargeCode}=${d.nowMinor}`).join(',')}`,
    ref: { type: 'day_report', id: `${propertyId}:${date}` },
    message: `Charges stamped ${date} were committed after Day Close froze that day (a posting in flight while the date advanced). The day report lists them as "posted after close"${accounting.authority === 'external' ? ', and the journal for the date must be sent again to the accounting system' : ''}.`,
    owner: { kind: 'department', id: 'finance' },
    details: { delta, reexportJournal: accounting.authority === 'external' },
  });
  return delta.length;
}

// ───────────────────────────── 1. preflight ─────────────────────────────

async function preflight(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  return s.inTx(async (tx) => {
    for (const domain of ['reservations', 'charges'] as const) {
      const a = await ports.platform.getDataAuthority(tx, propertyId, domain);
      if (a.authority === 'external') {
        return {
          status: 'failed',
          error: {
            code: 'external_system_of_record',
            message: `${a.systemName ?? 'Another system'} is the system of record for ${domain} at this property, so its own night audit closes the day and Portico's business date mirrors it. Day Close does not run here.`,
            retryable: false,
          },
        };
      }
    }
    const current = await ports.platform.getBusinessDate(tx, propertyId);
    if (current !== s.run.business_date) {
      return {
        status: 'failed',
        error: {
          code: 'business_date_moved',
          message: `The business date is now ${current}, not ${s.run.business_date}. This run cannot continue; refresh and start Day Close for ${current} if needed.`,
          retryable: false,
        },
      };
    }
    // The previous closed date: anything that committed for it after its close (second look, review P2-4).
    const previous = await db(tx)
      .selectFrom('day_close.runs')
      .select('business_date')
      .where('property_id', '=', propertyId)
      .where('status', '=', 'completed')
      .where('business_date', '<', s.run.business_date)
      .orderBy('business_date', 'desc')
      .executeTakeFirst();
    if (previous) await checkPostedAfterClose(s, tx, previous.business_date);
    const r = await collectReadiness(s.deps, tx, propertyId, {
      runId: s.run.id,
      businessDate: s.run.business_date,
    });
    // Stored detail holds codes and references only, never another module's prose about a person (review P2-6):
    // messages are rendered on read from the owning module.
    const detail = {
      evaluatedAt: r.evaluatedAt,
      counts: r.counts,
      unavailableSources: r.unavailableSources.map((u) => u.source),
      warnings: r.warnings.map((w) => ({ key: w.key, code: w.code, ref: w.ref, owner: w.owner.id })),
      overridden: [...r.warnings, ...r.info]
        .filter((w) => w.override)
        .map((w) => ({ key: w.key, code: w.code })),
    };
    if (r.blocking.length) return { status: 'blocked', blockers: r.blocking, detail };
    return { status: 'completed', detail };
  });
}

// ───────────────────────────── 2. no-shows ─────────────────────────────

function cutOffBlocker(propertyId: string, D: LocalDate, localTime: string, notBefore: Date): ReadinessItem {
  return {
    key: `dayClose:no_shows_before_cutoff:property:${propertyId}`,
    source: 'dayClose',
    code: 'no_shows_before_cutoff',
    severity: 'blocking',
    blocking: true,
    overridable: false,
    override: null,
    ref: { type: 'property', id: propertyId },
    owner: { kind: 'department', id: 'night_audit' },
    message: `Arrivals of ${D} are not marked no-show before ${localTime} property time (${notBefore.toISOString()}): guests can still arrive. Resume from then (an automatic close continues by itself).`,
    actions: [],
    since: null,
    details: { notBefore: notBefore.toISOString() },
  };
}

async function noShows(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const mode = s.policy.noShow.mode;
  if (mode === 'off')
    return { status: 'skipped', detail: { reason: 'Policy: no-shows are handled by hand.' } };
  const propertyId = s.property.id;
  const D = s.run.business_date;
  // The step's own floor (review P2-5): irreversible guest-facing effects never happen before the cut-off, whoever
  // started the run and whenever it is resumed.
  const floor = earliestStart(D, s.policy.earliestStartLocalTime, s.property.timezone);
  const now = await s.inTx(async (tx) => tx.now);
  if (floor && now.getTime() < floor.getTime())
    return {
      status: 'blocked',
      blockers: [cutOffBlocker(propertyId, D, s.policy.earliestStartLocalTime, floor)],
    };
  const arrivals: DueStay[] = await s.inTx((tx) =>
    ports.reservations.listDueArrivals(tx, { propertyId, date: D }),
  );
  const overrides = await s.inTx((tx) =>
    db(tx).selectFrom('day_close.overrides').select(['item_key']).where('run_id', '=', s.run.id).execute(),
  );
  const overridden = new Set(overrides.map((o) => o.item_key));
  const step: StepKey = 'no_shows';
  const items = arrivals.map((a) => ({
    key: `noshow:${a.stayId}`,
    ref: { type: 'stay', id: a.stayId },
    kind: 'night' as const,
    arrival: a,
  }));
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  const total = new Set([...recorded.keys(), ...items.map((i) => i.key)]).size;
  await s.inTx((tx) => setStep(tx, s.run.id, step, { total }));
  const byKey = new Map(items.map((i) => [i.key, i.arrival]));
  await processItems(s, step, items, async (tx, item) => {
    const a = byKey.get(item.key) as DueStay;
    const protectedArrival =
      s.policy.noShow.protectDelayedTransfers && transferDelayed(a.transfer, a.eta, tx.now);
    const decidedToKeep = overridden.has(`reservations:arrival_not_checked_in:stay:${a.stayId}`);
    if (protectedArrival || decidedToKeep) {
      // Not a no-show: the arrival stays expected for the next day; recorded so the report explains it.
      return { outcome: 'kept_expected', reason: protectedArrival ? 'transfer_delayed' : 'override' };
    }
    const r = await ports.reservations.markNoShow(tx, {
      propertyId,
      stayId: a.stayId,
      idempotencyKey: `noshow:${a.stayId}`,
    });
    let collection: Record<string, unknown> = { status: 'not_needed' };
    if (r.penalty.amountMinor > 0 && s.policy.noShow.collectFee === 'agreed_guarantee') {
      // Follow-up text is Day Close's own (no provider prose about the guest is stored, review P2-6).
      const followUp = async (reasonCode: string, why: string) => {
        await upsertIssue(tx, {
          propertyId,
          businessDate: D,
          runId: s.run.id,
          code: 'no_show_fee_to_collect',
          severity: 'warning',
          dedupeKey: `no_show_fee_to_collect:${a.stayId}`,
          ref: { type: 'stay', id: a.stayId },
          message: `No-show charge of ${(r.penalty.amountMinor / 100).toFixed(2)} ${r.penalty.currency} is on the guest's folio but was not collected: ${why}`,
          owner: { kind: 'department', id: 'finance' },
          details: { amount: r.penalty, bookingId: a.bookingId, reasonCode },
        });
      };
      try {
        const c = await withSavepoint(tx, 'dcl_noshow_fee', () =>
          ports.payments.collectAgreedNoShowFee(tx, {
            propertyId,
            bookingId: a.bookingId,
            stayId: a.stayId,
            amount: r.penalty,
            idempotencyKey: `noshow-fee:${a.stayId}`,
          }),
        );
        collection = { status: c.outcome, paymentId: c.paymentId, mode: c.mode };
        if (c.outcome === 'not_agreed')
          await followUp(
            'not_agreed',
            'the booking has no agreed guarantee covering a no-show charge. Send the guest a payment link or collect it another way.',
          );
      } catch (err) {
        if (err instanceof DomainError) {
          collection = { status: 'not_requested', code: err.code };
          await followUp(
            err.code,
            notConnected(err)
              ? 'automatic collection is not connected yet. Send the guest a payment link or collect it another way.'
              : `payments refused the collection (${err.code}). Open the booking's payments to see why, then collect it another way.`,
          );
        } else throw err;
      }
    }
    await tx.audit({
      action: 'dayClose.noShow.recorded',
      target: { type: 'day_close_run', id: s.run.id },
      propertyId,
      after: { stayId: a.stayId, penalty: r.penalty, replayed: r.replayed, collection },
    });
    return {
      outcome: 'no_show',
      penalty: r.penalty,
      penaltyPostingIds: r.penaltyPostingIds,
      replayed: r.replayed,
      collection,
    };
  });
  return finishItems(s, step);
}

/** Step result from its recorded items: failed items (not overridden) fail the step. */
async function finishItems(s: StepContext, step: StepKey): Promise<StepOutcome> {
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  const failed = [...recorded.values()].filter((i) => i.status === 'failed');
  if (failed.length) {
    return {
      status: 'failed',
      total: recorded.size,
      error: {
        code: 'items_failed',
        message: `${failed.length} item(s) of this step failed; everything else is done and kept. Fix them and resume (only they are retried), or override an item with a reason.`,
        retryable: failed.every((i) => (i.error as { retryable?: boolean } | null)?.retryable !== false),
      },
    };
  }
  return { status: 'completed', total: recorded.size };
}

// ───────────────────────────── 4. allowance close ─────────────────────────────

/**
 * Night N's allowance is granted at N's own close (never before the night exists, review P0-2), valid the day after,
 * and closes here at N+1's close (`upTo` D+1 closes credits valid until D+1, i.e. last night's). Stays that left
 * today (their last night was D−1) or whose earlier nights this run posted after they left close theirs too, if
 * finance's check-out consumer has not already.
 */
async function allowanceClose(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  const { stays, departed } = await s.inTx(async (tx) => {
    const tonight = await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D });
    const here = new Set(tonight.map((t) => t.stayId));
    const lastNight = await db(tx)
      .selectFrom('day_close.night_postings')
      .select('stay_id')
      .where('property_id', '=', propertyId)
      .where((eb) => eb.or([eb('night', '=', addDays(D, -1)), eb('run_id', '=', s.run.id)]))
      .execute();
    const gone = [...new Set(lastNight.map((r) => r.stay_id))].filter((id) => !here.has(id));
    return { stays: tonight, departed: gone };
  });
  const step: StepKey = 'allowance_close';
  const items = [
    ...stays.map((st) => ({
      key: `allowance:${st.stayId}:${D}`,
      ref: { type: 'stay', id: st.stayId },
      kind: 'night' as const,
      stayId: st.stayId,
      departure: st.departure,
    })),
    ...departed.sort().map((id) => ({
      key: `allowance:${id}:${D}`,
      ref: { type: 'stay', id },
      kind: 'night' as const,
      stayId: id,
      departure: D,
    })),
  ];
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  await s.inTx((tx) =>
    setStep(tx, s.run.id, step, { total: new Set([...recorded.keys(), ...items.map((i) => i.key)]).size }),
  );
  const byKey = new Map(items.map((i) => [i.key, i]));
  await processItems(s, step, items, async (tx, item) => {
    const it = byKey.get(item.key);
    if (!it) return {};
    const r = await ports.finance.closeAllowances(
      tx,
      { propertyId },
      { stayId: it.stayId, upTo: addDays(D, 1), departureDate: it.departure },
    );
    return { closed: r.closed };
  });
  return finishItems(s, step);
}

// ───────────────────────────── 5. payments housekeeping ─────────────────────────────

async function paymentsHousekeeping(s: StepContext): Promise<StepOutcome> {
  if (s.policy.steps.paymentsHousekeeping === 'skip')
    return {
      status: 'skipped',
      detail: { reason: 'Policy: payments housekeeping is not part of this Day Close.' },
    };
  try {
    const r = await s.inTx((tx) =>
      withSavepoint(tx, 'dcl_payments_hk', () =>
        s.deps.ports.payments.scheduleDueCollections(tx, {
          propertyId: s.property.id,
          businessDate: s.run.business_date,
        }),
      ),
    );
    return { status: 'completed', detail: r };
  } catch (err) {
    if (notConnected(err)) {
      return {
        status: 'skipped',
        detail: {
          reason:
            "Payments housekeeping is not connected yet; payments' own jobs renew authorizations and run due virtual-card charges.",
        },
      };
    }
    throw err;
  }
}

// ───────────────────────────── 6. integrity ─────────────────────────────

async function integrity(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  return s.inTx(async (tx) => {
    const report = await ports.finance.integrityReport(tx, { propertyId });
    const alarms = (await ports.finance.getUnbalancedItems(tx, { propertyId }, D))
      .filter((i) => isIntegrityCode(i.code))
      .map((i) => ({ code: i.code, ref: i.ref }));
    let inventory: Record<string, unknown>;
    let inventoryOk = true;
    const warnings: string[] = [];
    try {
      const d = await withSavepoint(tx, 'dcl_inv_check', () =>
        ports.inventory.checkLedgerConsistency(tx, { propertyId, fromNight: D }),
      );
      inventoryOk = d.length === 0;
      inventory = { checked: true, discrepancies: d.slice(0, 50) };
    } catch (err) {
      if (!notConnected(err)) throw err;
      // Never a silent pass (review P3-5): the report and the run say the inventory ledger was not checked.
      inventory = { checked: false, reason: 'Inventory consistency check is not connected.' };
      warnings.push('inventory_not_checked');
    }
    const detail = { checks: report.checks, alarms, inventory, warnings };
    if (!report.ok || alarms.length > 0 || !inventoryOk) {
      const failedChecks = report.checks.filter((c) => !c.ok).map((c) => c.check);
      return {
        status: 'failed',
        detail,
        error: {
          code: 'integrity_failed',
          message: `The books do not prove balanced (${[...failedChecks, ...alarms.map((a) => a.code), ...(inventoryOk ? [] : ['inventory_ledger'])].join(', ')}). The business date was NOT advanced. Finance must investigate; this is never retried automatically.`,
          retryable: false,
          integrity: true,
          details: detail,
        },
      };
    }
    await closeIssue(tx, `integrity_failed:${propertyId}:${D}`, 'Integrity checks passed');
    return { status: 'completed', detail };
  });
}

// ───────────────────────────── 7. final sweep and re-check ─────────────────────────────

async function finalSweep(s: StepContext): Promise<StepOutcome> {
  const D = s.run.business_date;
  let swept = 0;
  for (let round = 0; round < s.deps.config.sweepRounds; round++) {
    const r = await sweepNight(s, 'final_sweep', D);
    if (r.failed) return r.failed;
    swept += r.swept;
    if (r.swept === 0) break;
  }
  // Re-evaluate what blocks right before the date moves (EC-DCL-019): something may have appeared since preflight.
  // Overrides of this run still apply.
  const recheck = await s.inTx((tx) =>
    collectReadiness(s.deps, tx, s.property.id, { runId: s.run.id, businessDate: D }),
  );
  if (recheck.blocking.length) {
    return {
      status: 'blocked',
      blockers: recheck.blocking,
      detail: { swept, recheckedAt: recheck.evaluatedAt, blocking: recheck.blocking.map((b) => b.key) },
    };
  }
  return { status: 'completed', detail: { swept, recheckedAt: recheck.evaluatedAt } };
}

// ───────────────────────────── 8. freeze facts and advance ─────────────────────────────

/** The day facts of D from the state the advance closes (called inside the advance transaction, DCL-I03). */
async function freezeFacts(s: StepContext, tx: TxContext): Promise<DayFacts> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  const cells = (await ports.inventory.getAvailability(tx, { propertyId, date: D })).filter(
    (c) => !c.composite,
  );
  const stays = await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D });
  const revenue = await ports.finance.dailyRevenue(tx, { propertyId }, { businessDate: D });
  const noShowItems = await loadItems(tx, s.run.id, 'no_shows');
  const noShowCount = [...noShowItems.values()].filter(
    (i) => i.status === 'done' && (i.result as { outcome?: string }).outcome === 'no_show',
  ).length;
  const rooms = {
    capacity: cells.reduce((a, c) => a + c.capacity, 0),
    outOfOrder: cells.reduce((a, c) => a + c.outOfOrder, 0),
    sold: stays.filter((x) => x.commercialType === 'standard').length,
    complimentary: stays.filter((x) => x.commercialType === 'complimentary').length,
    houseUse: stays.filter((x) => x.commercialType === 'house_use').length,
  };
  const currency = revenue.currency || s.property.baseCurrency;
  const roomCodes = new Set(s.policy.roomChargeCodes);
  const roomRevenueMinor = revenue.byChargeCode
    .filter((r) => roomCodes.has(r.chargeCode))
    .reduce((a, r) => a + r.netMinor, 0);
  const k = computeKpis(rooms, roomRevenueMinor);
  const facts: DayFacts = {
    propertyId,
    businessDate: D,
    currency,
    rooms: { ...rooms, available: k.available },
    occupancyPercent: k.occupancyPercent,
    adr: money(k.adrMinor, currency),
    revpar: money(k.revparMinor, currency),
    roomRevenue: money(roomRevenueMinor, currency),
    revenueByChargeCode: revenue.byChargeCode.map((r) => ({
      chargeCode: r.chargeCode,
      netMinor: r.netMinor,
    })),
    totalRevenue: money(revenue.totalRevenueMinor, currency),
    movements: {
      arrivals: stays.filter((x) => x.arrival === D).length,
      departures: null,
      noShows: noShowCount,
      inHouse: stays.length,
    },
    guests: {
      adults: stays.reduce((a, x) => a + x.occupancy.adults, 0),
      children: stays.reduce((a, x) => a + x.occupancy.childrenAges.length, 0),
      guestNights: stays.reduce((a, x) => a + x.occupancy.adults + x.occupancy.childrenAges.length, 0),
    },
    nationality: {
      status: 'incomplete',
      reason:
        'Guest nationality comes from the guests module, which Day Close is not connected to yet (Q43).',
    },
    generatedAt: tx.now.toISOString(),
    runId: s.run.id,
  };
  await db(tx)
    .insertInto('day_close.day_facts')
    .values({
      tenant_id: tx.tenantId,
      property_id: propertyId,
      business_date: D,
      run_id: s.run.id,
      facts: json(facts),
      generated_at: tx.now,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'property_id', 'business_date']).doNothing())
    .execute();
  return facts;
}

async function advance(s: StepContext): Promise<StepOutcome> {
  const propertyId = s.property.id;
  const D = s.run.business_date;
  for (let attempt = 0; attempt <= s.deps.config.sweepRounds; attempt++) {
    const outcome = await s.inTx(async (tx): Promise<StepOutcome | { lateCheckIns: number }> => {
      // One advance per property at a time, whoever runs it (serializes with any other Day Close executor).
      await sql`select pg_advisory_xact_lock(hashtextextended(${`day_close:advance:${tx.tenantId}:${propertyId}`}, 0))`.execute(
        tx.db,
      );
      const integrityStep = await db(tx)
        .selectFrom('day_close.steps')
        .select('status')
        .where('run_id', '=', s.run.id)
        .where('key', '=', 'integrity')
        .executeTakeFirstOrThrow();
      if (integrityStep.status !== 'completed') {
        return {
          status: 'failed',
          error: {
            code: 'integrity_not_passed',
            message: 'The business date advances only after the books proved balanced in this run (DCL-I02).',
            retryable: false,
            integrity: true,
          },
        };
      }
      // DCL-I04 in the advance transaction itself (review P2-2): a stay checked in since the final sweep sends the
      // advance back to the sweep instead of leaving its night behind.
      const late = await unpostedInHouse(s, tx, D, SWEEP_HANDLED);
      if (late.length) return { lateCheckIns: late.length };
      // DCL-I03 (review P2-3): facts frozen from the same state the advance closes.
      const facts = await freezeFacts(s, tx);
      const next = await s.deps.ports.platform.advanceBusinessDate(tx, {
        propertyId,
        expected: D,
        dayCloseRunId: s.run.id,
      });
      await s.hooks.insideItem?.('advance', 0);
      // Completion commits in the SAME transaction as the advance: a crash cannot leave the date advanced while the
      // step looks unfinished (resume never advances twice).
      const detail = {
        from: D,
        to: next,
        facts: { occupancyPercent: facts.occupancyPercent, adr: facts.adr, revpar: facts.revpar },
      };
      await setStep(tx, s.run.id, 'advance', { status: 'completed', finished: true, detail });
      await tx.audit({
        action: 'dayClose.businessDate.advanced',
        target: { type: 'day_close_run', id: s.run.id },
        propertyId,
        before: { businessDate: D },
        after: { businessDate: next },
      });
      return { status: 'completed', detail, persisted: true };
    });
    if ('lateCheckIns' in outcome) {
      const r = await sweepNight(s, 'advance', D);
      if (r.failed) return r.failed;
      continue;
    }
    if (outcome.status === 'completed') await s.hooks.afterItem?.('advance', 0);
    return outcome;
  }
  return {
    status: 'failed',
    error: {
      code: 'check_ins_still_arriving',
      message: `Guests kept being checked in for ${D} while Day Close tried to advance the date; every one of them was posted. Resume in a moment to advance.`,
      retryable: true,
    },
  };
}

// ───────────────────────────── 9. post-advance ─────────────────────────────

async function postAdvance(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  const next = addDays(D, 1);
  const result = await s.inTx(async (tx) => {
    const exists = await db(tx)
      .selectFrom('day_close.day_reports')
      .select('generated_at')
      .where('property_id', '=', propertyId)
      .where('business_date', '=', D)
      .executeTakeFirst();
    if (!exists) {
      const facts = await db(tx)
        .selectFrom('day_close.day_facts')
        .select('facts')
        .where('property_id', '=', propertyId)
        .where('business_date', '=', D)
        .executeTakeFirst();
      const tb = await ports.finance.trialBalance(tx, { propertyId }, { asOf: D });
      const steps = await db(tx)
        .selectFrom('day_close.steps')
        .selectAll()
        .where('run_id', '=', s.run.id)
        .orderBy('ordinal')
        .execute();
      const overrides = await db(tx)
        .selectFrom('day_close.overrides')
        .selectAll()
        .where('run_id', '=', s.run.id)
        .execute();
      const issues = await db(tx)
        .selectFrom('day_close.issues')
        .select(['id', 'code', 'severity', 'ref_type', 'ref_id', 'status'])
        .where('property_id', '=', propertyId)
        .where('business_date', '=', D)
        .execute();
      const detailOf = (key: StepKey) =>
        (steps.find((x) => x.key === key)?.detail ?? {}) as Record<string, unknown>;
      // The pack is append-only: references and codes only, never names or another module's prose (review P2-6).
      // Messages and names are rendered when the report is read.
      const pack = {
        managerFlash: (facts?.facts as Record<string, unknown>) ?? {},
        trialBalance: {
          asOf: D,
          functionalCurrency: tb.functionalCurrency,
          balanced: tb.balanced,
          totalDebitMinor: tb.totalDebitMinor,
          totalCreditMinor: tb.totalCreditMinor,
          accounts: tb.accounts.filter((a) => a.debitMinor !== 0 || a.creditMinor !== 0),
        },
        exceptions: [
          ...((detailOf('preflight').warnings as Array<Record<string, unknown>> | undefined) ?? []).map(
            (w) => ({
              key: w.key,
              code: w.code,
              ref: w.ref ?? null,
              owner: w.owner ?? null,
              severity: 'warning',
              stage: 'preflight',
            }),
          ),
          ...((detailOf('integrity').warnings as string[] | undefined) ?? []).map((code) => ({
            key: `dayClose:${code}:property:${propertyId}`,
            code,
            ref: { type: 'property', id: propertyId },
            severity: 'warning',
            stage: 'integrity',
          })),
          ...issues.map((i) => ({
            issueId: i.id,
            code: i.code,
            severity: i.severity,
            ref: i.ref_type && i.ref_id ? { type: i.ref_type, id: i.ref_id } : null,
            status: i.status,
            stage: 'follow_up',
          })),
        ],
        overrides: overrides.map((o) => ({
          overrideId: o.id,
          itemKey: o.item_key,
          code: o.code,
          reason: o.reason,
          by: o.actor,
          at: (o.created_at as Date).toISOString(),
        })),
        steps: steps.map((x) => ({
          key: x.key,
          status: x.status,
          total: x.total,
          done: x.done,
          failed: x.failed,
          skipped: x.skipped,
          attempts: x.attempts,
          startedAt: x.started_at,
          finishedAt: x.finished_at,
        })),
      };
      await db(tx)
        .insertInto('day_close.day_reports')
        .values({
          tenant_id: tx.tenantId,
          property_id: propertyId,
          business_date: D,
          run_id: s.run.id,
          pack: json(pack),
          generated_at: tx.now,
        })
        .onConflict((oc) => oc.columns(['tenant_id', 'property_id', 'business_date']).doNothing())
        .execute();
    }
    let exportStatus: Record<string, unknown>;
    const accounting = await ports.platform.getDataAuthority(tx, propertyId, 'accounting');
    if (accounting.authority !== 'external') {
      exportStatus = { status: 'not_required', reason: 'Portico is the accounting system of record here.' };
    } else {
      try {
        const r = await withSavepoint(tx, 'dcl_export', () =>
          ports.integration.queueJournalExport(tx, {
            propertyId,
            businessDate: D,
            idempotencyKey: `journal-export:${propertyId}:${D}`,
          }),
        );
        exportStatus = { ...r };
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        exportStatus = { status: 'pending', code: err.code };
        await upsertIssue(tx, {
          propertyId,
          businessDate: D,
          runId: s.run.id,
          code: 'journal_export_pending',
          severity: 'warning',
          dedupeKey: `journal_export_pending:${propertyId}:${D}`,
          ref: { type: 'day_report', id: `${propertyId}:${D}` },
          message: notConnected(err)
            ? `The accounting journal for ${D} was not handed to ${accounting.systemName ?? 'the accounting system'}: the export is not connected yet. Export it by hand.`
            : `The accounting journal for ${D} was not handed to ${accounting.systemName ?? 'the accounting system'} (${err.code}). Open the integration's exceptions to see why, then export it again.`,
          owner: { kind: 'department', id: 'finance' },
          details: { code: err.code },
        });
      }
    }
    if (!exists) {
      // Emitted once, in the transaction that stores the report (a resumed post-advance never re-announces the day).
      await emitRunEvent(tx, { ...s.run, version: s.run.version }, DAY_CLOSE_EVENTS.dayClosed, {
        newBusinessDate: next,
        factsRef: { type: 'day_facts', propertyId, businessDate: D },
      });
    }
    const postedAfterClose = await checkPostedAfterClose(s, tx, D);
    return { report: 'stored', export: exportStatus, postedAfterClose };
  });
  await s.hooks.afterItem?.('post_advance', 0);
  // Agreement lines served on D+1 (the departure transfer) land on the folio before check-out (review P2-10), and
  // stays checked in during the advance are posted now (on D+1, with the late-posting reason). Failures here never
  // hold the next close: the next Day Close retries them, and a warning says so.
  await postDueLines(s, 'post_advance', next, { retriedBy: 'next_close' });
  const swept = await sweepNight(s, 'post_advance', next, { retriedBy: 'next_close' });
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, 'post_advance'));
  const failedItems = [...recorded.values()].filter((i) => i.status === 'failed').length;
  return {
    status: 'completed',
    detail: { ...result, dueLinesAndLateCheckIns: recorded.size, swept: swept.swept, failedItems },
  };
}

export const STEP_FUNCTIONS: Record<StepKey, StepFn> = {
  preflight,
  no_shows: noShows,
  room_and_package_postings: roomAndPackagePostings,
  allowance_close: allowanceClose,
  payments_housekeeping: paymentsHousekeeping,
  integrity,
  final_sweep: finalSweep,
  advance,
  post_advance: postAdvance,
};

export type { TxContext };
export { toFailure };
