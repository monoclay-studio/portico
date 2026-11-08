/**
 * Day reports (DCL-R07): the immutable "as closed" pack plus a "restatements since" annex computed on read from
 * finance (corrections relating to the date, revenue now vs. revenue frozen at close). Frozen day facts (DCL-I03).
 * Portfolio Day Close board (DCL-R08).
 */
import type { TxContext } from '@portico/db';
import { diffDays, instantToZoned, NotFoundError, requirePermission } from '@portico/kernel';
import type { DayFacts, DayReport, RunStatus, StepKey } from '../contracts';
import { DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { type Deps, db } from './context';

export async function getFacts(
  _deps: Deps,
  tx: TxContext,
  propertyId: string,
  date: string,
): Promise<DayFacts> {
  requirePermission(tx, P.reportRead, { propertyId });
  const row = await db(tx)
    .selectFrom('day_close.day_facts')
    .select(['facts'])
    .where('property_id', '=', propertyId)
    .where('business_date', '=', date)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('day_facts', `${propertyId}:${date}`);
  return row.facts as DayFacts;
}

/**
 * Labels for exception codes in the immutable pack (rendered on read; the pack stores codes and references only, so
 * erasure in the owning module also reaches what the report shows, review P2-6).
 */
const EXCEPTION_LABELS: Record<string, string> = {
  departed_with_balance: 'A departed stay still has an open balance',
  settled_folio_with_balance: 'A settled folio still has a balance',
  departure_not_checked_out: 'A departure due today is not checked out',
  arrival_not_checked_in: 'An arrival due today is not checked in',
  arrival_transfer_delayed: "An arrival's transfer is delayed",
  payment_pending_verification: "A payment is waiting for the provider's answer",
  integration_exception: 'An integration exception is open',
  unit_without_status: 'A unit has no housekeeping status',
  night_not_posted: 'A night of an in-house stay had no room charge yet',
  inventory_not_checked:
    'The inventory ledger consistency check is not connected: the books were proved without it',
};

export async function getReport(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  date: string,
): Promise<DayReport> {
  requirePermission(tx, P.reportRead, { propertyId });
  const row = await db(tx)
    .selectFrom('day_close.day_reports')
    .selectAll()
    .where('property_id', '=', propertyId)
    .where('business_date', '=', date)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('day_report', `${propertyId}:${date}`);
  const stored = row.pack as DayReport['pack'];
  // Render messages and names now, from their owners (Day Close's own follow-ups; staff names from the overrides).
  const issueIds = stored.exceptions
    .map((e) => e.issueId)
    .filter((id): id is string => typeof id === 'string');
  const issues = issueIds.length
    ? await db(tx)
        .selectFrom('day_close.issues')
        .select(['id', 'message'])
        .where('id', 'in', issueIds)
        .execute()
    : [];
  const issueMessage = new Map(issues.map((i) => [i.id, i.message]));
  const overrideIds = stored.overrides
    .map((o) => o.overrideId)
    .filter((id): id is string => typeof id === 'string');
  const overrideRows = overrideIds.length
    ? await db(tx)
        .selectFrom('day_close.overrides')
        .select(['id', 'actor_name'])
        .where('id', 'in', overrideIds)
        .execute()
    : [];
  const byName = new Map(overrideRows.map((o) => [o.id, o.actor_name]));
  const pack: DayReport['pack'] = {
    ...stored,
    exceptions: stored.exceptions.map((e) => ({
      ...e,
      message:
        (typeof e.issueId === 'string' ? issueMessage.get(e.issueId) : undefined) ??
        EXCEPTION_LABELS[String(e.code)] ??
        String(e.code),
    })),
    overrides: stored.overrides.map((o) => ({
      ...o,
      byName: (typeof o.overrideId === 'string' ? byName.get(o.overrideId) : null) ?? null,
    })),
  };
  // Annex, labelled by cause (review P2-3/P2-4/P2-13). The facts are frozen in the advance transaction, so revenue
  // stamped with the date that differs now committed after the close (in flight while the date advanced).
  const closed = ((stored.managerFlash as Partial<DayFacts>).revenueByChargeCode ?? []) as Array<{
    chargeCode: string;
    netMinor: number;
  }>;
  const now = await deps.ports.finance.dailyRevenue(tx, { propertyId }, { businessDate: date });
  const codes = new Set([...closed.map((c) => c.chargeCode), ...now.byChargeCode.map((c) => c.chargeCode)]);
  const revenueDelta = [...codes]
    .sort()
    .map((chargeCode) => ({
      chargeCode,
      closedMinor: closed.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
      nowMinor: now.byChargeCode.find((c) => c.chargeCode === chargeCode)?.netMinor ?? 0,
      cause: 'posted_after_close' as const,
    }))
    .filter((d) => d.closedMinor !== d.nowMinor);
  const entries = now.restatements
    .filter((r) => r.relatesTo === date)
    .map((r) => ({
      entryId: r.entryId,
      relatesTo: r.relatesTo,
      reason: r.reason,
      amountMinor: r.amountMinor,
      cause: 'correction',
    }));
  // Day Close's own postings for this date's service made after the date closed (catch-up nights, agreement lines).
  const late = await db(tx)
    .selectFrom('day_close.line_postings')
    .select(['stay_id', 'line_key', 'kind', 'service_date', 'business_date', 'amount_minor', 'currency'])
    .where('property_id', '=', propertyId)
    .where('outcome', '=', 'posted')
    .where('service_date', '=', date)
    .where('business_date', '>', date)
    .orderBy('business_date')
    .orderBy('line_key')
    .execute();
  const byDayClose = late.map((l) => ({
    stayId: l.stay_id,
    lineKey: l.line_key,
    kind: l.kind,
    serviceDate: l.service_date,
    postedOn: l.business_date,
    amount: { amountMinor: Number(l.amount_minor), currency: l.currency },
    cause: 'late_posting' as const,
  }));
  return {
    id: `${propertyId}:${date}`,
    propertyId,
    businessDate: date,
    runId: row.run_id,
    generatedAt: (row.generated_at as Date).toISOString(),
    pack,
    restatementsSince: {
      asOf: tx.now.toISOString(),
      revenueDelta,
      entries,
      latePostings: {
        byDayClose,
        otherSources: {
          status: 'not_connected',
          reason:
            "Charges other modules post for this date after it closed (e.g. a restaurant check handed in late) need finance to list postings by service date (CR-19). Until then they appear in the revenue of the day they were posted, with finance's late-posting reason.",
        },
      },
      changed: revenueDelta.length > 0 || entries.length > 0 || byDayClose.length > 0,
    },
    links: [
      { rel: 'run', type: 'day_close_run', id: row.run_id },
      { rel: 'property', type: 'property', id: propertyId },
    ],
    provenance: tx.environment === 'live' ? 'live' : 'simulated',
  };
}

/** Portfolio board: each permitted property's business date, run status, blocking count and lag. */
export async function portfolio(deps: Deps, tx: TxContext) {
  const scope = tx.authz.propertyScope(P.runRead);
  const props = (await deps.ports.platform.listProperties(tx)).filter(
    (p) => scope === 'all' || scope.includes(p.id),
  );
  const out = [];
  for (const p of props) {
    const run = await db(tx)
      .selectFrom('day_close.runs')
      .selectAll()
      .where('property_id', '=', p.id)
      .orderBy('business_date', 'desc')
      .orderBy('started_at', 'desc')
      .executeTakeFirst();
    const last = await db(tx)
      .selectFrom('day_close.runs')
      .select(['finished_at'])
      .where('property_id', '=', p.id)
      .where('status', '=', 'completed')
      .orderBy('business_date', 'desc')
      .executeTakeFirst();
    const today = instantToZoned(tx.now, p.timezone).date;
    const lagDays = Math.max(0, diffDays(p.businessDate, today) - 1);
    const blockers =
      run?.status === 'blocked' ? ((run.failure as { blockers?: string[] })?.blockers ?? []) : null;
    out.push({
      propertyId: p.id,
      name: p.name,
      businessDate: p.businessDate,
      lagDays,
      run: run
        ? {
            id: run.id,
            propertyId: run.property_id,
            businessDate: run.business_date,
            runStatus: run.status as RunStatus,
            startedAt: (run.started_at as Date).toISOString(),
            finishedAt: run.finished_at ? (run.finished_at as Date).toISOString() : null,
            currentStep: (run.current_step as StepKey | null) ?? null,
            version: run.version,
          }
        : null,
      blockingCount: blockers ? blockers.length : null,
      lastCompletedAt: last?.finished_at ? (last.finished_at as Date).toISOString() : null,
      alert:
        lagDays >= 1
          ? `Business date ${p.businessDate} is ${lagDays} day${lagDays === 1 ? '' : 's'} behind: Day Close has not run.`
          : run?.status === 'failed'
            ? 'Day Close stopped and needs a resume.'
            : null,
    });
  }
  return { generatedAt: tx.now.toISOString(), properties: out };
}
