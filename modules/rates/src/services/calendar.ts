/** Rate calendar: prices and restrictions, bulk updates with preview, versioned history, events. */
import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, type DateRange, type LocalDate, NotFoundError, newId, ValidationError } from '@portico/kernel';
import {
  type OccupancyPricing,
  type PriceBulkUpdate,
  type PriceCell,
  type PricePreview,
  priceBulkUpdate,
  RESTRICTION_KINDS,
  type RestrictionBulkUpdate,
  type RestrictionKind,
  type RestrictionValues,
  restrictionBulkUpdate,
} from '../contracts';
import { coalesceDates, expandDates } from '../domain/calendar';
import { adjustParams, ancestry, descendants, resolveDerivedParams } from '../domain/pricing';
import { RATES_EVENTS } from '../events';
import type { RatesPorts } from '../ports';
import { asNodes, loadPlansForProperty, toRatePlan } from './rate-plans';
import { actorKey, db, guardConfigWrite, json, parseInput, type Row, requireRead } from './shared';
import { derivationSteps } from './plan-chain';

export const MAX_BULK_CELLS = 20_000;

// ───────────────────────────── Prices ─────────────────────────────

export function rowParams(r: Row<'rates.prices'>): OccupancyPricing {
  return {
    baseOccupancy: r.base_occupancy,
    baseAmountMinor: r.base_amount_minor,
    singleAmountMinor: r.single_amount_minor,
    extraAdultMinor: r.extra_adult_minor,
    childAmountsMinor: (r.child_amounts_minor ?? {}) as Record<string, number>,
    occupancyAmountsMinor: (r.occupancy_amounts_minor ?? {}) as Record<string, number>,
  };
}

function cell(
  ratePlanId: string,
  unitTypeId: string,
  date: LocalDate,
  currency: string,
  p: OccupancyPricing,
  version: number | null,
  derivedFrom: string | null = null,
): PriceCell {
  return { ratePlanId, unitTypeId, date, currency, ...p, derived: derivedFrom !== null, derivedFrom, version };
}

const sameParams = (a: OccupancyPricing, b: OccupancyPricing) => JSON.stringify(a) === JSON.stringify(b);

function nextParams(before: OccupancyPricing | null, u: PriceBulkUpdate): OccupancyPricing | string {
  if (u.adjust) {
    if (!before) return 'There is no existing price to adjust on this night. Set an absolute price instead.';
    return adjustParams(before, u.adjust, u.rounding ?? { incrementMinor: 1, mode: 'half_up' });
  }
  const s = u.set ?? {};
  const baseAmountMinor = s.baseAmountMinor ?? before?.baseAmountMinor;
  const baseOccupancy = s.baseOccupancy ?? before?.baseOccupancy;
  if (baseAmountMinor === undefined || baseOccupancy === undefined) {
    return 'This night has no price yet: provide baseAmountMinor and baseOccupancy.';
  }
  return {
    baseOccupancy,
    baseAmountMinor,
    singleAmountMinor: s.singleAmountMinor !== undefined ? s.singleAmountMinor : (before?.singleAmountMinor ?? null),
    extraAdultMinor: s.extraAdultMinor !== undefined ? s.extraAdultMinor : (before?.extraAdultMinor ?? null),
    childAmountsMinor: { ...(before?.childAmountsMinor ?? {}), ...(s.childAmountsMinor ?? {}) },
    occupancyAmountsMinor: { ...(before?.occupancyAmountsMinor ?? {}), ...(s.occupancyAmountsMinor ?? {}) },
  };
}

async function loadBasePlanForPrices(tx: TxContext, u: PriceBulkUpdate) {
  const row = await db(tx).selectFrom('rates.rate_plans').selectAll().where('id', '=', u.ratePlanId).executeTakeFirst();
  if (!row || row.property_id !== u.propertyId) throw new NotFoundError('rate_plan', u.ratePlanId);
  const plan = toRatePlan(row);
  if (plan.derivation) {
    const parent = await db(tx).selectFrom('rates.rate_plans').select('code').where('id', '=', plan.derivation.parentRatePlanId).executeTakeFirst();
    throw new BusinessRuleError(
      'derived_plan_prices_computed',
      `${plan.code} is derived from ${parent?.code ?? 'its parent'}; its prices are computed and cannot be edited. Change the parent's prices or the derivation instead.`,
      { ratePlanId: plan.id, parentRatePlanId: plan.derivation.parentRatePlanId },
    );
  }
  if (plan.status === 'retired') throw new BusinessRuleError('rate_plan_retired', `${plan.code} is retired; its prices can no longer change.`);
  return plan;
}

