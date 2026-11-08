/**
 * Day Close readiness (DCL-R01): one running list, available all day, of what is still open for the business
 * date — aggregated from the modules that own each fact, with the fix and the owner per item. Policy decides what
 * blocks; overrides (with reasons) clear a blocking item for one run. A source that cannot be read is reported as
 * missing (never silently treated as "nothing open").
 */
import { type TxContext, withSavepoint } from '@portico/db';
import { addDays, DomainError, type LocalDate, requirePermission } from '@portico/kernel';
import type { DayClosePolicy, Readiness, ReadinessItem, RunStatus } from '../contracts';
import { classify, effectiveBlockingCodes } from '../domain/policy';
import { itemKey, sortItems, summarize, transferDelayed } from '../domain/readiness';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import type { DueStay } from '../ports';
import { type Deps, db } from './context';
import { resolvePolicy } from './policy';

export type OwnerRole = 'front_office' | 'finance' | 'housekeeping' | 'night_audit' | 'systems';

const OWNER_NAMES: Record<OwnerRole, string> = {
  front_office: 'Front office',
  finance: 'Finance',
  housekeeping: 'Housekeeping',
  night_audit: 'Night audit',
  systems: 'Systems / integrations',
};

interface RawItem {
  source: string;
  code: string;
  severity: 'blocking' | 'warning' | 'info';
  ref: { type: string; id: string } | null;
  owner: OwnerRole;
  message: string;
  actions: Array<{ action: string; label: string; module: string; permission: string }>;
  since?: string | null;
  details?: Record<string, unknown>;
}

const act = (action: string, label: string, module: string, permission: string) => ({
  action,
  label,
  module,
  permission,
});

/** Map finance's Day Close checks (`getUnbalancedItems`) to owners and fixes. */
function financeItem(i: {
  code: string;
  severity: string;
  ref: { type: string; id: string } | null;
  message: string;
  details?: Record<string, unknown>;
}): RawItem {
  const base = {
    source: 'finance',
    code: i.code,
    severity: (i.severity === 'blocking' ? 'blocking' : 'warning') as 'blocking' | 'warning',
    ref: i.ref,
    message: i.message,
    details: i.details ?? {},
  };
  switch (i.code) {
    case 'entry_unbalanced':
    case 'folio_ledger_mismatch':
    case 'negative_deposit':
      return {
        ...base,
        owner: 'finance',
        actions: [act('reviewLedger', 'Open the ledger check', 'finance', 'finance.ledger.read')],
      };
    case 'settled_folio_with_balance':
      return {
        ...base,
        owner: 'finance',
        actions: [act('reopenFolio', 'Review the folio balance', 'finance', 'finance.folio.manage')],
      };
    case 'departed_with_balance':
      return {
        ...base,
        owner: 'front_office',
        actions: [
          act('collectPayment', 'Collect the balance', 'payments', 'payments.payment.collect'),
          act(
            'transferToReceivables',
            'Transfer to receivables',
            'finance',
            'finance.folio.settleToReceivables',
          ),
        ],
      };
    case 'cashier_session_open':
      return {
        ...base,
        owner: 'front_office',
        actions: [
          act('closeCashierSession', 'Close the cashier session', 'finance', 'finance.cashier.operate'),
        ],
      };
    case 'payments_awaiting_verification':
      return {
        ...base,
        owner: 'finance',
        actions: [act('reconcilePayments', 'Match to a statement', 'payments', 'payments.payment.read')],
      };
    case 'invoice_overdue_for_issue':
      return {
        ...base,
        owner: 'finance',
        actions: [act('issueInvoice', 'Issue the invoice', 'finance', 'finance.invoice.issue')],
      };
    default:
      return {
        ...base,
        owner: 'finance',
        actions: [act('openException', 'Open in Finance', 'finance', 'finance.folio.read')],
      };
  }
}

