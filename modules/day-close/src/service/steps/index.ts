/**
 * The ordered Day Close steps (DCL-R02). Each is idempotent: completed steps are never re-run, partially done steps
 * re-run safely because every effect is keyed and every item's progress commits with its effect.
 */
import { sql, type TxContext, withSavepoint } from '@portico/db';
import { addDays, DomainError, ModuleUnavailableError, money } from '@portico/kernel';
import type { DayFacts, StepKey } from '../../contracts';
import { toFailure } from '../../domain/errors';
import { isIntegrityCode } from '../../domain/policy';
import { transferDelayed } from '../../domain/readiness';
import { computeKpis } from '../../domain/statistics';
import { DAY_CLOSE_EVENTS } from '../../events';
import type { DueStay } from '../../ports';
import { db, json } from '../context';
import { collectReadiness } from '../readiness';
import { closeIssue, emitRunEvent, loadItems, setStep, upsertIssue } from '../repo';
import { pregrantAllowances, processItems, roomAndPackagePostings, sweepNight } from './postings';
import type { StepContext, StepFn, StepOutcome } from './shared';

const notConnected = (err: unknown): boolean =>
  err instanceof ModuleUnavailableError ||
  (err instanceof DomainError && err.code === 'module_not_available');

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
    const r = await collectReadiness(s.deps, tx, propertyId, {
      runId: s.run.id,
      businessDate: s.run.business_date,
    });
    const detail = {
      evaluatedAt: r.evaluatedAt,
      counts: r.counts,
      unavailableSources: r.unavailableSources,
      warnings: r.warnings.map((w) => ({ key: w.key, code: w.code, message: w.message })),
      overridden: [...r.warnings, ...r.info]
        .filter((w) => w.override)
        .map((w) => ({ key: w.key, code: w.code, reason: w.override?.reason })),
    };
    if (r.blocking.length) return { status: 'blocked', blockers: r.blocking, detail };
    return { status: 'completed', detail };
  });
}

// ───────────────────────────── 2. no-shows ─────────────────────────────