async function assertUnitTypes(ports: RatesPorts, tx: TxContext, propertyId: string, ids: ReadonlyArray<string | null>) {
  if (!ports.listUnitTypes) return;
  const known = new Set((await ports.listUnitTypes(tx, propertyId)).map((u) => u.id));
  const unknown = ids.filter((id): id is string => id !== null && !known.has(id));
  if (unknown.length > 0) {
    throw new ValidationError('unit_type_not_found', 'Some unit types do not exist at this property.', { unknown });
  }
}

async function buildPricePreview(tx: TxContext, u: PriceBulkUpdate, currency: string, lock: boolean): Promise<PricePreview> {
  const dates = expandDates(u.ranges, u.weekdays);
  const unitTypeIds = [...new Set(u.unitTypeIds)];
  if (dates.length * unitTypeIds.length > MAX_BULK_CELLS) {
    throw new ValidationError('bulk_update_too_large', `A bulk update may change at most ${MAX_BULK_CELLS} cells. Split it by date range or unit type.`);
  }
  let q = db(tx)
    .selectFrom('rates.prices')
    .selectAll()
    .where('rate_plan_id', '=', u.ratePlanId)
    .where('unit_type_id', 'in', unitTypeIds)
    .where('stay_date', '>=', dates[0] as string)
    .where('stay_date', '<=', dates[dates.length - 1] as string);
  if (lock) q = q.forUpdate();
  const rows = await q.execute();
  const existing = new Map(rows.map((r) => [`${r.unit_type_id}|${r.stay_date}`, r]));
  const changes: PricePreview['changes'] = [];
  const rejected: PricePreview['rejected'] = [];
  for (const unitTypeId of unitTypeIds) {
    for (const date of dates) {
      const r = existing.get(`${unitTypeId}|${date}`);
      const before = r ? rowParams(r) : null;
      const after = nextParams(before, u);
      if (typeof after === 'string') {
        rejected.push({ unitTypeId, date, reason: after });
        continue;
      }
      if (before && sameParams(before, after)) continue;
      changes.push({
        unitTypeId,
        date,
        before: before ? cell(u.ratePlanId, unitTypeId, date, currency, before, r?.version ?? null) : null,
        after: cell(u.ratePlanId, unitTypeId, date, currency, after, r ? (r.version ?? 0) + 1 : 1),
      });
    }
  }
  const plans = await loadPlansForProperty(tx, u.propertyId);
  const derived = descendants(asNodes(plans), u.ratePlanId).filter((p) => p.status !== 'retired');
  const changedDates = changes.map((c) => c.date);
  return {
    changes,
    rejected,
    affectedDerivedPlans: derived.map((p) => ({ ratePlanId: p.id, code: p.code })),
    summary: {
      cells: changes.length,
      unitTypes: new Set(changes.map((c) => c.unitTypeId)).size,
      nights: new Set(changedDates).size,
      derivedPlans: derived.length,
      ranges: coalesceDates(changedDates),
    },
  };
}

export async function previewPriceUpdate(ports: RatesPorts, tx: TxContext, raw: unknown): Promise<PricePreview> {
  const u = parseInput(priceBulkUpdate, raw);
  requireRead(tx, u.propertyId);
  const plan = await loadBasePlanForPrices(tx, u);
  await assertUnitTypes(ports, tx, u.propertyId, u.unitTypeIds);
  return buildPricePreview(tx, u, plan.currency, false);
}