function arrivalItem(s: DueStay, policy: DayClosePolicy, now: Date): RawItem {
  const ref = { type: 'stay', id: s.stayId };
  const delayed = policy.noShow.protectDelayedTransfers && transferDelayed(s.transfer, s.eta, now);
  if (delayed) {
    const at = s.transfer.estimatedAt ?? s.eta;
    return {
      source: 'reservations',
      code: 'arrival_transfer_delayed',
      severity: 'warning',
      ref,
      owner: 'front_office',
      message: `Arrival due ${s.arrival} is on the way${at ? ` (transfer now expected ${at})` : ''}. Day Close will not mark it no-show; check the guest in on arrival, or record a no-show only if the guest will not come.`,
      actions: [
        act('checkIn', 'Check in', 'reservations', 'reservations.stay.checkIn'),
        act('markNoShow', 'Mark no-show', 'reservations', 'reservations.stay.noShow'),
      ],
      details: { arrival: s.arrival, transfer: s.transfer },
    };
  }
  const message =
    policy.noShow.mode === 'auto'
      ? `Expected arrival due ${s.arrival} is not checked in. Day Close will record it as a no-show and post the agreed no-show charge unless it is checked in or cancelled first.`
      : policy.noShow.mode === 'decide'
        ? `Expected arrival due ${s.arrival} is not checked in. Decide: check in, cancel, or record a no-show.`
        : `Expected arrival due ${s.arrival} is not checked in; it stays expected for the next day (no-shows are handled by hand here).`;
  return {
    source: 'reservations',
    code: 'arrival_not_checked_in',
    severity: 'warning',
    ref,
    owner: 'front_office',
    message,
    actions: [
      act('checkIn', 'Check in', 'reservations', 'reservations.stay.checkIn'),
      act('markNoShow', 'Mark no-show', 'reservations', 'reservations.stay.noShow'),
      act('cancelStay', 'Cancel the stay', 'reservations', 'reservations.booking.cancel'),
    ],
    details: { arrival: s.arrival, mode: policy.noShow.mode },
  };
}

function departureItem(s: DueStay): RawItem {
  return {
    source: 'reservations',
    code: 'departure_not_checked_out',
    severity: 'blocking',
    ref: { type: 'stay', id: s.stayId },
    owner: 'front_office',
    message: `Departure due ${s.departure} is still in house. Check the guest out, or extend the stay (for example a cancelled seaplane) so tonight is charged. Day Close never checks a guest out by itself.`,
    actions: [
      act('checkOut', 'Check out', 'reservations', 'reservations.stay.checkOut'),
      act('extendStay', 'Extend the stay', 'reservations', 'reservations.booking.update'),
    ],
    details: { departure: s.departure },
  };
}

/**
 * Collect every open item for the property's business date (no permission check: callers authorize).
 * `runId` scopes overrides and run-local facts.
 */
