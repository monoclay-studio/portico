# Spec: concessions

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-5) · Schema `concessions` · Prefix `CNC`
Entitlement (proposed, CR-29): `concessions.settlement`.

## 1. Purpose

Many resort dive centres, spas, boutiques, water-sports and photo studios are run by partner companies inside the
resort. Guests sign for their services on the villa bill; at month end the resort owes the partner what it collected on
its behalf, less commission or revenue share, rent and recharges for power, water, staff beds and meals. Concessions
makes that relationship exact and dispute-proof: partner charges land on the guest's bill without becoming hotel
revenue by mistake, every settlement line is reproducible from the agreement and the ledger, and the partner sees only
what it needs.

## 2. Scope and non-goals

**In scope:** concessionaires (partner operators), concession agreements (versioned snapshots), outlets operated by
concessionaires, room charges on behalf of concessionaires (through `fnb-pos` quick post/POS or the partner's own system
via the POS intake API with a scoped client), declared direct sales, revenue share/commission, minimum guarantees,
rent, recharges (utilities by meter, staff housing, staff meals, marketing levy, collection fees), settlement
statements, invoices to the concessionaire, payables to the concessionaire, netting, disputes, partner access.

**Non-goals:** the partner's own POS, booking or spa system (integrate as a POS source); the partner's books and tax
filings; activity scheduling (`resort`); payment collection from guests (`payments`/`finance`).

## 3. Capabilities

- **CNC-R01** [MUST] **Concessionaire**: links to the `accounting` supplier (payee, ACC-R10) and a `finance` receivables
  account (for invoices to the partner); legal entity details, TIN, GST registration and sector, contacts, status
  (`active ⇄ suspended → ended`).
- **CNC-R02** [MUST] **Concession agreement** (immutable versioned snapshots): outlets operated (platform outlets marked
  `operatedBy: concessionaire` — CR-22), term, **charge model** `agent` (default — the hotel collects as agent; Q104) or
  `principal` (the hotel resells), revenue share (commission % of a basis: room charges collected on behalf, declared
  direct sales, or both; tiers), **minimum guarantee** (monthly or annual with true-up), fixed rent, **recharges**
  (utilities by meter × unit cost from `utilities`; staff beds × rate from `workforce` housing; staff meals × rate from
  `workforce`; marketing levy %; collection/card fee % on room charges; other fixed items), **uncollected-charge risk**
  (`hotel_guarantees | pass_through`), settlement frequency, payment terms, currency, sales-declaration obligation, audit
  rights.
- **CNC-R03** [MUST] **Room charges on behalf**: partner staff post through `fnb-pos` quick post or POS (FNB-R25), or the
  partner's system posts through the POS intake API (FNB-R26) with a **partner-scoped API client**: limited to its
  outlets, guest lookup returns only eligibility (unit, surname match, allowed yes/no, remaining limit band) — no folio
  balances, no profile data beyond the name (INT-R27 partner-app pattern). Charges use charge codes in group
  `concession` (CR-13) mapped, in the agent model, to **due to concessionaire** (liability) — never to hotel revenue;
  taxes computed per the partner's registration via `rates`; the guest folio and invoice show them in a separate section
  "Services provided by <partner> (TIN …)" (presentation pending adviser confirmation, Q104).
- **CNC-R04** [MUST] **Declared direct sales** (paid at the partner's own terminal): monthly declaration entered by staff
  or imported (partner portal LATER); plausibility checks against `resort` activity bookings and POS data; audit
  adjustments with reason.
- **CNC-R05** [MUST] **Settlement calculation** per period: collected on behalf (from ledger postings with drill-down to
  stays; refunds and adjustments included; uncollected charges per risk rule), revenue share by formula with tiers and
  minimum-guarantee true-up, rent, recharges with quantity × rate evidence, collection fees, advances already paid, net
  due to or from the partner; preview with explanations; `calculated → reviewed → approved` (approver ≠ preparer).
- **CNC-R06** [MUST] **Settlement outputs** on approval: (a) a numbered **settlement statement** (immutable snapshot);
  (b) the hotel's **tax invoice to the partner** for commission, rent and recharges (finance receivables fiscal document,
  taxes per rule pack); (c) a **payable** for amounts collected on behalf (`accounting.createVoucherFromSettlement`); (d)
  an AP/AR **netting** allocation; journals: Dr due to concessionaire / Cr settlement clearing (`cnc:{settlementId}`) →
  AP. The partner is paid the net through a payment run.
- **CNC-R07** [MUST] Late charges, refunds and adjustments after settlement roll into the next period with references;
  disputes have status, owner and resolution; the partner receives statements and posted-charge detail by email
  (`message.supplier`) — partner portal LATER.
- **CNC-R08** [SHOULD] KPIs: partner sales per occupied room, capture rate, revenue-share yield, recharge recovery %,
  dispute rate.