export async function applyPriceUpdate(
  ports: RatesPorts,
  tx: TxContext,
  raw: unknown,
): Promise<{ changeSetId: string | null; preview: PricePreview }> {
  const u = parseInput(priceBulkUpdate, raw);
  await guardConfigWrite(ports, tx, u.propertyId, 'rates.price.manage');
  const plan = await loadBasePlanForPrices(tx, u);
  await assertUnitTypes(ports, tx, u.propertyId, u.unitTypeIds);
  await sql`select pg_advisory_xact_lock(hashtext(${`rates.prices:${plan.id}`}))`.execute(tx.db);
  const preview = await buildPricePreview(tx, u, plan.currency, true);
  if (preview.rejected.length > 0) {
    throw new BusinessRuleError(
      'price_update_incomplete',
      `${preview.rejected.length} night(s) could not be priced (${preview.rejected[0]?.reason}). Nothing was changed; correct the update and try again.`,
      { rejected: preview.rejected.slice(0, 50) },
    );
  }
  if (preview.changes.length === 0) return { changeSetId: null, preview };
  const changeSetId = newId();
  await db(tx)
    .insertInto('rates.change_sets')
    .values({
      id: changeSetId,
      tenant_id: tx.tenantId,
      property_id: u.propertyId,
      kind: 'prices',
      rate_plan_id: plan.id,
      actor: json(tx.actor),
      actor_key: actorKey(tx),
      reason: u.reason ?? null,
      summary: json({ ...preview.summary, request: { ranges: u.ranges, weekdays: u.weekdays ?? null, set: u.set ?? null, adjust: u.adjust ?? null } }),
      created_at: tx.now,
    })
    .execute();
  for (let i = 0; i < preview.changes.length; i += 500) {
    const chunk = preview.changes.slice(i, i + 500);
    await db(tx)
      .insertInto('rates.prices')
      .values(
        chunk.map((c) => {
          const a = c.after as PriceCell;
          return {
            id: newId(),
            tenant_id: tx.tenantId,
            property_id: u.propertyId,
            rate_plan_id: plan.id,
            unit_type_id: c.unitTypeId,
            stay_date: c.date,
            currency: plan.currency,
            base_occupancy: a.baseOccupancy,
            base_amount_minor: a.baseAmountMinor,
            single_amount_minor: a.singleAmountMinor,
            extra_adult_minor: a.extraAdultMinor,
            child_amounts_minor: json(a.childAmountsMinor),
            occupancy_amounts_minor: json(a.occupancyAmountsMinor),
            change_set_id: changeSetId,
            updated_at: tx.now,
          };
        }),
      )
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'rate_plan_id', 'unit_type_id', 'stay_date']).doUpdateSet((eb) => ({
          base_occupancy: eb.ref('excluded.base_occupancy'),
          base_amount_minor: eb.ref('excluded.base_amount_minor'),
          single_amount_minor: eb.ref('excluded.single_amount_minor'),
          extra_adult_minor: eb.ref('excluded.extra_adult_minor'),
          child_amounts_minor: eb.ref('excluded.child_amounts_minor'),
          occupancy_amounts_minor: eb.ref('excluded.occupancy_amounts_minor'),
          change_set_id: eb.ref('excluded.change_set_id'),
          updated_at: eb.ref('excluded.updated_at'),
          version: sql`rates.prices.version + 1`,
        })),
      )
      .execute();
    await db(tx)
      .insertInto('rates.price_history')
      .values(
        chunk.map((c) => ({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: u.propertyId,
          change_set_id: changeSetId,
          rate_plan_id: plan.id,
          unit_type_id: c.unitTypeId,
          stay_date: c.date,
          before: c.before ? json(c.before) : null,
          after: json(c.after),
          changed_at: tx.now,
          changed_by: actorKey(tx),
        })),
      )
      .execute();
  }
  await tx.audit({
    action: 'rates.price.bulkUpdate',
    target: { type: 'rate_plan', id: plan.id },
    propertyId: u.propertyId,
    reason: u.reason ?? null,
    after: { changeSetId, summary: preview.summary, set: u.set ?? null, adjust: u.adjust ?? null },
  });
  await tx.emit({
    type: RATES_EVENTS.pricesChanged,
    propertyId: u.propertyId,
    aggregate: { type: 'rate_plan', id: plan.id },
    payload: {
      propertyId: u.propertyId,
      changeSetId,
      ratePlanIds: [plan.id, ...preview.affectedDerivedPlans.map((p) => p.ratePlanId)],
      unitTypeIds: [...new Set(preview.changes.map((c) => c.unitTypeId))],
      ranges: preview.summary.ranges,
    },
  });
  return { changeSetId, preview };
}