export async function collectReadiness(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  opts: { runId?: string | null; businessDate?: LocalDate } = {},
): Promise<Readiness & { policy: DayClosePolicy }> {
  const { ports } = deps;
  const property = await ports.platform.getProperty(tx, propertyId);
  const businessDate = opts.businessDate ?? property.businessDate;
  const resolved = await resolvePolicy(deps, tx, propertyId);
  const policy = resolved.policy;
  const raws: RawItem[] = [];
  const unavailable: Array<{ source: string; reason: string }> = [];

  const gather = async (source: string, fn: () => Promise<RawItem[]>) => {
    try {
      raws.push(
        ...(await withSavepoint(tx, `dcl_src_${source.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`, fn)),
      );
    } catch (err) {
      const reason =
        err instanceof DomainError
          ? err.message
          : 'This check could not be read right now. Its items are not shown; try again shortly.';
      unavailable.push({ source, reason });
    }
  };

  if (!resolved.valid) {
    raws.push({
      source: 'dayClose',
      code: 'policy_invalid',
      severity: 'blocking',
      ref: { type: 'property', id: propertyId },
      owner: 'night_audit',
      message: `The Day Close policy of this property cannot be used (${resolved.problems.join('; ')}). The safe defaults apply until it is corrected.`,
      actions: [act('editPolicy', 'Correct the Day Close policy', 'dayClose', P.policyManage)],
    });
  }

  await gather('reservations.arrivals', async () =>
    (await ports.reservations.listDueArrivals(tx, { propertyId, date: businessDate })).map((s) =>
      arrivalItem(s, policy, tx.now),
    ),
  );
  await gather('reservations.departures', async () =>
    (await ports.reservations.listDueDepartures(tx, { propertyId, date: businessDate })).map(departureItem),
  );
  await gather('finance', async () =>
    (await ports.finance.getUnbalancedItems(tx, { propertyId }, businessDate)).map(financeItem),
  );
  await gather('payments', async () => {
    const u = await ports.payments.listUnresolved(tx, { propertyId });
    return u.pendingVerification.map((p) => ({
      source: 'payments',
      code: 'payment_pending_verification',
      severity: 'warning' as const,
      ref: { type: p.type, id: p.id },
      owner: 'finance' as const,
      message: `A ${p.type} of ${(p.amountMinor / 100).toFixed(2)} ${p.currency} is waiting for the provider's answer (pending verification since ${p.since}). It is not counted as paid until verified.`,
      actions: [act('verifyPayment', 'Check the payment status', 'payments', 'payments.payment.read')],
      since: p.since,
      details: { amountMinor: p.amountMinor, currency: p.currency },
    }));
  });
  await gather('catchUp', async () => {
    const out: RawItem[] = [];
    for (const n of await catchUpNights(deps, tx, propertyId, businessDate, policy, opts.runId ?? null)) {
      out.push({
        source: 'dayClose',
        code: 'night_not_posted',
        severity: 'info',
        ref: { type: 'stay', id: n.stayId },
        owner: 'night_audit',
        message: `Night ${n.night} of this in-house stay has no room charge yet (checked in after that night's postings). Day Close posts it once, with the same key, in its posting step.`,
        actions: [act('resume', 'Posted by Day Close', 'dayClose', P.runStart)],
        details: { night: n.night },
      });
    }
    return out;
  });
  await gather('integration', async () =>
    (await ports.integration.listOpenExceptions(tx, { propertyId })).map((e) => ({
      source: 'integration',
      code: 'integration_exception',
      severity: 'warning' as const,
      ref: { type: 'integration_exception', id: e.id },
      owner: 'systems' as const,
      message: `${e.problem} Next step: ${e.nextStep}`,
      actions: [
        act(
          'resolveException',
          'Open the integration exception',
          'integration',
          'integration.exception.resolve',
        ),
      ],
      details: { severity: e.severity, workflow: e.workflow, responsibleParty: e.responsibleParty },
    })),
  );
  await gather('operations', async () => {
    const [units, conditions] = await Promise.all([
      ports.inventory.listUnits(tx, { propertyId }),
      ports.operations.listUnitConditions(tx, { propertyId }),
    ]);
    const byUnit = new Map(conditions.map((c) => [c.unitId, c]));
    const out: RawItem[] = [];
    for (const u of units) {
      const c = byUnit.get(u.id);
      if (!c?.condition) {
        out.push({
          source: 'operations',
          code: 'unit_without_status',
          severity: 'warning',
          ref: { type: 'unit', id: u.id },
          owner: 'housekeeping',
          message: `Unit ${u.number} has no housekeeping status. Set its condition so tomorrow's plan and arrivals are right.`,
          actions: [
            act('setCondition', 'Set the unit condition', 'operations', 'operations.housekeeping.update'),
          ],
        });
      } else if (c.discrepancy) {
        out.push({
          source: 'operations',
          code: 'room_status_discrepancy',
          severity: 'warning',
          ref: { type: 'unit', id: u.id },
          owner: 'housekeeping',
          message: `Unit ${c.unitNumber}: housekeeping saw "${c.discrepancy}", which differs from the front office status. Check the room.`,
          actions: [
            act(
              'resolveDiscrepancy',
              'Resolve the discrepancy',
              'operations',
              'operations.housekeeping.update',
            ),
          ],
          details: { discrepancy: c.discrepancy },
        });
      }
    }
    return out;
  });
  // Day Close's own follow-ups (no-show fees to collect, failed items, alarms).
  const own = await db(tx)
    .selectFrom('day_close.issues')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('status', '=', 'open')
    .orderBy('created_at')
    .execute();
  for (const i of own) {
    // A decision this run's own override asked for does not block this run (the override is tonight's decision);
    // it blocks the next close until a person decides (review P1-1).
    const ownDecision = i.code === 'night_decision_needed' && !!opts.runId && i.run_id === opts.runId;
    raws.push({
      source: 'dayClose',
      code: i.code,
      severity: ownDecision ? 'warning' : (i.severity as RawItem['severity']),
      ref: i.ref_type && i.ref_id ? { type: i.ref_type, id: i.ref_id } : null,
      owner: ((i.owner as { id?: string } | null)?.id as OwnerRole) ?? 'night_audit',
      message: i.message,
      actions: ownIssueActions(i.code),
      since: (i.created_at as Date).toISOString(),
      details: { issueId: i.id, ...((i.details as Record<string, unknown>) ?? {}) },
    });
  }

  const overrides = opts.runId
    ? await db(tx).selectFrom('day_close.overrides').selectAll().where('run_id', '=', opts.runId).execute()
    : [];
  const overrideByKey = new Map(overrides.map((o) => [o.item_key, o]));
  const departments = await withSavepoint(tx, 'dcl_departments', () =>
    ports.platform.listDepartments(tx, propertyId),
  ).catch(() => [] as Array<{ id: string; kind: string; name: string }>);
  const items: ReadinessItem[] = raws.map((r) => {
    const key = itemKey(r.source, r.code, r.ref);
    const o = overrideByKey.get(key);
    const { blocking, overridable } = classify(r, policy, !!o);
    const dept = departments.find((d) => d.kind === r.owner);
    const actions = r.actions.map((a) => {
      const enabled = tx.authz.can(a.permission, { propertyId });
      return {
        action: a.action,
        label: a.label,
        module: a.module,
        ref: r.ref,
        enabled,
        ...(enabled ? {} : { reason: `Needs the ${a.permission} permission.` }),
      };
    });
    if (overridable && !o) {
      const can = tx.authz.can(P.exceptionOverride, { propertyId });
      actions.push({
        action: 'override',
        label: 'Proceed anyway (with a reason)',
        module: 'dayClose',
        ref: r.ref,
        enabled: can,
        ...(can ? {} : { reason: `Needs the ${P.exceptionOverride} permission.` }),
      });
    }
    return {
      key,
      source: r.source,
      code: r.code,
      severity: r.severity,
      blocking,
      overridable,
      override: o
        ? { reason: o.reason, by: o.actor_name ?? o.actor, at: (o.created_at as Date).toISOString() }
        : null,
      ref: r.ref,
      owner: dept
        ? { kind: 'department' as const, id: dept.id, name: dept.name }
        : { kind: 'department' as const, id: `role:${r.owner}`, name: OWNER_NAMES[r.owner] },
      message: r.message,
      actions,
      since: r.since ?? null,
      details: r.details ?? {},
    };
  });
  const sorted = sortItems(items);
  const blockingItems = sorted.filter((i) => i.blocking);
  const warnings = sorted.filter((i) => !i.blocking && i.severity !== 'info');
  const info = sorted.filter((i) => !i.blocking && i.severity === 'info');
  const counts = { blocking: blockingItems.length, warning: warnings.length, info: info.length };
  const activeRun = await db(tx)
    .selectFrom('day_close.runs')
    .select(['id', 'status', 'version'])
    .where('property_id', '=', propertyId)
    .where('status', 'in', ['preflight', 'blocked', 'running', 'failed'])
    .executeTakeFirst();
  return {
    propertyId,
    businessDate,
    evaluatedAt: tx.now.toISOString(),
    summary: summarize(counts, unavailable.length),
    canClose: counts.blocking === 0,
    counts,
    blocking: blockingItems,
    warnings,
    info,
    unavailableSources: unavailable,
    provenance: unavailable.length ? 'incomplete' : tx.environment === 'live' ? 'live' : 'simulated',
    activeRun: activeRun
      ? { id: activeRun.id, status: activeRun.status as RunStatus, version: activeRun.version }
      : null,
    policy,
  };
}

