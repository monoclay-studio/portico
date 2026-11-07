/**
 * Universal record contract for rates' primary records (docs/product/experience-architecture.md §1): status per
 * family, server-computed next actions (permissions + business rules, with plain-language reasons), issues and
 * links. The UI, API, integrations and AI all read the same truth.
 */
import type { TxContext } from '@portico/db';
import { addDays, localDateIn, type RecordAction, type RecordIssue, type RecordLink } from '@portico/kernel';
import type { RatePlanDto, RatePlanRecord, TaxRuleDto, TaxRuleRecord } from '../contracts';
import { ancestry, descendants } from '../domain/pricing';
import type { RatesPorts } from '../ports';
import { asNodes, effectivePolicyId, loadPlansForProperty } from './rate-plans';
import { db } from './shared';

const action = (a: string, label: string, enabled: boolean, reason?: string, previewRequired?: boolean): RecordAction => ({
  action: a,
  label,
  enabled,
  ...(enabled || !reason ? {} : { reason }),
  ...(previewRequired ? { previewRequired } : {}),
});

/** Record views for plans of one property (batched: one query per concern, not per plan). */
export async function ratePlanRecords(
  ports: RatesPorts,
  tx: TxContext,
  propertyId: string,
  selected: readonly RatePlanDto[],
): Promise<RatePlanRecord[]> {
  if (selected.length === 0) return [];
  const all = asNodes(await loadPlansForProperty(tx, propertyId));
  const property = await ports.getProperty(tx, propertyId);
  const today = localDateIn(tx.now, property.timezone);
  const rootOf = new Map(selected.map((p) => [p.id, ancestry(all, p.id)[0]?.id ?? p.id]));
  const roots = [...new Set(rootOf.values())];
  const priced = new Set(
    (await db(tx).selectFrom('rates.prices').select('rate_plan_id').distinct().where('rate_plan_id', 'in', roots).execute()).map((r) => r.rate_plan_id),
  );
  const pricedSoon = new Set(
    (
      await db(tx)
        .selectFrom('rates.prices')
        .select('rate_plan_id')
        .distinct()
        .where('rate_plan_id', 'in', roots)
        .where('stay_date', '>=', today)
        .where('stay_date', '<', addDays(today, 30))
        .execute()
    ).map((r) => r.rate_plan_id),
  );
  let authorityReason: string | null = null;
  try {
    if ((await ports.assertWritable(tx, propertyId, 'rates')) === 'forward')
      authorityReason = 'Rates at this property are managed in an external system; make changes there.';
  } catch (err) {
    authorityReason = (err as Error).message;
  }
  const can = (permission: string) => tx.authz.can(permission, { propertyId });
  const policyIds = [...new Set(selected.flatMap((p) => [p.cancellationPolicyId, p.guaranteePolicyId, p.depositPolicyId]).filter((x): x is string => !!x))];
  const policyNames = new Map(
    policyIds.length > 0
      ? (await db(tx).selectFrom('rates.policies').select(['id', 'name']).where('id', 'in', policyIds).execute()).map((r) => [r.id, r.name])
      : [],
  );
  const packageIds = [...new Set(selected.flatMap((p) => p.packageIds))];
  const packageNames = new Map(
    packageIds.length > 0
      ? (await db(tx).selectFrom('rates.packages').select(['id', 'name']).where('id', 'in', packageIds).execute()).map((r) => [r.id, r.name])
      : [],
  );

  return selected.map((plan) => {
    const chain = ancestry(all, plan.id);
    const root = chain[0] as (typeof chain)[number];
    const parent = chain.length > 1 ? chain[chain.length - 2] : undefined;
    const children = descendants(all, plan.id).filter((c) => c.parentId === plan.id);
    const liveChildren = descendants(all, plan.id).filter((c) => c.status !== 'retired');
    const hasPrices = priced.has(root.id);
    const cancellationId = effectivePolicyId(chain, 'cancellationPolicy');
    const inactiveAncestor = chain.slice(0, -1).find((p) => p.status !== 'active');
    const retired = plan.status === 'retired';
    const manage = can('rates.ratePlan.manage');
    const writeBlock = !manage ? 'You do not have permission to manage rate plans.' : authorityReason;

    const activateReason = writeBlock
      ? writeBlock
      : !hasPrices
        ? `Add prices${root.id !== plan.id ? ` to ${root.code}` : ''} in the rate calendar first.`
        : !cancellationId
          ? 'Choose a cancellation policy (or inherit one) first.'
          : inactiveAncestor
            ? `${inactiveAncestor.code} (the plan it derives from) is ${inactiveAncestor.status}; activate it first.`
            : undefined;
    const actions: RecordAction[] = [action('edit', 'Edit', !retired && !writeBlock, retired ? 'Retired plans cannot be changed.' : (writeBlock ?? undefined))];
    if (plan.status === 'draft' || plan.status === 'paused')
      actions.push(action('activate', 'Activate', !activateReason, activateReason));
    if (plan.status === 'active') actions.push(action('pause', 'Pause sales', !writeBlock, writeBlock ?? undefined));
    if (!retired) {
      const reason = writeBlock ?? (liveChildren.length > 0 ? `Re-parent or retire the derived plans first: ${liveChildren.map((c) => c.code).join(', ')}.` : undefined);
      actions.push(action('retire', 'Retire', !reason, reason));
    }
    const priceReason = retired
      ? 'Retired plans cannot be priced.'
      : plan.derivation
        ? `Prices are computed from ${parent?.code ?? 'the parent plan'}; edit its prices or this plan's derivation.`
        : !can('rates.price.manage')
          ? 'You do not have permission to change prices.'
          : (authorityReason ?? undefined);
    actions.push(action('editPrices', 'Edit prices', !priceReason, priceReason, true));
    const restrictionReason = retired ? 'Retired plans cannot be changed.' : !can('rates.restriction.manage') ? 'You do not have permission to change restrictions.' : (authorityReason ?? undefined);
    actions.push(action('editRestrictions', 'Edit restrictions', !restrictionReason, restrictionReason, true));
    const quoteReason = !can('rates.quote.read') ? 'You do not have permission to quote.' : plan.status !== 'active' ? `The plan is ${plan.status}.` : undefined;
    actions.push(action('quote', 'Quote a stay', !quoteReason, quoteReason));

    const issues: RecordIssue[] = [];
    if (!hasPrices)
      issues.push({ code: 'no_prices', severity: plan.status === 'draft' ? 'blocking' : 'warning', message: `No prices yet${root.id !== plan.id ? ` on ${root.code}` : ''}: the plan cannot be sold.` });
    else if (plan.status === 'active' && !pricedSoon.has(root.id))
      issues.push({ code: 'no_prices_next_30_days', severity: 'warning', message: 'No prices for the next 30 days: the plan cannot be sold for those nights.' });
    if (!cancellationId) issues.push({ code: 'no_cancellation_policy', severity: 'blocking', message: 'No cancellation policy (own or inherited): the plan cannot be activated.' });
    if (plan.status === 'active' && inactiveAncestor)
      issues.push({ code: 'parent_not_active', severity: 'warning', message: `${inactiveAncestor.code}, which this plan derives from, is ${inactiveAncestor.status}.` });
    if (authorityReason) issues.push({ code: 'external_system_of_record', severity: 'info', message: authorityReason });

    const links: RecordLink[] = [];
    if (parent) links.push({ rel: 'parent', type: 'rate_plan', id: parent.id, title: parent.code });
    for (const c of children) links.push({ rel: 'derived', type: 'rate_plan', id: c.id, title: c.code });
    for (const [rel, id] of [
      ['cancellationPolicy', plan.cancellationPolicyId],
      ['guaranteePolicy', plan.guaranteePolicyId],
      ['depositPolicy', plan.depositPolicyId],
    ] as const) {
      if (id) links.push({ rel, type: 'rate_policy', id, ...(policyNames.has(id) ? { title: policyNames.get(id) as string } : {}) });
    }
    for (const id of plan.packageIds) links.push({ rel: 'package', type: 'package', id, ...(packageNames.has(id) ? { title: packageNames.get(id) as string } : {}) });
    links.push({ rel: 'property', type: 'property', id: plan.propertyId });

    const { status, ...rest } = plan;
    return { ...rest, status: { ratePlan: status }, allowedActions: actions, issues, links };
  });
}

