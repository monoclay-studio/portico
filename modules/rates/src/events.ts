import type { DateRange } from '@portico/kernel';

/** Event types emitted by rates (outbox). Payload version 1. */
export const RATES_EVENTS = {
  /** Coalescible: distribution may merge several into one ARI update per plan/unit type/range. */
  pricesChanged: 'rates.prices.changed',
  restrictionsChanged: 'rates.restrictions.changed',
  ratePlanChanged: 'rates.ratePlan.changed',
  ratePlanStatusChanged: 'rates.ratePlan.statusChanged',
  taxRuleActivated: 'rates.taxRule.activated',
} as const;

export interface PricesChangedPayload extends Record<string, unknown> {
  propertyId: string;
  changeSetId: string;
  /** The edited plan plus every derived plan whose computed prices changed with it. */
  ratePlanIds: string[];
  unitTypeIds: string[];
  /** Half-open stay-date ranges, coalesced. */
  ranges: DateRange[];
}

export interface RestrictionsChangedPayload extends Record<string, unknown> {
  propertyId: string;
  changeSetId: string;
  /** null entry = all plans. Includes derived plans that inherit the changed kinds. */
  ratePlanIds: Array<string | null>;
  unitTypeIds: Array<string | null>;
  ranges: DateRange[];
}

export interface TaxRuleActivatedPayload extends Record<string, unknown> {
  taxRuleId: string;
  ruleCode: string;
  ruleVersionId: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  supersededVersionId: string | null;
}