function ownIssueActions(code: string): RawItem['actions'] {
  const resolve = act('resolveIssue', 'Mark as handled (with a note)', 'dayClose', P.issueResolve);
  switch (code) {
    case 'no_show_fee_to_collect':
      return [
        act('createPaymentLink', 'Send a payment link', 'payments', 'payments.paymentRequest.create'),
        resolve,
      ];
    case 'step_item_failed':
      return [act('resume', 'Resume Day Close', 'dayClose', P.runResume), resolve];
    case 'integrity_failed':
      return [act('reviewLedger', 'Open the ledger check', 'finance', 'finance.ledger.read')];
    case 'levy_not_posted':
      return [act('postCharge', 'Post the levy by hand', 'finance', 'finance.posting.create'), resolve];
    case 'night_decision_needed':
      return [
        act(
          'decideNight:post_by_day_close',
          'Let Day Close post this night',
          'dayClose',
          P.exceptionOverride,
        ),
        act('decideNight:posted_elsewhere', 'It was charged another way', 'dayClose', P.exceptionOverride),
      ];
    case 'night_not_posted_departed':
      return [act('postCharge', 'Post the night in finance', 'finance', 'finance.posting.create'), resolve];
    case 'posted_line_changed':
    case 'posting_conflict':
    case 'posted_from_last_known_agreement':
    case 'posted_after_close':
      return [act('openFolio', 'Review the folio', 'finance', 'finance.folio.read'), resolve];
    case 'close_overdue':
      return [act('startRun', 'Start Day Close', 'dayClose', P.runStart), resolve];
    default:
      return [resolve];
  }
}

