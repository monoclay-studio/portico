/**
 * Rates application services, bound to their ports and the server key that seals agreed terms. The composition
 * root creates one instance:
 *   const rates = ratesService(ports, { termsSealKey: termsSealKeyFromEnv().key })
 * and binds other modules' ports to its providers (quote, priceChange, computeTaxes, getRatePlan, …).
 * The provider contract is documented in README.md § "Provider contract".
 */
import type { TxContext } from '@portico/db';
import type { ComputeTaxesInput, PenaltyEvaluation, TermsSnapshot } from './contracts';
import { levyDays } from './domain/tax-engine';
import {
  evaluateCancellationPenalty,
  instantiatePaymentSchedule,
  levyTrueUp,
  postingChargeLines,
  postingPlan,
  verifyTerms,
} from './domain/terms';
import type { RatesPorts } from './ports';
import * as calendar from './services/calendar';
import * as catalog from './services/catalog';
import * as quoting from './services/quote';
import * as plans from './services/rate-plans';
import * as records from './services/records';
import * as taxes from './services/tax-rules';

export interface RatesServiceOptions {
  /** Base64 server key for the HMAC seal of agreed terms (`termsSealKeyFromEnv`). */
  termsSealKey: string;
}

export function ratesService(ports: RatesPorts, options: RatesServiceOptions) {
  const deps: quoting.QuoteDeps = { ports, sealKey: options.termsSealKey };
  return {
    // ── Providers (README § Provider contract; docs/architecture/domain-map.md § rates) ──
    quote: (tx: TxContext, request: unknown) => quoting.quote(deps, tx, request),
    quoteDetailed: (tx: TxContext, request: unknown) => quoting.quoteDetailed(deps, tx, request),
    priceChange: (tx: TxContext, input: unknown) => quoting.priceChange(deps, tx, input),
    overridePrice: (tx: TxContext, input: unknown) => quoting.overridePrice(deps, tx, input),
    complimentaryTerms: (
      tx: TxContext,
      input: { terms: TermsSnapshot; kind: 'complimentary' | 'house_use'; reason: string },
    ) => quoting.complimentaryTerms(deps, tx, input),
    computeTaxes: (tx: TxContext, input: ComputeTaxesInput) => taxes.computeTaxes(ports, tx, input),
    computeTaxesDetailed: (tx: TxContext, input: ComputeTaxesInput) =>
      taxes.computeTaxesDetailed(ports, tx, input),
    getRulePackStatus: (tx: TxContext, propertyId: string) => taxes.getRulePackStatus(ports, tx, propertyId),
    getRatePlan: plans.getRatePlan,
    listRatePlans: plans.listRatePlans,
    recordPlanSale: quoting.recordPlanSale,
    releasePlanSale: quoting.releasePlanSale,
    /** Pure: charge lines to post for agreed terms (no configuration read). */
    postingPlan: (terms: TermsSnapshot, stayId: string) => postingPlan(terms, stayId),
    /** Pure: the posting plan as computeTaxes lines (commercial rules pinned to the agreement). */
    postingChargeLines: (terms: TermsSnapshot, stayId: string) => postingChargeLines(terms, stayId),
    /** True when the terms carry a valid seal made with this server's key (check stored terms before use). */
    verifyTerms: (terms: unknown) => verifyTerms(options.termsSealKey, terms),
    /** Pure: payment schedule (deposit / balance items) for agreed terms. */
    instantiatePaymentSchedule: (terms: TermsSnapshot, opts?: { bookingDate?: string }) =>
      instantiatePaymentSchedule(terms, opts),
    /** Pure: penalty for cancellation / no-show / early departure at an instant, from the agreement alone. */
    evaluateCancellationPenalty: (
      terms: TermsSnapshot,
      at: Date,
      opts?: { event?: PenaltyEvaluation['event']; nights?: readonly string[] },
    ) => evaluateCancellationPenalty(terms, at, opts),
    /** Pure: guest-days for a per-guest-per-day levy from actual check-in/out (24-hour blocks, ≥ 12 h rule). */
    levyDays: (checkInAt: Date, checkOutAt: Date, minHoursLastBlock?: number) =>
      levyDays(checkInAt, checkOutAt, minHoursLastBlock),
    /** Pure: the levy-only line correcting the agreed Green Tax estimate to actual 24-hour blocks. */
    levyTrueUp: (
      terms: TermsSnapshot,
      input: { checkInAt: Date; checkOutAt: Date; minHoursLastBlock?: number },
    ) => levyTrueUp(terms, input),

    // ── Universal record views (status per family, next actions, issues, links) ──
    ratePlanRecord: (tx: TxContext, plan: Parameters<typeof records.ratePlanRecord>[2]) =>
      records.ratePlanRecord(ports, tx, plan),
    ratePlanRecords: (
      tx: TxContext,
      propertyId: string,
      list: Parameters<typeof records.ratePlanRecords>[3],
    ) => records.ratePlanRecords(ports, tx, propertyId, list),
    taxRuleRecord: records.taxRuleRecord,

    // ── Rate plans ──
    createRatePlan: (tx: TxContext, input: unknown) => plans.createRatePlan(ports, tx, input),
    updateRatePlan: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      plans.updateRatePlan(ports, tx, id, expectedVersion, patch),
    changeRatePlanStatus: (tx: TxContext, id: string, expectedVersion: number, input: unknown) =>
      plans.changeRatePlanStatus(ports, tx, id, expectedVersion, input),

    // ── Calendar ──
    previewPriceUpdate: (tx: TxContext, input: unknown) => calendar.previewPriceUpdate(ports, tx, input),
    applyPriceUpdate: (tx: TxContext, input: unknown) => calendar.applyPriceUpdate(ports, tx, input),
    getPriceCalendar: calendar.getPriceCalendar,
    getPriceHistory: calendar.getPriceHistory,
    previewRestrictionUpdate: (tx: TxContext, input: unknown) =>
      calendar.previewRestrictionUpdate(ports, tx, input),
    applyRestrictionUpdate: (tx: TxContext, input: unknown) =>
      calendar.applyRestrictionUpdate(ports, tx, input),
    getRestrictions: calendar.getRestrictions,
    getEffectiveRestrictions: calendar.getEffectiveRestrictions,

    // ── Catalog ──
    createPolicy: (tx: TxContext, input: unknown) => catalog.createPolicy(ports, tx, input),
    updatePolicy: (
      tx: TxContext,
      id: string,
      expectedVersion: number,
      patch: { name?: string; structure?: unknown },
    ) => catalog.updatePolicy(ports, tx, id, expectedVersion, patch),
    getPolicy: (tx: TxContext, id: string) => catalog.getPolicy(ports, tx, id),
    listPolicies: (tx: TxContext, propertyId: string) => catalog.listPolicies(ports, tx, propertyId),
    policyVersionHistory: catalog.policyVersionHistory,
    createInclusion: (tx: TxContext, input: unknown) => catalog.createInclusion(ports, tx, input),
    updateInclusion: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updateInclusion(ports, tx, id, expectedVersion, patch),
    listInclusions: catalog.listInclusions,
    createPackage: (tx: TxContext, input: unknown) => catalog.createPackage(ports, tx, input),
    updatePackage: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updatePackage(ports, tx, id, expectedVersion, patch),
    listPackages: catalog.listPackages,
    createPromotion: (tx: TxContext, input: unknown) => catalog.createPromotion(ports, tx, input),
    updatePromotion: (tx: TxContext, id: string, expectedVersion: number, patch: unknown) =>
      catalog.updatePromotion(ports, tx, id, expectedVersion, patch),
    listPromotions: catalog.listPromotions,

    // ── Tax & fee rules ──
    listTaxRules: taxes.listTaxRules,
    getTaxRule: taxes.getTaxRule,
    createTaxRule: taxes.createTaxRule,
    addTaxRuleVersion: taxes.addTaxRuleVersion,
    previewTaxRuleActivation: (tx: TxContext, versionId: string) =>
      taxes.previewTaxRuleActivation(ports, tx, versionId),
    activateTaxRuleVersion: (tx: TxContext, versionId: string, input: unknown) =>
      taxes.activateTaxRuleVersion(ports, tx, versionId, input),
    withdrawTaxRuleVersion: taxes.withdrawTaxRuleVersion,
    installTaxTemplate: taxes.installTaxTemplate,
  };
}

export type RatesService = ReturnType<typeof ratesService>;