export async function ratePlanRecord(ports: RatesPorts, tx: TxContext, plan: RatePlanDto): Promise<RatePlanRecord> {
  return (await ratePlanRecords(ports, tx, plan.propertyId, [plan]))[0] as RatePlanRecord;
}

export function taxRuleRecord(tx: TxContext, rule: TaxRuleDto): TaxRuleRecord {
  const today = tx.now.toISOString().slice(0, 10);
  const effective = rule.versions.find(
    (v) => v.status === 'active' && (v.effectiveFrom === null || v.effectiveFrom <= today) && (v.effectiveTo === null || today < v.effectiveTo),
  );
  const drafts = rule.versions.filter((v) => v.status === 'draft');
  const scheduled = rule.versions.filter((v) => v.status === 'active' && v.effectiveFrom !== null && v.effectiveFrom > today);
  const manage = tx.authz.can('rates.taxRule.manage');
  const activate = tx.authz.can('rates.taxRule.activate');
  const actions: RecordAction[] = [
    action('addVersion', 'Draft a new version', manage && rule.status === 'active', !manage ? 'You do not have permission to manage tax rules.' : 'This rule is retired.'),
    action(
      'activateVersion',
      'Activate a draft',
      activate && drafts.length > 0,
      !activate ? 'You do not have permission to activate tax rules.' : 'There is no draft version to activate.',
      true,
    ),
    action(
      'withdrawVersion',
      'Withdraw a version',
      activate && (drafts.length > 0 || scheduled.length > 0),
      !activate ? 'You do not have permission to activate tax rules.' : 'Only drafts and versions that have not taken effect can be withdrawn.',
    ),
  ];
  const issues: RecordIssue[] = [];
  if (!effective) issues.push({ code: 'no_version_in_force', severity: 'warning', message: 'No version of this rule is in force today.' });
  else if (effective.verification.status !== 'verified')
    issues.push({
      code: 'not_adviser_confirmed',
      severity: 'warning',
      message:
        effective.verification.status === 'verified_official_source'
          ? 'Read from the authority\'s official source but not yet confirmed by a qualified adviser; live fiscal documents are blocked until it is.'
          : 'Not verified against an official source; live fiscal documents are blocked until it is.',
    });
  for (const d of drafts) issues.push({ code: 'draft_pending', severity: 'info', message: `Version ${d.versionNo} is a draft awaiting review and activation.` });
  for (const s of scheduled) issues.push({ code: 'scheduled_change', severity: 'info', message: `Version ${s.versionNo} takes effect on ${s.effectiveFrom}.` });
  const links: RecordLink[] = (rule.propertyIds ?? []).map((id) => ({ rel: 'property', type: 'property', id }));
  const { status, ...rest } = rule;
  return {
    ...rest,
    status: { taxRule: status, verification: effective?.verification.status ?? 'none' },
    allowedActions: actions,
    issues,
    links,
  };
}