/** Public readiness (DCL-R01): available all day to anyone with `dayClose.run.read` at the property. */
export async function getReadiness(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  opts: { businessDate?: LocalDate } = {},
): Promise<Readiness> {
  requirePermission(tx, P.runRead, { propertyId });
  const active = await db(tx)
    .selectFrom('day_close.runs')
    .select(['id'])
    .where('property_id', '=', propertyId)
    .where('status', 'in', ['preflight', 'blocked', 'running', 'failed'])
    .executeTakeFirst();
  const { policy: _policy, ...r } = await collectReadiness(deps, tx, propertyId, {
    runId: active?.id ?? null,
    ...(opts.businessDate ? { businessDate: opts.businessDate } : {}),
  });
  return r;
}

/** Business dates of this property whose Day Close completed, before `before` (oldest first). */
export async function nightsClosed(
  tx: TxContext,
  propertyId: string,
  before: LocalDate,
): Promise<LocalDate[]> {
  const rows = await db(tx)
    .selectFrom('day_close.runs')
    .select('business_date')
    .where('property_id', '=', propertyId)
    .where('status', '=', 'completed')
    .where('business_date', '<', before)
    .orderBy('business_date')
    .execute();
  return rows.map((r) => r.business_date);
}

/** The latest decision per night a person took over for a stay (P1-1). */
export async function latestDecisions(tx: TxContext, stayId: string): Promise<Map<LocalDate, string>> {
  const rows = await db(tx)
    .selectFrom('day_close.night_decisions')
    .select(['night', 'decision'])
    .where('stay_id', '=', stayId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const out = new Map<LocalDate, string>();
  for (const r of rows) out.set(r.night, r.decision);
  return out;
}

/**
 * Nights before (and, once the active run's posting step is done, on) the business date whose in-house stays have
 * no Day Close posting (DCL-R04, DCL-I04). Only nights Day Close is responsible for: nights of dates whose own Day
 * Close completed (or the current date after this run posted it) — never nights from before Portico closed days.
 * A night a person took over is excluded until they decide "Day Close posts it" (review P1-1).
 */
export async function catchUpNights(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  businessDate: LocalDate,
  policy: DayClosePolicy,
  runId: string | null,
): Promise<Array<{ stayId: string; night: LocalDate }>> {
  const from = addDays(businessDate, -policy.catchUpWindowNights);
  const closed = await db(tx)
    .selectFrom('day_close.runs')
    .select('business_date')
    .where('property_id', '=', propertyId)
    .where('status', '=', 'completed')
    .where('business_date', '>=', from)
    .where('business_date', '<', businessDate)
    .execute();
  const nights = closed.map((r) => r.business_date);
  if (runId) {
    const postings = await db(tx)
      .selectFrom('day_close.steps')
      .select('status')
      .where('run_id', '=', runId)
      .where('key', '=', 'room_and_package_postings')
      .executeTakeFirst();
    if (postings?.status === 'completed') nights.push(businessDate);
  }
  const out: Array<{ stayId: string; night: LocalDate }> = [];
  for (const night of nights.sort()) {
    const stays = await deps.ports.reservations.listInHouseStaysForNight(tx, { propertyId, date: night });
    if (!stays.length) continue;
    const posted = await db(tx)
      .selectFrom('day_close.night_postings')
      .select('stay_id')
      .where('property_id', '=', propertyId)
      .where('night', '=', night)
      .where(
        'stay_id',
        'in',
        stays.map((s) => s.stayId),
      )
      .execute();
    const done = new Set(posted.map((p) => p.stay_id));
    // A night a person overrode is a decision, not a gap (P1-1): never caught up unless they chose "post it".
    const decided = await db(tx)
      .selectFrom('day_close.night_decisions')
      .select(['stay_id', 'decision', 'created_at', 'id'])
      .where('night', '=', night)
      .where(
        'stay_id',
        'in',
        stays.map((s) => s.stayId),
      )
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const latest = new Map<string, string>();
    for (const d of decided) latest.set(d.stay_id, d.decision);
    for (const s of stays) {
      const d = latest.get(s.stayId);
      if (!done.has(s.stayId) && d !== 'skip_pending' && d !== 'posted_elsewhere')
        out.push({ stayId: s.stayId, night });
    }
  }
  return out;
}

export { effectiveBlockingCodes };