/** Price grid for any plan; derived plans are computed from their base plan and flagged non-editable. */
export async function getPriceCalendar(
  tx: TxContext,
  input: { ratePlanId: string; from: LocalDate; to: LocalDate; unitTypeId?: string | undefined },
): Promise<{ ratePlanId: string; cells: PriceCell[] }> {
  const row = await db(tx).selectFrom('rates.rate_plans').selectAll().where('id', '=', input.ratePlanId).executeTakeFirst();
  if (!row) throw new NotFoundError('rate_plan', input.ratePlanId);
  requireRead(tx, row.property_id);
  if (input.to <= input.from) throw new ValidationError('invalid_date_range', 'The end date must be after the start date.');
  const plans = await loadPlansForProperty(tx, row.property_id);
  const chain = ancestry(asNodes(plans), input.ratePlanId);
  const root = chain[0] as (typeof chain)[number];
  const steps = derivationSteps(chain);
  let q = db(tx)
    .selectFrom('rates.prices')
    .selectAll()
    .where('rate_plan_id', '=', root.id)
    .where('stay_date', '>=', input.from)
    .where('stay_date', '<', input.to)
    .orderBy('unit_type_id')
    .orderBy('stay_date');
  if (input.unitTypeId) q = q.where('unit_type_id', '=', input.unitTypeId);
  const rows = await q.execute();
  const derivedFrom = chain.length > 1 ? (chain[chain.length - 2]?.id ?? null) : null;
  return {
    ratePlanId: input.ratePlanId,
    cells: rows.map((r) =>
      cell(
        input.ratePlanId,
        r.unit_type_id,
        r.stay_date,
        r.currency,
        resolveDerivedParams(rowParams(r), steps, r.unit_type_id),
        derivedFrom ? null : r.version,
        derivedFrom,
      ),
    ),
  };
}

export async function getPriceHistory(
  tx: TxContext,
  input: { ratePlanId: string; unitTypeId?: string | undefined; from?: LocalDate | undefined; to?: LocalDate | undefined },
) {
  const plan = await db(tx).selectFrom('rates.rate_plans').select('property_id').where('id', '=', input.ratePlanId).executeTakeFirst();
  if (!plan) throw new NotFoundError('rate_plan', input.ratePlanId);
  requireRead(tx, plan.property_id);
  let q = db(tx)
    .selectFrom('rates.price_history as h')
    .innerJoin('rates.change_sets as c', 'c.id', 'h.change_set_id')
    .select(['h.id', 'h.change_set_id', 'h.rate_plan_id', 'h.unit_type_id', 'h.stay_date', 'h.before', 'h.after', 'h.changed_at', 'h.changed_by', 'c.reason'])
    .where('h.rate_plan_id', '=', input.ratePlanId)
    .orderBy('h.changed_at')
    .orderBy('h.stay_date')
    .limit(2000);
  if (input.unitTypeId) q = q.where('h.unit_type_id', '=', input.unitTypeId);
  if (input.from) q = q.where('h.stay_date', '>=', input.from);
  if (input.to) q = q.where('h.stay_date', '<', input.to);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    changeSetId: r.change_set_id,
    ratePlanId: r.rate_plan_id,
    unitTypeId: r.unit_type_id,
    date: r.stay_date,
    before: r.before,
    after: r.after,
    changedAt: r.changed_at.toISOString(),
    changedBy: r.changed_by,
    reason: r.reason,
  }));
}

// ───────────────────────────── Restrictions ─────────────────────────────

const COLUMN: Record<RestrictionKind, keyof Row<'rates.restrictions'>> = {
  closed: 'closed',
  closedToArrival: 'closed_to_arrival',
  closedToDeparture: 'closed_to_departure',
  minLos: 'min_los',
  minLosThrough: 'min_los_through',
  maxLos: 'max_los',
  minAdvanceDays: 'min_advance_days',
  maxAdvanceDays: 'max_advance_days',
  salesLimit: 'sales_limit',
};

