# Spec: billing

Status: Draft v1 · 2026-11-07 · Wave 3 · Schema `billing` · Prefix `BIL`

## 1. Purpose

Bill organizations for Portico (Monoclay's SaaS revenue) transparently and fairly, **completely separate** from hotel
guest money (architecture rule 14; decision D2): different Stripe account (Monoclay's own platform account, tagged with
the product code), different module, different ledger. Pricing is the owner's decision (Q3); billing makes it
configurable, explainable and honest.

## 2. Scope and non-goals

**In scope:** price books (configuration, no prices in code), subscriptions per organization (plan, add-ons, limits,
contract overrides), usage-based items (`usage.messages`, `usage.aiCredits`, connectivity pass-through), trials,
invoices and credit notes to the customer's billing entity, payment collection on Monoclay's account (card, bank
transfer), dunning, cancellation, proration, renewal notices, product-level bookkeeping export.
**Non-goals:** anything touching hotel guest funds; payment platform fees taken on hotel payments (those are
`application_fee` metadata in `payments`, reported to billing only as information); entitlement evaluation
(`platform`).

## 3. Capabilities

- **BIL-R01** [MUST] Price book as effective-dated configuration per plan/add-on/usage item, currency and region
  (Q3); price changes never apply retroactively; renewals show the new price ≥ 60 days before (policy) with any
  increase cap from the contract.
- **BIL-R02** [MUST] Subscription changes (upgrade/downgrade/add-on) update `platform` plan/entitlements through one
  previewed command (proration and entitlement effects shown; downgrade never deletes data — PLT-R23).
- **BIL-R03** [MUST] Trials: no card charged during a trial; trial end requires an explicit choice; one-click
  cancellation; pro-rated final invoice (research 03 §12 anti-patterns).
- **BIL-R04** [MUST] Usage items billed from `platform` usage counters with line-level detail; pass-through items
  (e.g. channel hub fee per connected property, messaging) shown separately from Monoclay fees (Q45).
- **BIL-R05** [MUST] Invoices numbered gaplessly per Monoclay series with product code tag (D1: product-level
  bookkeeping identifiable within Monoclay); tax treatment of SaaS invoices per customer jurisdiction is configuration
  marked `unverified` until professional advice is obtained (Q47); idempotent issuance.
- **BIL-R06** [MUST] Collection via Monoclay's Stripe account (Stripe Billing); failed payments → dunning emails →
  admin banners (`restricted` notices); suspension of an organization only by an operator decision with notice
  (PLT-R07) — never automatic, never during in-house stays without notice.
- **BIL-R07** [MUST] Every external effect (charging the customer, emails) passes environment safety; demo/trial
  organizations are never billed.
- **BIL-R08** [SHOULD] Customer billing portal: plan, usage to date with caps, invoices, payment method, cancellation.
- **BIL-R09** [SHOULD] Export of SaaS revenue, deferred revenue and receivables for Monoclay's accounting (separate from
  any hotel ledger).

## 4. Entities and states

`price_book(id, version, effective_from, items jsonb)` · `subscription(id, organization_id, plan_code, addons[],
overrides jsonb, status, term, renews_at)` · `usage_charge(subscription_id, meter, period, quantity, amount)` ·
`saas_invoice(id, series, number, organization_id, lines jsonb, tax jsonb, status)` · `saas_payment(...)`.
**Subscription:** `trialing → active → past_due → active | canceled` · `active → canceled` (end of term or immediate
per contract). **SaaS invoice:** `draft → issued → paid | void (credit note) | uncollectible`.

## 5. Invariants

- **BIL-I01** No billing table references a hotel payment account, folio or guest; no code path in `billing` calls hotel
  payment providers (static dependency test).
- **BIL-I02** Invoice numbers per series are gapless; issuance is idempotent.
- **BIL-I03** Demo/trial/training/sandbox organizations have no billable subscription.
- **BIL-I04** Entitlements in `platform` equal the active subscription's plan + add-ons after every change.

## 6. Cross-module interactions

Calls `platform` (plans, usage counters, organization status proposals); `identity` (billing admins). Nothing else.

## 7. Events

`billing.subscription.changed`, `billing.invoice.issued|paid|pastDue`. Consumes `platform.usage.thresholdReached`.

## 8. Permissions

`billing.subscription.read` (org) · `billing.subscription.manage` ⚑ (org) · `billing.invoice.read` (org) ·
`billing.paymentMethod.manage` ⚑ (org); Monoclay operator permissions are separate (operator console).

## 9. UX surfaces

Plan & billing page (customer), usage meters with caps, invoices; operator console for Monoclay staff.

## 10. Proof scenarios and evidence

| ID | Billing must demonstrate |
|---|---|
| E14 | Usage cap and billing are distinct: hitting a cap blocks only the metered effect; billing shows usage. |
| E13 (supporting) | Organization payment failure never suspends hotel operations without operator decision and notice. |

## 11. Maldives specifics

Monoclay is a Delaware company; customers are Maldivian legal entities; currency of SaaS invoices (USD) and tax on
imported digital services are unverified (Q47).

## 12. Competitive inspirations

Mews netting SaaS fees against payment payouts erodes trust (research 02 §2.8 item 3) — Portico never nets; pricing
opacity, renewal shocks and trial billing are top SMB complaints (research 03 §12, §14 item 4).

## 13. Open questions

Q3 (prices), Q45 (usage pass-through), Q47 (tax treatment of SaaS invoices).

## 14. Adoption modes

- **Standalone alongside an external PMS:** not applicable (Monoclay-internal); the proposed `connect` plan bills
  module-only adoption.
- **Hard dependencies:** `platform`, `identity`.
- **Connected mode:** unaffected.
- **Data-authority domains:** none.
- **Trial:** never billed.