- **CNC-R09** [SHOULD] **Principal model**: charges are hotel revenue; the partner invoices the hotel (AP voucher) for
  its services per the agreement; settlement shows the same transparency.

## 4. Entities and states

`concessionaire(id, supplier_id, receivables_account_id, status)` · `agreement(id, concessionaire_id, version,
terms_snapshot jsonb, effective_from, effective_to?)` · `declaration(id, agreement_id, period, sales jsonb, status)` ·
`settlement(id, agreement_version, period, inputs jsonb, lines jsonb, net, currency, status, document_number?,
invoice_ref?, voucher_ref?)` · `dispute(id, settlement_id, lines jsonb, status)`.

**Agreement:** `draft → active → ended` (new versions supersede; history kept).
**Settlement:** `draft → calculated → reviewed → approved → issued → settled (paid/netted)` · `calculated|reviewed →
superseded` · `issued → disputed → adjusted (next period)`.

## 5. Invariants

- **CNC-I01** Per concessionaire, the due-to-concessionaire balance = Σ collected-on-behalf postings not yet settled −
  settlements issued (control equals sub-ledger).
- **CNC-I02** In the agent model, no concession charge code maps to a hotel revenue account.
- **CNC-I03** Each posting is included in exactly one settlement.
- **CNC-I04** A settlement is reproducible from its agreement version and cited inputs; an issued settlement is
  immutable.
- **CNC-I05** A partner-scoped client can read only eligibility responses for its outlets and its own postings.

## 6. Cross-module interactions

Calls `finance` (charge-code mapping, ledger reads, receivables invoice, `postJournal`), `accounting`
(`createVoucherFromSettlement`, netting, payment status), `utilities` (metered consumption and unit costs), `workforce`
(bed-nights and meal counts), `fnb-pos` (outlet configuration — read), `identity`/`integration` (partner client scopes).
Dependency arrow (proposed): `concessions ─► finance, accounting, utilities, workforce, platform`.

## 7. Events

`concessions.agreement.activated|ended` · `concessions.settlement.calculated|approved|issued|disputed`.
Consumed: `finance.posting.created` (concession group), `accounting.payment.confirmed`, `finance.period.stateChanged`.

## 8. Permissions

`concessions.concessionaire.manage` · `concessions.agreement.manage` ⚑ · `concessions.declaration.record` ·
`concessions.settlement.calculate` · `concessions.settlement.approve` ⚑ · `concessions.dispute.manage` ·
`concessions.report.read`.

## 9. UX surfaces

Concessions workspace (partners, agreements expiring, settlements due, disputes); agreement editor with formula
preview; settlement view (collected on behalf by stay, revenue share, guarantees, recharges with evidence, net; download
statement); partner charge desk (quick post).

## 10. Proof scenarios and evidence

| ID | Concessions must demonstrate |
|---|---|
| B17 | Spa partner (agent model): room charges, one refund, minimum-guarantee true-up, utilities recharge by meter, staff beds; statement, tax invoice and payable netted; ledger controls equal sub-ledger. |
| B01 (supporting) | Settlement approved before close; settlement clearing zero. |

## 11. Maldives specifics

Dive centres, spas, boutiques and water-sports are often run by third parties in resorts (resort spec §11). Partners
may be separately GST-registered in the tourism sector; whether the hotel's invoice may carry their services as agent
collections and how TGST is reported is unconfirmed (Q104). Partner staff frequently live in the staff village and eat
in the canteen → housing and meal recharges are routine.

## 12. Competitive inspirations

Book4Time room-charge integration with Agilysys PMS/POS (research 01 §6.2) shows partners as charge sources; Guesty
owner-statement formulas and review-before-send (research 03 §6.2) inform the settlement statement.

## 13. Open questions

Q104 (agent vs principal, tax and invoice presentation).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **conditional** — settlement statements can be computed from an imported
  posting report of the external PMS (labelled `external`), but room charges on behalf need `charges` in Portico or a
  verified forward to the PMS.
- **Hard dependencies:** `finance` (charge codes, ledger), `accounting` (payables) or an ERP export, `platform`.
- **Connected mode:** `charges` external → partner charges are forwarded to the PMS folio (pending until acknowledged);
  settlement uses mirrored postings; `payables` external → the settlement payable is exported to the ERP.
- **Data-authority domains:** respects `charges`, `payables`, `accounting`; owns agreements and settlements.
- **Trial:** settlements computed on copied postings; nothing sent to partners.

## 15. Boundary — build here, integrate instead

| Capability | Decision |
|---|---|
| Agreements, collection on behalf, settlements, recharges | **Build** |
| Partner's POS/spa/dive booking systems | **Integrate** as POS sources with scoped clients |
| Partner's accounting and tax filings | **Never** (partner's responsibility) |
| Partner portal | **LATER** (statements by email first) |
