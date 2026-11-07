# Round 1 refinements — Finance, cashier and Day Close

Scope: the finance workspace, bills (folios), cashier sessions, receivables, reports and the night audit (Day Close).
Personas P6 (finance manager) and P5 (night auditor), plus the split-bill check-out from P2. Citation keys, categories
and the power-check rule are defined at the top of `front-desk.md`. Outcomes are **TARGETS** until validated with
hotel staff.

The finance module merged today with ledger, bills, billing rules, receivables, invoices, cashier sessions, Day Close
checks and exceptions (`modules/finance/README.md`). None of it is reachable in the UI yet, so most items are
**(a) wiring**. Day Close as a *run* belongs to the `day-close` module (spec Wave 2), which does not exist yet — **(b)**.
Money-tile reconciliation on Today is handled in `search-navigation-shell.md` NAV-07.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| FIN-01 | A Finance workspace that starts with exceptions | (a) | finance | blocker |
| FIN-02 | Bills labelled by who pays, inside the stay | (a) | finance | blocker |
| FIN-03 | Cashier session and quick charge posting | (a) | finance | major |
| FIN-04 | Company accounts (city ledger) with aging | (a) | finance | major |
| FIN-05 | Reports with definitions and export | (a) | finance | minor |
| DC-01 | Day Close readiness, visible all day, every item with its fix | (a) | day-close | blocker |
| DC-02 | Run Day Close with steps and resume | (b) | day-close | blocker |

---

### FIN-01 · A Finance workspace that starts with exceptions

**Category** (a) — `/v1/finance/exceptions`, `/finance/day-close-checks`, `/finance/trial-balance`,
`/finance/integrity`; payments `/payments/exceptions` · **Owner** finance (+ payments) · **Priority** blocker
**Evidence** P6 — **No**: "The navigation is Overview + Settings only. There is no folios, accounts receivable, company
accounts, deposits ledger, cashier or payments screen"; search for "folio", "invoice", "company", "ledger" returns
nothing; "The role card says finance covers 'Folios, invoices, receivables, cashier reconciliation, payouts and
exports'. None of these is reachable"; T6 · `[screens/p6-01-home.jpg]` `[screens/p6-02-payments-mywork.jpg]`

**Proposed change.**
- A **Finance** workspace on the rail (`g f`, ux §7). Sections: **Exceptions** (home) · **Bills** · **Receivables** ·
  **Cashier** · **Payments** (PAY-04) · **Reports**.
- Home uses the shared workspace skeleton:
  - **Now** — unbalanced items, payments pending verification (with age), recorded bank transfers awaiting the
    statement, disputes with evidence deadlines, invoices overdue for issue (the 3-day rule) — each with owner and its
    action button.
  - **Today** — trial balance status ("Balanced ✓ as of 07:00"), open cashier sessions, invoices to issue.
  - **Watch** — aging buckets, credit-limit breaches, restatements since the last close.
- Finance items also appear in **My work** for the finance role (one inbox, experience architecture §2).
- Palette synonyms: folio, bill, invoice, city ledger, AR, receivables, ledger, trial balance (NAV-01).

**Expected outcome (targets).** The finance manager reaches open exceptions in 1 click (baseline: impossible); all six
role-card promises reachable in ≤ 2 clicks.

**Power check.** Exposes FIN capabilities that exist; nothing removed. Exceptions are resolved with their own
evidence — no "mark as fine" shortcut.

---

### FIN-02 · Bills labelled by who pays, inside the stay

**Category** (a) — folios, postings, adjustments, transfers, billing rules + `POST /finance/billing-rules/preview`,
documents (FIN §3.2–3.4, §3.8) · **Owner** finance · **Priority** blocker
**Evidence** P2 › Checkout + split bill: "no folio, no balance and no routing"; P6; T2 · `[screens/p2-18-inhouse-stay.jpg]`

**Proposed change.**
- Stay and booking records get a **Bill** tab (glossary: "Bill (folio)" on first use, then "Bill"). Bills side by side,
  **labelled by payer name** ("Maldivian Holidays Ltd — accommodation", "Ms Johansson — incidentals"), never by
  number (finance §9).
- Each bill: balance (with markers "includes 1 pending payment", *Estimate* before check-out), postings grouped by
  date and package, and actions **Post charge** · **Adjust** (reason; creates a linked adjusting entry — posted entries
  are never edited) · **Move to another payer** (select postings → preview → confirm) · **Settle** (Collect panel) ·
  **Issue invoice**.
- A **Who pays for what** panel in plain language: "Maldivian Holidays pays the room and its taxes; Ms Johansson pays
  everything else." **Change…** → billing-rules preview with totals before/after per bill.

**Expected outcome (targets).** "What does the guest owe vs the company?" in 1 click; move a posting with preview in
≤ 20 s; 0 wrong payer at check-out (ux §19).

**Power check.** OPERA routing/windows parity via billing rules; immutability and reversing entries preserved
(CLAUDE.md §5).

---

### FIN-03 · Cashier session and quick charge posting

**Category** (a) — `/finance/cashier-sessions` (open, close with count, paid-outs), `/finance/charges` · **Owner**
finance · **Priority** major
**Evidence** P6 ("cashier reconciliation" unreachable); persona ask "cashier shift close"; ux §19 "Post an outlet charge
≤ 20 s"