export function restrictionValues(r: Row<'rates.restrictions'>): RestrictionValues {
  const out: Record<string, unknown> = {};
  for (const k of RESTRICTION_KINDS) {
    const v = r[COLUMN[k]];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as RestrictionValues;
}

function mergeRestriction(before: RestrictionValues, set: RestrictionValues): RestrictionValues {
  const out: Record<string, unknown> = { ...before };
  for (const k of RESTRICTION_KINDS) {
    if (!(k in set)) continue;
    const v = set[k];
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as RestrictionValues;
}

async function restrictionPreviewFor(tx: TxContext, u: RestrictionBulkUpdate, lock: boolean) {
  const dates = expandDates(u.ranges, u.weekdays);
  const unitTypeIds = [...new Set(u.unitTypeIds)];
  if (dates.length * unitTypeIds.length > MAX_BULK_CELLS) {
    throw new ValidationError('bulk_update_too_large', `A bulk update may change at most ${MAX_BULK_CELLS} cells. Split it.`);
  }
  let q = db(tx)
    .selectFrom('rates.restrictions')
    .selectAll()
    .where('property_id', '=', u.propertyId)
    .where('stay_date', '>=', dates[0] as string)
    .where('stay_date', '<=', dates[dates.length - 1] as string);
  q = u.ratePlanId ? q.where('rate_plan_id', '=', u.ratePlanId) : q.where('rate_plan_id', 'is', null);
  if (lock) q = q.forUpdate();
  const rows = await q.execute();
  const existing = new Map(rows.map((r) => [`${r.unit_type_id ?? '*'}|${r.stay_date}`, r]));
  const changes: Array<{ ratePlanId: string | null; unitTypeId: string | null; date: LocalDate; before: RestrictionValues | null; after: RestrictionValues; version: number }> = [];
  for (const unitTypeId of unitTypeIds) {
    for (const date of dates) {
      const r = existing.get(`${unitTypeId ?? '*'}|${date}`);
      const before = r ? restrictionValues(r) : null;
      const after = mergeRestriction(before ?? {}, u.set);
      if (JSON.stringify(before ?? {}) === JSON.stringify(after)) continue;
      changes.push({ ratePlanId: u.ratePlanId, unitTypeId, date, before, after, version: r ? r.version + 1 : 1 });
    }
  }
  const changedKinds = RESTRICTION_KINDS.filter((k) => k in u.set && k !== 'salesLimit');
  let affected: Array<{ ratePlanId: string; code: string }> = [];
  if (u.ratePlanId) {
    const plans = asNodes(await loadPlansForProperty(tx, u.propertyId));
    const byId = new Map(plans.map((p) => [p.id, p]));
    affected = descendants(plans, u.ratePlanId)
      .filter((d) => {
        // d inherits a changed kind only if every link up to the edited plan inherits it.
        return changedKinds.some((k) => {
          let cur = byId.get(d.id);
          while (cur && cur.id !== u.ratePlanId) {
            if (!cur.inherit.restrictions.includes(k)) return false;
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          }
          return true;
        });
      })
      .filter((d) => d.status !== 'retired')
      .map((d) => ({ ratePlanId: d.id, code: d.code }));
  }
  return {
    changes,
    affectedDerivedPlans: affected,
    summary: { cells: changes.length, ranges: coalesceDates(changes.map((c) => c.date)) },
  };
}

async function validateRestrictionScope(ports: RatesPorts, tx: TxContext, u: RestrictionBulkUpdate) {
  if (u.ratePlanId) {
    const plan = await db(tx).selectFrom('rates.rate_plans').select(['property_id']).where('id', '=', u.ratePlanId).executeTakeFirst();
    if (!plan || plan.property_id !== u.propertyId) throw new NotFoundError('rate_plan', u.ratePlanId);
  }
  await assertUnitTypes(ports, tx, u.propertyId, u.unitTypeIds);
  const v = u.set;
  if (v.minLos && v.maxLos && v.minLos > v.maxLos)
    throw new ValidationError('invalid_restriction', 'Minimum length of stay cannot exceed the maximum.');
  if (v.minAdvanceDays && v.maxAdvanceDays && v.minAdvanceDays > v.maxAdvanceDays)
    throw new ValidationError('invalid_restriction', 'Minimum advance cannot exceed the maximum advance.');
}

export async function previewRestrictionUpdate(ports: RatesPorts, tx: TxContext, raw: unknown) {
  const u = parseInput(restrictionBulkUpdate, raw);
  requireRead(tx, u.propertyId);
  await validateRestrictionScope(ports, tx, u);
  const p = await restrictionPreviewFor(tx, u, false);
  return { ...p, changes: p.changes.map(({ version: _v, ...c }) => c) };
}

export async function applyRestrictionUpdate(ports: RatesPorts, tx: TxContext, raw: unknown) {
  const u = parseInput(restrictionBulkUpdate, raw);
  await guardConfigWrite(ports, tx, u.propertyId, 'rates.restriction.manage');
  await validateRestrictionScope(ports, tx, u);
  await sql`select pg_advisory_xact_lock(hashtext(${`rates.restrictions:${u.propertyId}`}))`.execute(tx.db);
  const preview = await restrictionPreviewFor(tx, u, true);
  const result = { ...preview, changes: preview.changes.map(({ version: _v, ...c }) => c) };
  if (preview.changes.length === 0) return { changeSetId: null, preview: result };
  const changeSetId = newId();
  await db(tx)
    .insertInto('rates.change_sets')
    .values({
      id: changeSetId,
      tenant_id: tx.tenantId,
      property_id: u.propertyId,
      kind: 'restrictions',
      rate_plan_id: u.ratePlanId,
      actor: json(tx.actor),
      actor_key: actorKey(tx),
      reason: u.reason ?? null,
      summary: json({ ...preview.summary, request: { ranges: u.ranges, weekdays: u.weekdays ?? null, set: u.set } }),
      created_at: tx.now,
    })
    .execute();
  for (let i = 0; i < preview.changes.length; i += 500) {
    const chunk = preview.changes.slice(i, i + 500);
    await db(tx)
      .insertInto('rates.restrictions')
      .values(
        chunk.map((c) => ({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: u.propertyId,
          rate_plan_id: c.ratePlanId,
          unit_type_id: c.unitTypeId,
          stay_date: c.date,
          closed: c.after.closed ?? null,
          closed_to_arrival: c.after.closedToArrival ?? null,
          closed_to_departure: c.after.closedToDeparture ?? null,
          min_los: c.after.minLos ?? null,
          min_los_through: c.after.minLosThrough ?? null,
          max_los: c.after.maxLos ?? null,
          min_advance_days: c.after.minAdvanceDays ?? null,
          max_advance_days: c.after.maxAdvanceDays ?? null,
          sales_limit: c.after.salesLimit ?? null,
          change_set_id: changeSetId,
          updated_at: tx.now,
        })),
      )
      .onConflict((oc) =>
        oc.constraint('restrictions_scope_unique').doUpdateSet((eb) => ({
          closed: eb.ref('excluded.closed'),
          closed_to_arrival: eb.ref('excluded.closed_to_arrival'),
          closed_to_departure: eb.ref('excluded.closed_to_departure'),
          min_los: eb.ref('excluded.min_los'),
          min_los_through: eb.ref('excluded.min_los_through'),
          max_los: eb.ref('excluded.max_los'),
          min_advance_days: eb.ref('excluded.min_advance_days'),
          max_advance_days: eb.ref('excluded.max_advance_days'),
          sales_limit: eb.ref('excluded.sales_limit'),
          change_set_id: eb.ref('excluded.change_set_id'),
          updated_at: eb.ref('excluded.updated_at'),
          version: sql`rates.restrictions.version + 1`,
        })),
      )
      .execute();
    await db(tx)
      .insertInto('rates.restriction_history')
      .values(
        chunk.map((c) => ({
          id: newId(),
          tenant_id: tx.tenantId,
          property_id: u.propertyId,
          change_set_id: changeSetId,
          rate_plan_id: c.ratePlanId,
          unit_type_id: c.unitTypeId,
          stay_date: c.date,
          before: c.before ? json(c.before) : null,
          after: json(c.after),
          changed_at: tx.now,
          changed_by: actorKey(tx),
        })),
      )
      .execute();
  }
  await tx.audit({
    action: 'rates.restriction.bulkUpdate',
    target: { type: u.ratePlanId ? 'rate_plan' : 'property', id: u.ratePlanId ?? u.propertyId },
    propertyId: u.propertyId,
    reason: u.reason ?? null,
    after: { changeSetId, summary: preview.summary, set: u.set },
  });
  const ranges: DateRange[] = preview.summary.ranges;
  await tx.emit({
    type: RATES_EVENTS.restrictionsChanged,
    propertyId: u.propertyId,
    aggregate: { type: u.ratePlanId ? 'rate_plan' : 'property', id: u.ratePlanId ?? u.propertyId },
    payload: {
      propertyId: u.propertyId,
      changeSetId,
      ratePlanIds: [u.ratePlanId, ...preview.affectedDerivedPlans.map((p) => p.ratePlanId)],
      unitTypeIds: [...new Set(preview.changes.map((c) => c.unitTypeId))],
      ranges,
    },
  });
  return { changeSetId, preview: result };
}

export async function getRestrictions(
  tx: TxContext,
  input: { propertyId: string; from: LocalDate; to: LocalDate; ratePlanId?: string | undefined },
) {
  requireRead(tx, input.propertyId);
  let q = db(tx)
    .selectFrom('rates.restrictions')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('stay_date', '>=', input.from)
    .where('stay_date', '<', input.to)
    .orderBy('stay_date');
  if (input.ratePlanId) {
    const rid = input.ratePlanId;
    q = q.where((eb) => eb.or([eb('rate_plan_id', '=', rid), eb('rate_plan_id', 'is', null)]));
  }
  const rows = await q.execute();
  return rows.map((r) => ({
    ratePlanId: r.rate_plan_id,
    unitTypeId: r.unit_type_id,
    date: r.stay_date,
    values: restrictionValues(r),
    version: r.version,
  }));
}