async function noShows(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const mode = s.policy.noShow.mode;
  if (mode === 'off')
    return { status: 'skipped', detail: { reason: 'Policy: no-shows are handled by hand.' } };
  const propertyId = s.property.id;
  const D = s.run.business_date;
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
    const decidedToKeep =
      overridden.has(`reservations:arrival_not_checked_in:stay:${a.stayId}`) ||
      overridden.has(`reservations:arrival_transfer_delayed:stay:${a.stayId}`);
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
      const followUp = async (reason: string) => {
        await upsertIssue(tx, {
          propertyId,
          businessDate: D,
          runId: s.run.id,
          code: 'no_show_fee_to_collect',
          severity: 'warning',
          dedupeKey: `no_show_fee_to_collect:${a.stayId}`,
          ref: { type: 'stay', id: a.stayId },
          message: `No-show charge of ${(r.penalty.amountMinor / 100).toFixed(2)} ${r.penalty.currency} is on the guest's folio but was not collected: ${reason}`,
          owner: { kind: 'department', id: 'finance' },
          details: { amount: r.penalty, bookingId: a.bookingId },
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
          await followUp(c.reason ?? 'the booking has no agreed guarantee for a no-show charge.');
      } catch (err) {
        if (err instanceof DomainError) {
          collection = { status: 'not_requested', code: err.code };
          await followUp(
            notConnected(err)
              ? 'automatic collection is not connected yet. Send the guest a payment link or collect it another way.'
              : err.message,
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

async function allowanceClose(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  const stays = await s.inTx((tx) =>
    ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D }),
  );
  const step: StepKey = 'allowance_close';
  const items = stays.map((st) => ({
    key: `allowance:${st.stayId}:${D}`,
    ref: { type: 'stay', id: st.stayId },
    kind: 'night' as const,
    stay: st,
  }));
  const recorded = await s.inTx((tx) => loadItems(tx, s.run.id, step));
  await s.inTx((tx) =>
    setStep(tx, s.run.id, step, { total: new Set([...recorded.keys(), ...items.map((i) => i.key)]).size }),
  );
  await processItems(s, step, items, async (tx, item) => {
    const st = item.stay;
    if (!st) return {};
    const r = await ports.finance.closeAllowances(
      tx,
      { propertyId },
      { stayId: st.stayId, upTo: addDays(D, 1), departureDate: st.departure },
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
    const alarms = (await ports.finance.getUnbalancedItems(tx, { propertyId }, D)).filter((i) =>
      isIntegrityCode(i.code),
    );
    let inventory: Record<string, unknown>;
    let inventoryOk = true;
    try {
      const d = await withSavepoint(tx, 'dcl_inv_check', () =>
        ports.inventory.checkLedgerConsistency(tx, { propertyId, fromNight: D }),
      );
      inventoryOk = d.length === 0;
      inventory = { checked: true, discrepancies: d.slice(0, 50) };
    } catch (err) {
      if (!notConnected(err)) throw err;
      inventory = { checked: false, reason: 'Inventory consistency check is not connected.' };
    }
    const detail = { checks: report.checks, alarms, inventory };
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

// ───────────────────────────── 7. statistics snapshot ─────────────────────────────

async function statisticsSnapshot(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  return s.inTx(async (tx) => {
    const existing = await db(tx)
      .selectFrom('day_close.day_facts')
      .select(['generated_at'])
      .where('property_id', '=', propertyId)
      .where('business_date', '=', D)
      .executeTakeFirst();
    if (existing)
      return { status: 'completed', detail: { frozenAt: existing.generated_at, alreadyFrozen: true } };
    const cells = (await ports.inventory.getAvailability(tx, { propertyId, date: D })).filter(
      (c) => !c.composite,
    );
    const stays = await ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: D });
    const revenue = await ports.finance.dailyRevenue(tx, { propertyId }, { businessDate: D });
    const noShowItems = await loadItems(tx, s.run.id, 'no_shows');
    const noShows = [...noShowItems.values()].filter(
      (i) => i.status === 'done' && (i.result as { outcome?: string }).outcome === 'no_show',
    ).length;
    const sold = stays.filter((x) => x.commercialType === 'standard').length;
    const complimentary = stays.filter((x) => x.commercialType === 'complimentary').length;
    const houseUse = stays.filter((x) => x.commercialType === 'house_use').length;
    const rooms = {
      capacity: cells.reduce((a, c) => a + c.capacity, 0),
      outOfOrder: cells.reduce((a, c) => a + c.outOfOrder, 0),
      sold,
      complimentary,
      houseUse,
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
        noShows,
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
    return {
      status: 'completed',
      detail: { occupancyPercent: facts.occupancyPercent, adr: facts.adr, revpar: facts.revpar },
    };
  });
}

// ───────────────────────────── 8. advance ─────────────────────────────

async function advance(s: StepContext): Promise<StepOutcome> {
  const swept = await sweepNight(s);
  if (swept) return swept;
  const propertyId = s.property.id;
  const D = s.run.business_date;
  return s.inTx(async (tx) => {
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
    const next = await s.deps.ports.platform.advanceBusinessDate(tx, {
      propertyId,
      expected: D,
      dayCloseRunId: s.run.id,
    });
    await s.hooks.insideItem?.('advance', 0);
    // Completion commits in the SAME transaction as the advance: a crash cannot leave the date advanced while the
    // step looks unfinished (resume never advances twice).
    await setStep(tx, s.run.id, 'advance', {
      status: 'completed',
      finished: true,
      detail: { from: D, to: next },
    });
    await tx.audit({
      action: 'dayClose.businessDate.advanced',
      target: { type: 'day_close_run', id: s.run.id },
      propertyId,
      before: { businessDate: D },
      after: { businessDate: next },
    });
    return { status: 'completed', detail: { from: D, to: next }, persisted: true };
  });
}

// ───────────────────────────── 9. post-advance ─────────────────────────────

async function postAdvance(s: StepContext): Promise<StepOutcome> {
  const { ports } = s.deps;
  const propertyId = s.property.id;
  const D = s.run.business_date;
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
        .select(['code', 'severity', 'message', 'ref_type', 'ref_id', 'status'])
        .where('property_id', '=', propertyId)
        .where('business_date', '=', D)
        .execute();
      const preflightDetail = (steps.find((x) => x.key === 'preflight')?.detail ?? {}) as Record<
        string,
        unknown
      >;
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
          ...((preflightDetail.warnings as unknown[]) ?? []).map((w) => ({
            ...(w as object),
            stage: 'preflight',
          })),
          ...issues.map((i) => ({ ...i, stage: 'follow_up' })),
        ],
        overrides: overrides.map((o) => ({
          itemKey: o.item_key,
          code: o.code,
          reason: o.reason,
          by: o.actor_name ?? o.actor,
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
          message: `The accounting journal for ${D} was not handed to ${accounting.systemName ?? 'the accounting system'}: ${err.message}`,
          owner: { kind: 'department', id: 'finance' },
        });
      }
    }
    if (!exists) {
      // Emitted once, in the transaction that stores the report (a resumed post-advance never re-announces the day).
      await emitRunEvent(tx, { ...s.run, version: s.run.version }, DAY_CLOSE_EVENTS.dayClosed, {
        newBusinessDate: addDays(D, 1),
        factsRef: { type: 'day_facts', propertyId, businessDate: D },
      });
    }
    return { report: 'stored', export: exportStatus };
  });
  const allowances = await pregrantAllowances(s, addDays(D, 1));
  return { status: 'completed', detail: { ...result, allowances } };
}

export const STEP_FUNCTIONS: Record<StepKey, StepFn> = {
  preflight,
  no_shows: noShows,
  room_and_package_postings: roomAndPackagePostings,
  allowance_close: allowanceClose,
  payments_housekeeping: paymentsHousekeeping,
  integrity,
  statistics_snapshot: statisticsSnapshot,
  advance,
  post_advance: postAdvance,
};

export type { TxContext };
export { toFailure };