**Proposed change.**
- **Cashier** panel: **Open session** (opening float) → **Post charge** (find guest by villa number or name → charge
  code → amount → `Ctrl+Enter`) → **Paid-out** (reason) → **Close session** with a **blind count** first, then the
  variance and a required explanation for over/short.
- The session state shows in the header for cashier roles ("Cash session open since 07:00 · USD 412.00").

**Expected outcome (targets).** Post a charge in ≤ 20 s; close a session in ≤ 2 min.

**Power check.** Blind count and variance explanations are enforced, not optional.

---

### FIN-04 · Company accounts (city ledger) with aging

**Category** (a) — `/finance/receivables-accounts`, items, payments, allocations, `/finance/receivables/aging`,
transfer from bills (FIN §3.7) · **Owner** finance · **Priority** major
**Evidence** P6 (no company/AR accounts); persona ask "company/AR accounts with balances and ageing"

**Proposed change.**
- **Receivables** list: account, balance, aging buckets (0–30 · 31–60 · 61–90 · 90+), credit-limit usage bar, last
  payment. Account page: invoices, payments, allocations, statement (PDF); **Apply payment** with an allocation preview.
- Linked from the company record in guests and from the "Send to company account" step of check-out (FD-07).

**Expected outcome (targets).** Find overdue agency balances in 1 click.

**Power check.** FIN §3.7 complete; credit limits enforced at transfer.

---

### FIN-05 · Reports with definitions and export

**Category** (a) — `/finance/reports/daily-revenue`, `/finance/reports/green-tax`, `/finance/trial-balance` ·
**Owner** finance · **Priority** minor
**Evidence** P6 (role card promises exports, unreachable)

**Proposed change.** A **Reports** section: Daily revenue, Green Tax, Trial balance. Each with an ⓘ definition (design
direction), a business-date picker, "as of / restated" note, and **Export CSV** (permission-gated).

**Expected outcome (targets).** Green Tax figures for a date in ≤ 3 clicks.

**Power check.** Adds.

---

### DC-01 · Day Close readiness, visible all day, every item with its fix

**Category** (a) — aggregates existing checks: finance `/finance/day-close-checks`, reservations `/reservations/issues`
and arrivals/departures lists, payments `/payments/exceptions`, operations discrepancies · **Owner** day-close (until
the module exists: a read-only composition in the back office, replaced by the `day_close` readiness API, DCL-R01) ·
**Priority** blocker
**Evidence** P5 — **No**: "There is no Day Close / Night audit item in the navigation. Search for 'day close', 'audit',
'close' and 'end of day' returns nothing"; the only traces are "the folio receives the new nights at Day Close" and a
CONTENT COMING lesson; "missing: the classic audit pre-checks"; T5 · `[screens/p5-01-home.jpg]` `[screens/p9-01-learn.jpg]`

**Proposed change.**
- A **Day Close** section (night auditor and GM in the Front desk / Overview workspaces; owner's Today; `g c`; palette
  synonyms "night audit", "end of day", "close day", "audit", "EOD").
- **Readiness panel**: "2 things must be settled before today can close · 5 warnings" (personas P17 wording), grouped
  with owners and a fix button per row:
  - Arrivals not checked in → **Check in** · **Mark no-show** · **Transfer delayed** (keeps EC-RES-003 in mind).
  - Departures not checked out → **Check out** · **Extend**.
  - Payments pending verification → **Check now**.
  - Departed stays with a balance → **Settle** · **Send to company account**.
  - Room-status discrepancies (skip/sleep) → **Resolve**.
  - Cashier sessions open → **Close session**.
- Visible all day (not only at night) so the desk clears items before the auditor arrives (DCL-R01).

**Expected outcome (targets).** Every blocking item visible on one screen; each resolved in ≤ 2 clicks.

**Power check.** No rule is relaxed: overrides happen only inside the run (DC-02) with permission and a reason per item.

---

### DC-02 · Run Day Close with steps and resume

**Category** (b) — `day-close` module not built (spec Wave 2); platform `advanceBusinessDate` exists in the service;
finance postings exist · **Owner** day-close (+ platform, finance, reservations) · **Priority** blocker
**Evidence** P5; vision moment "Day Close stops at 02:10: the auditor sees exactly which postings completed, presses
resume, and nothing is posted twice"

**Proposed change (design to build against).**
- **Run page**: preflight result → **Start Day Close for Sat 7 Nov** → step list (no-shows · room & package postings ·
  allowance close · payment housekeeping · integrity · statistics · advance date · reports), each with live counts and
  timing.
- Failure is specific: "Room charges: 412 of 418 posted · 6 remaining · stopped at 02:10 (provider timeout)" →
  **Resume** (idempotent keys `room:{stayId}:{date}` — nothing posts twice).
- Overrides per blocking item: permission (`dayClose.exception.override` ⚑) + reason, recorded.
- Finish: "Business date is now Sun 8 Nov. Day report ready." Nobody is signed out (non-blocking, unlike OPERA).

**Expected outcome (targets).** Day Close with no blocking exceptions needs ≤ 2 min of attention (ux §19).

**Power check.** Matches `docs/parity/day-close.md`; more resilient than OPERA's End of Day (no global logout, safe
resume).
