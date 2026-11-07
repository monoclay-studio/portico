import { explainVersionMiss, type Selectable, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  canonicalJson,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type { z } from 'zod';
import type {
  BillingRule,
  BillingRuleInput,
  billingRuleUpdate,
  PreviewInput,
  PreviewResult,
} from '../contracts';
import {
  assertRuleSetConsistent,
  capPeriodKey,
  findConflicts,
  type RoutingRule,
  routeBatch,
  validateSelector,
} from '../domain/routing';
import { CHARGE_GROUPS, type ChargeGroup, type RuleCap, type RuleSelector } from '../domain/types';
import type { BillingRulesTable } from '../tables';
import { defaultFolio } from './folios';
import { capUsage, loadRules } from './postings';
import { chargeGroupMap } from './setup';
import { type Deps, db, displayName, loadFolio } from './support';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Plain-language description of a rule ("who pays for what" panel). */
export function describeRule(
  r: { label: string; selector: RuleSelector; cap: RuleCap | null },
  payer: string,
): string {
  const what =
    (r.selector.chargeCodes?.length ?? 0) + (r.selector.chargeGroups?.length ?? 0) === 0
      ? 'all charges'
      : [
          ...(r.selector.chargeGroups ?? []).map((g) => `${g} charges`),
          ...(r.selector.chargeCodes ?? []),
        ].join(', ');
  const when = [
    r.selector.serviceDateFrom ? `from ${r.selector.serviceDateFrom}` : '',
    r.selector.serviceDateTo ? `until before ${r.selector.serviceDateTo}` : '',
    r.selector.daysOfWeek?.length ? `on ${r.selector.daysOfWeek.map((d) => DAY_NAMES[d]).join('/')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const limit = !r.cap
    ? ''
    : r.cap.kind === 'percent'
      ? `, ${r.cap.percent}% of each charge`
      : `, up to ${r.cap.amountMinor} ${r.cap.currency} (minor units) ${r.cap.kind === 'per_night' ? 'per night' : 'per stay'}`;
  return `${payer} pays ${what}${when ? ` ${when}` : ''}${limit}; the rest goes to the default folio.`;
}

async function toRule(tx: TxContext, r: Selectable<BillingRulesTable>): Promise<BillingRule> {
  const dest = await loadFolio(tx, r.destination_folio_id);
  const selector = r.selector as RuleSelector;
  const cap = (r.cap ?? null) as RuleCap | null;
  return {
    id: r.id,
    propertyId: r.property_id,
    owner: { type: r.owner_type as 'stay' | 'booking' | 'group', id: r.owner_id },
    destinationFolioId: r.destination_folio_id,
    label: r.label,
    selector: selector as BillingRule['selector'],
    cap,
    source: r.source,
    active: r.active,
    description: describeRule({ label: r.label, selector, cap }, displayName(dest)),
    version: r.version,
  };
}

async function validateRule(
  tx: TxContext,
  input: {
    propertyId: string;
    owner: { type: string; id: string };
    destinationFolioId: string;
    selector: RuleSelector;
    cap: RuleCap | null;
  },
): Promise<Map<string, ChargeGroup>> {
  validateSelector(input.selector);
  const groups = await chargeGroupMap(tx, input.propertyId);
  for (const c of input.selector.chargeCodes ?? []) {
    if (!groups.has(c)) {
      throw new ValidationError('unknown_charge_code', `Charge code "${c}" is not set up at this property.`, {
        chargeCode: c,
      });
    }
  }
  const base = await defaultFolio(tx, input.owner);
  const dest = await loadFolio(tx, input.destinationFolioId);
  if (dest.property_id !== input.propertyId || base.property_id !== input.propertyId) {
    throw new ValidationError(
      'folio_property_mismatch',
      'The destination folio must belong to the same property.',
    );
  }
  if (dest.legal_entity_id !== base.legal_entity_id) {
    throw new BusinessRuleError(
      'intercompany_rule',
      'The destination folio belongs to another legal entity.',
    );
  }
  if (dest.currency !== base.currency) {
    throw new BusinessRuleError(
      'folio_currency_mismatch',
      `The destination folio must use ${base.currency}, like the default folio.`,
    );
  }
  if (dest.status === 'voided' || dest.status === 'closed') {
    throw new BusinessRuleError(
      'folio_not_open',
      'The destination folio is closed. Choose an open folio of the payer.',
    );
  }
  if (input.cap && input.cap.kind !== 'percent' && input.cap.currency !== base.currency) {
    throw new ValidationError(
      'cap_currency_mismatch',
      `Limits must be in the folio currency (${base.currency}).`,
    );
  }
  if (input.cap?.kind === 'percent') {
    const pct = Number(input.cap.percent);
    if (!(pct > 0 && pct <= 100))
      throw new ValidationError('invalid_percent', 'A percentage limit must be above 0 and at most 100.');
  }
  return groups;
}

function conflictError(label: string, conflicts: ReturnType<typeof findConflicts>): BusinessRuleError {
  const first = conflicts[0] as (typeof conflicts)[number];
  return new BusinessRuleError(
    'billing_rule_conflict',
    first.verdict === 'identical'
      ? `"${label}" selects exactly the same charges as the existing rule "${first.label}", so it would be unclear who pays. Edit "${first.label}" instead, or narrow this rule to specific charge codes or dates.`
      : `"${label}" partly overlaps the existing rule "${first.label}": some charges would match both, but neither rule is fully inside the other. Narrow the dates or charge codes so that one rule lies entirely within the other (the more specific one then wins) or so that they do not overlap.`,
    { conflictsWith: conflicts, suggestions: ['narrow_dates', 'narrow_charge_codes', 'edit_existing_rule'] },
  );
}

async function lockOwner(tx: TxContext, owner: { type: string; id: string }): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`finance.billing-rules:${owner.type}:${owner.id}`}))`.execute(
    tx.db,
  );
}

/** Create a billing rule. Ties with existing rules are configuration errors (no ranking). */
export async function createBillingRule(
  tx: TxContext,
  deps: Deps,
  input: BillingRuleInput,
): Promise<BillingRule> {
  requirePermission(tx, 'finance.billingRule.manage', { propertyId: input.propertyId });
  await deps.ports.platform.assertWritable(tx, input.propertyId, 'charges');
  await lockOwner(tx, input.owner);
  const cap = (input.cap ?? null) as RuleCap | null;
  const groups = await validateRule(tx, { ...input, cap });
  const existing = await loadRules(tx, input.owner);
  const id = newId(tx.now.getTime());
  const conflicts = findConflicts({ id, selector: input.selector }, existing, (c) => groups.get(c));
  if (conflicts.length) throw conflictError(input.label, conflicts);
  const row = await db(tx)
    .insertInto('finance.billing_rules')
    .values({
      id,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      owner_type: input.owner.type,
      owner_id: input.owner.id,
      destination_folio_id: input.destinationFolioId,
      label: input.label,
      selector: JSON.stringify(input.selector),
      cap: cap ? JSON.stringify(cap) : null,
      source: input.source ?? 'manual',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const rule = await toRule(tx, row);
  await tx.audit({
    action: 'finance.billingRule.create',
    target: { type: 'billing_rule', id },
    propertyId: input.propertyId,
    after: rule,
  });
  await tx.emit({
    type: 'finance.billingRule.changed',
    propertyId: input.propertyId,
    aggregate: { type: 'billing_rule', id },
    payload: { ruleId: id, owner: input.owner, change: 'created' },
  });
  return rule;
}

export async function updateBillingRule(
  tx: TxContext,
  deps: Deps,
  id: string,
  expectedVersion: number,
  patch: z.infer<typeof billingRuleUpdate>,
): Promise<BillingRule> {
  const current = await db(tx)
    .selectFrom('finance.billing_rules')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!current) throw new NotFoundError('billing_rule', id);
  requirePermission(tx, 'finance.billingRule.manage', { propertyId: current.property_id });
  await deps.ports.platform.assertWritable(tx, current.property_id, 'charges');
  if (!current.active)
    throw new BusinessRuleError(
      'billing_rule_inactive',
      'This rule was deactivated. Create a new rule instead.',
    );
  const owner = { type: current.owner_type, id: current.owner_id };
  await lockOwner(tx, owner);
  const next = {
    destinationFolioId: patch.destinationFolioId ?? current.destination_folio_id,
    label: patch.label ?? current.label,
    selector: (patch.selector ?? current.selector) as RuleSelector,
    cap: (patch.cap === undefined ? current.cap : patch.cap) as RuleCap | null,
  };
  const groups = await validateRule(tx, { propertyId: current.property_id, owner, ...next });
  const conflicts = findConflicts({ id, selector: next.selector }, await loadRules(tx, owner), (c) =>
    groups.get(c),
  );
  if (conflicts.length) throw conflictError(next.label, conflicts);
  const row = await db(tx)
    .updateTable('finance.billing_rules')
    .set({
      destination_folio_id: next.destinationFolioId,
      label: next.label,
      selector: JSON.stringify(next.selector),
      cap: next.cap ? JSON.stringify(next.cap) : null,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('billing_rule', id, expectedVersion, async () => current.version);
  const before = await toRule(tx, current);
  const after = await toRule(tx, row);
  await tx.audit({
    action: 'finance.billingRule.update',
    target: { type: 'billing_rule', id },
    propertyId: current.property_id,
    before,
    after,
  });
  await tx.emit({
    type: 'finance.billingRule.changed',
    propertyId: current.property_id,
    aggregate: { type: 'billing_rule', id },
    payload: { ruleId: id, owner, change: 'updated' },
  });
  return after;
}

export async function deactivateBillingRule(
  tx: TxContext,
  deps: Deps,
  id: string,
  expectedVersion: number,
): Promise<BillingRule> {
  const current = await db(tx)
    .selectFrom('finance.billing_rules')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!current) throw new NotFoundError('billing_rule', id);
  requirePermission(tx, 'finance.billingRule.manage', { propertyId: current.property_id });
  await deps.ports.platform.assertWritable(tx, current.property_id, 'charges');
  const row = await db(tx)
    .updateTable('finance.billing_rules')
    .set({ active: false, version: sql`version + 1` })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('billing_rule', id, expectedVersion, async () => current.version);
  await tx.audit({
    action: 'finance.billingRule.deactivate',
    target: { type: 'billing_rule', id },
    propertyId: current.property_id,
  });
  await tx.emit({
    type: 'finance.billingRule.changed',
    propertyId: current.property_id,
    aggregate: { type: 'billing_rule', id },
    payload: { ruleId: id, owner: { type: current.owner_type, id: current.owner_id }, change: 'deactivated' },
  });
  return toRule(tx, row);
}

export async function listBillingRules(
  tx: TxContext,
  owner: { type: string; id: string },
): Promise<BillingRule[]> {
  const rows = await db(tx)
    .selectFrom('finance.billing_rules')
    .selectAll()
    .where('owner_type', '=', owner.type)
    .where('owner_id', '=', owner.id)
    .where('active', '=', true)
    .orderBy('created_at')
    .execute();
  const first = rows[0];
  if (first) requirePermission(tx, 'finance.folio.read', { propertyId: first.property_id });
  return Promise.all(rows.map((r) => toRule(tx, r)));
}

/**
 * "Who pays for what" preview: route hypothetical charges through the saved (or a proposed) rule set, using
 * caps already consumed, without posting anything. Amounts are gross (incl. taxes).
 */
export async function previewRouting(tx: TxContext, input: PreviewInput): Promise<PreviewResult> {
  requirePermission(tx, 'finance.folio.read', { propertyId: input.propertyId });
  const base = await defaultFolio(tx, input.owner);
  const groups = await chargeGroupMap(tx, input.propertyId);
  const groupOf = (c: string) => groups.get(c);
  let rules: RoutingRule[];
  if (input.proposedRules) {
    rules = input.proposedRules.map((r) => ({
      id: r.id ?? newId(),
      label: r.label,
      destinationFolioId: r.destinationFolioId,
      selector: r.selector,
      cap: (r.cap ?? null) as RuleCap | null,
    }));
    for (const r of rules) {
      await validateRule(tx, {
        propertyId: input.propertyId,
        owner: input.owner,
        destinationFolioId: r.destinationFolioId,
        selector: r.selector,
        cap: r.cap,
      });
    }
    assertRuleSetConsistent(rules, groupOf);
  } else {
    rules = await loadRules(tx, input.owner);
  }
  const used = new Map<string, number>();
  for (const r of rules) {
    if (!r.cap) continue;
    for (const c of input.charges) {
      const key = capPeriodKey(r.cap, c.serviceDate);
      if (key && !used.has(`${r.id}|${key}`)) used.set(`${r.id}|${key}`, await capUsage(tx, r.id, key));
    }
  }
  const charges = input.charges.map((c) => {
    const group = groups.get(c.chargeCode);
    if (!group)
      throw new ValidationError(
        'unknown_charge_code',
        `Charge code "${c.chargeCode}" is not set up at this property.`,
      );
    if (c.amount.currency !== base.currency) {
      throw new ValidationError(
        'preview_currency_mismatch',
        `Preview amounts must be in the folio currency (${base.currency}).`,
      );
    }
    return {
      chargeCode: c.chargeCode,
      chargeGroup: group,
      serviceDate: c.serviceDate,
      grossMinor: c.amount.amountMinor,
      ...(c.ref ? { ref: c.ref } : {}),
    };
  });
  const routed = routeBatch(rules, charges, base.id, groupOf, (id, key) => used.get(`${id}|${key}`) ?? 0);
  const names = new Map<string, string>();
  for (const id of new Set(routed.flatMap((r) => r.allocations.map((a) => a.folioId)))) {
    names.set(id, displayName(await loadFolio(tx, id)));
  }
  const totals = new Map<string, number>();
  const lines = routed.map(({ charge, allocations }) => ({
    ref: charge.ref ?? null,
    chargeCode: charge.chargeCode,
    serviceDate: charge.serviceDate,
    amount: { amountMinor: charge.grossMinor, currency: base.currency },
    allocations: allocations.map((a) => {
      totals.set(a.folioId, (totals.get(a.folioId) ?? 0) + a.grossMinor);
      return {
        folioId: a.folioId,
        folioName: names.get(a.folioId) ?? a.folioId,
        ruleId: a.ruleId,
        amount: { amountMinor: a.grossMinor, currency: base.currency },
        explanation: a.explanation,
      };
    }),
  }));
  return {
    lines,
    totalsByFolio: [...totals.entries()].map(([folioId, total]) => ({
      folioId,
      folioName: names.get(folioId) ?? folioId,
      total: { amountMinor: total, currency: base.currency },
    })),
  };
}

export interface RuleSetInput {
  destinationFolioId: string;
  label: string;
  selector: RuleSelector;
  cap: RuleCap | null;
  source: 'manual' | 'company_default' | 'rate_plan' | 'group' | 'package';
}

export interface RuleSetChanges {
  kept: Array<{ ruleId: string; label: string }>;
  superseded: Array<{ fromRuleId: string; toRuleId: string; label: string; change: string }>;
  added: Array<{ ruleId: string; label: string }>;
  deactivated: Array<{ ruleId: string; label: string; source: string }>;
  untouched: Array<{ ruleId: string; label: string; source: string }>;
}

const canonicalSelector = (sel: RuleSelector) =>
  canonicalJson({
    chargeCodes: [...(sel.chargeCodes ?? [])].sort(),
    chargeGroups: [...(sel.chargeGroups ?? [])].sort(),
    serviceDateFrom: sel.serviceDateFrom ?? null,
    serviceDateTo: sel.serviceDateTo ?? null,
    daysOfWeek: [...(sel.daysOfWeek ?? [])].sort(),
  });

/**
 * Re-apply billing instructions for an owner as a MERGE (ADR-0016 §2), scoped to the sources given (e.g. the
 * company defaults): an identical rule is kept (same id, limits already used stay used); a rule whose limit or
 * label changed is replaced by a successor that inherits the limit usage; rules of those sources that are no
 * longer given are deactivated; rules of other sources (staff-created manual rules) are untouched. The whole
 * resulting set is validated (no ties). `preview: true` returns the changes without saving.
 */
export async function mergeBillingRules(
  tx: TxContext,
  deps: Deps,
  input: {
    owner: { type: 'stay' | 'booking' | 'group'; id: string };
    rules: RuleSetInput[];
    preview?: boolean;
  },
): Promise<{ ruleIds: string[]; changes: RuleSetChanges; preview: boolean }> {
  const base = await defaultFolio(tx, input.owner);
  requirePermission(tx, input.preview ? 'finance.folio.read' : 'finance.billingRule.manage', {
    propertyId: base.property_id,
  });
  if (!input.preview) {
    await deps.ports.platform.assertWritable(tx, base.property_id, 'charges');
    await lockOwner(tx, input.owner);
  }
  const groups = await chargeGroupMap(tx, base.property_id);
  for (const r of input.rules) {
    for (const g of r.selector.chargeGroups ?? []) {
      if (!CHARGE_GROUPS.includes(g)) {
        throw new ValidationError(
          'unknown_charge_group',
          `"${g}" is not a charge group (${CHARGE_GROUPS.join(', ')}).`,
        );
      }
    }
    await validateRule(tx, {
      propertyId: base.property_id,
      owner: input.owner,
      destinationFolioId: r.destinationFolioId,
      selector: r.selector,
      cap: r.cap,
    });
  }
  const scope = new Set(input.rules.map((r) => r.source));
  const existing = await db(tx)
    .selectFrom('finance.billing_rules')
    .selectAll()
    .where('owner_type', '=', input.owner.type)
    .where('owner_id', '=', input.owner.id)
    .where('active', '=', true)
    .execute();
  const keyOf = (r: { source: string; destinationFolioId: string; selector: RuleSelector }) =>
    `${r.source}|${r.destinationFolioId}|${canonicalSelector(r.selector)}`;
  const byKey = new Map(
    existing
      .filter((e) => scope.has(e.source as RuleSetInput['source']))
      .map((e) => [
        keyOf({
          source: e.source,
          destinationFolioId: e.destination_folio_id,
          selector: e.selector as RuleSelector,
        }),
        e,
      ]),
  );
  const changes: RuleSetChanges = { kept: [], superseded: [], added: [], deactivated: [], untouched: [] };
  const finalSet: RoutingRule[] = [];
  const toInsert: Array<RuleSetInput & { id: string; supersedes: string | null }> = [];
  const matched = new Set<string>();
  for (const r of input.rules) {
    const hit = byKey.get(keyOf(r));
    if (hit && !matched.has(hit.id)) {
      matched.add(hit.id);
      const sameCap = canonicalJson(hit.cap ?? null) === canonicalJson(r.cap ?? null);
      if (sameCap && hit.label === r.label) {
        changes.kept.push({ ruleId: hit.id, label: hit.label });
        finalSet.push({
          id: hit.id,
          label: hit.label,
          destinationFolioId: hit.destination_folio_id,
          selector: hit.selector as RuleSelector,
          cap: (hit.cap ?? null) as RuleCap | null,
        });
        continue;
      }
      const id = newId(tx.now.getTime());
      changes.superseded.push({
        fromRuleId: hit.id,
        toRuleId: id,
        label: r.label,
        change: sameCap ? 'label' : 'limit',
      });
      toInsert.push({ ...r, id, supersedes: hit.id });
      finalSet.push({
        id,
        label: r.label,
        destinationFolioId: r.destinationFolioId,
        selector: r.selector,
        cap: r.cap,
      });
      continue;
    }
    const id = newId(tx.now.getTime());
    changes.added.push({ ruleId: id, label: r.label });
    toInsert.push({ ...r, id, supersedes: null });
    finalSet.push({
      id,
      label: r.label,
      destinationFolioId: r.destinationFolioId,
      selector: r.selector,
      cap: r.cap,
    });
  }
  for (const e of existing) {
    if (matched.has(e.id)) continue;
    if (scope.has(e.source as RuleSetInput['source'])) {
      changes.deactivated.push({ ruleId: e.id, label: e.label, source: e.source });
    } else {
      changes.untouched.push({ ruleId: e.id, label: e.label, source: e.source });
      finalSet.push({
        id: e.id,
        label: e.label,
        destinationFolioId: e.destination_folio_id,
        selector: e.selector as RuleSelector,
        cap: (e.cap ?? null) as RuleCap | null,
      });
    }
  }
  assertRuleSetConsistent(finalSet, (c) => groups.get(c));
  if (input.preview) return { ruleIds: finalSet.map((r) => r.id), changes, preview: true };
  const retire = [
    ...changes.deactivated.map((d) => d.ruleId),
    ...changes.superseded.map((d) => d.fromRuleId),
  ];
  if (retire.length) {
    await db(tx)
      .updateTable('finance.billing_rules')
      .set({ active: false, version: sql`version + 1` })
      .where('id', 'in', retire)
      .execute();
  }
  for (const r of toInsert) {
    await db(tx)
      .insertInto('finance.billing_rules')
      .values({
        id: r.id,
        tenant_id: tx.tenantId,
        property_id: base.property_id,
        owner_type: input.owner.type,
        owner_id: input.owner.id,
        destination_folio_id: r.destinationFolioId,
        label: r.label,
        selector: JSON.stringify(r.selector),
        cap: r.cap ? JSON.stringify(r.cap) : null,
        source: r.source,
        supersedes_rule_id: r.supersedes,
      })
      .execute();
  }
  await tx.audit({
    action: 'finance.billingRule.mergeSet',
    target: { type: 'folio', id: base.id },
    propertyId: base.property_id,
    after: { owner: input.owner, changes },
  });
  await tx.emit({
    type: 'finance.billingRule.changed',
    propertyId: base.property_id,
    aggregate: { type: input.owner.type, id: input.owner.id },
    payload: { owner: input.owner, change: 'merged', changes },
  });
  return { ruleIds: finalSet.map((r) => r.id), changes, preview: false };
}
