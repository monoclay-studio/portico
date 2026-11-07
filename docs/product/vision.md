# Portico — the vision

> Synthesized by engineering from the owner's three briefs (`brief.md`, `operational-readiness-brief.md`,
> `adoption-integration-brief.md`). The briefs are the requirements; this page is the single picture of the
> outcome they add up to. When a decision is unclear, choose the option that best serves this page.

## In one sentence

**Portico is the hotel operating system you can trust at 2 a.m. and adopt without a leap of faith.**

## The problem we are actually solving

Hotels today are forced into two bad trades.

1. **Depth or ease.** Systems deep enough for a resort or a group (OPERA, Infor) take weeks to learn and fight
   their users. Systems that are pleasant (Mews, Cloudbeds, RoomRaccoon) run out of road when operations get
   complicated — groups, routing, receivables, multi-property, resort outlets.
2. **Stay or jump.** Changing PMS is a cliff: a big-bang migration, months of risk, lost history, and staff
   retraining, with no way to know beforehand whether the new system will cope with *your* operation.

And under both trades sits a third problem nobody advertises: **software that does not tell the truth.**
"Paid" when the payment only was requested. "Synced" when the channel silently failed. "Available" when the
room is out of order. A night audit that half-ran and nobody knows which half. Staff stop trusting the screen,
and the hotel starts running on WhatsApp messages and paper.

Portico removes all three: **depth without weight, adoption as a ramp instead of a cliff, and a system that
never pretends.**

## Who it is for

- **The 12-room guesthouse on a local island**, where the owner is the front desk, the revenue manager and the
  night auditor — usually from a phone. Portico must feel like a calm, finished product on day one.
- **The 120-villa resort**, where a seaplane delay ripples through check-in, dinner and a dive booking, where
  meal plans, allowances, transfers and outlets all land on one bill, and where finance must reconcile to the cent.
- **The regional or international group**, which needs central policies with visible local exceptions,
  portfolio reporting, enterprise identity, staged rollouts — and the freedom to keep systems it already likes.

One product, three postures. Complexity appears when a property turns it on, never before.

## The four pillars

### 1. Truthful operations — *the system never lies and never loses*

- One set of facts across departments. A room move, payment, out-of-order block or cancellation has the same
  consequences everywhere it appears.
- Every important record answers five questions at a glance: **what state is it in, what happened, what is
  wrong, who owns it, what can I do next.**
- Confirmed, pending, estimated, suggested, simulated, copied and external information look different. An
  authorization is never shown as a payment; a request is never shown as done.
- Interrupted work is resumable and self-describing: which steps completed, which did not, and how to finish.
- Money is exact: a double-entry ledger underneath, every correction traceable, retries never duplicate.
- **Trust is engineered, not designed**: row-level tenant isolation, idempotent commands, transactional events,
  optimistic concurrency, append-only audit. The UI can only be as honest as the data model beneath it.

### 2. Depth without weight — *OPERA's capability, a fraction of the effort*

- The full operational range — groups and blocks, billing rules and split folios, receivables, packages and
  allowances, Day Close, portfolio policies, resort itineraries — exists, but behind **progressive disclosure**:
  property profiles and plans decide what a property sees.
- **Role workspaces**: the front desk sees arrivals and blockers, housekeeping sees rooms and priorities,
  finance sees exceptions and balances, the GM sees the shape of the day. Nobody hunts through menus.
- **Previews before consequences**: every change that touches inventory, money or guests shows its effect
  before it is committed.
- Keyboard-fast at the desk, thumb-fast on the floor, offline-honest on a weak island connection.
- The measure is not features. It is fewer steps, less re-typing, faster training, fewer reconciliation
  problems and quicker recovery from mistakes — measured with real staff.

### 3. Adoption as a ramp — *value before commitment, every step reversible*

```
 Demo (minutes, sample data)  →  Trial (your data, isolated)  →  Read-only connection to your systems
   →  Replace one module (e.g. housekeeping, messaging, reporting)  →  Controlled pilot  →  Full platform
```

- A hotel can see **its own yesterday** inside Portico, with discrepancies against its current system shown for
  investigation — never silently "corrected".
- Every module that can stand alone is offered alone, with its dependencies stated plainly.
- For every data domain exactly one system is the **system of record**, and Portico enforces it. Two systems
  never silently fight over the same reservation, rate or room status.
- Integrations are described as **workflows** (read / create / update / receive changes; live / periodic /
  file), not logos. Setup is a guided journey ordinary staff can complete, with suggested mappings and a
  preview of behavior before activation.
- Migration is a product: inspectable, rehearsable, reconciled, signed off, recoverable — and rollback never
  erases what happened after cutover.

### 4. Honest readiness — *we only claim what we can prove*

- Every capability and integration carries its real status: planned, demonstrated, implemented, sandbox-tested,
  submitted, approved, configured for a hotel, piloted, generally supported. Technical work and external
  approval are tracked separately.
- Money responsibility is explicit: the **hotel's legal entity is the merchant**; Monoclay sells software and
  never holds guest funds. Monoclay's own revenue never mixes with hotel money.
- Costs are visible before they are incurred — ours and the hotel's — and the demo runs at near-zero cost
  with no possibility of charging a card, messaging a guest or publishing to a live channel.
- No badges, certifications, partner logos or "market-leading" claims without evidence.

## Moments that define Portico

If these feel effortless and trustworthy, the product is right. Each maps to an operational proof scenario.

| Moment | What "right" looks like |
|---|---|
| 07:30, arrivals rush | One board shows each arrival's readiness — room inspected, payment secured, requests prepared — and the single blocker to clear for each. |
| Two agents, last villa | One booking succeeds; the other sees "just sold — here are the alternatives" in under a second. |
| Seaplane delayed 3 hours | The itinerary ripples: check-in window, dinner reservation and the sunset dive are flagged with owners and one-tap rebooking. |
| Payment screen times out | The folio shows *pending verification*, never "paid" or "failed"; reconciliation resolves it and tells the agent. |
| Channel outage at peak | A plain banner: what is stale, since when, which bookings may be affected, what to do now. Nothing pretends to be synced. |
| Day Close stops at 02:10 | The auditor sees exactly which postings completed, presses resume, and nothing is posted twice. |
| A villa fails inspection as the guest lands | The desk is told before the guest arrives, with the next-best ready villa and the housekeeper already re-tasked. |
| Mistaken profile merge | One action reverses it, every linked record is restored, the audit shows both events. |
| Group policy change | The director sees which properties change, which keep local overrides, and confirms knowingly. |
| A trial hotel's first hour | They see last week's arrivals, rooms and balances in Portico, plus a short list of discrepancies with their old system to investigate. |

## What we will not do

- No mock presented as an integration, no file export presented as a live connection.
- No rip-and-replace ultimatum: hotels keep the systems they like until Portico earns the replacement.
- No guest money through Monoclay; no hard-coded tax rates or legal conclusions.
- No AI in the critical path: every critical operation works without it; AI drafts, finds, summarizes and
  proposes — humans approve consequences, and the model never invents availability, payments or policy.
- No shallow clones of payroll, procurement or ERP; we define clean boundaries and integrate.
- No speed bought by hiding errors, weakening permissions or skipping reconciliation.

## Product surfaces

| Surface | For | Character |
|---|---|---|
| **Back office** (web) | Desk, reservations, finance, revenue, management, admin | Dense, calm, keyboard-first, role workspaces, global search, saved views |
| **Staff mobile** (PWA) | Housekeeping, maintenance, guest relations, guesthouse owners | Large touch targets, quick actions, offline with visible sync status |
| **Guest journey** | Guests and bookers | Direct booking, pre-arrival, requests, payments, itinerary, checkout — never asks twice |
| **Connect & migrate** | Hotel IT, implementers, group teams | Guided setup journeys, mapping review, health, migration rehearsal |
| **Developer platform** | Partners and vendors | Scoped apps, sandboxes with sample data, versioned APIs, honest listings |
| **Operator console** (Monoclay) | Monoclay staff | Provisioning, support access with recorded reasons, platform health, cost guardrails |

## How we will know we have succeeded

- **Demonstration gate:** a stranger opens a browser and, within minutes, runs realistic Maldives scenarios —
  guesthouse, resort, group — with every external effect clearly simulated. Incremental spend: near zero.
- **Proof gate:** all 20 operational proof scenarios and the readiness-brief evidence items pass as automated
  tests through real product workflows, plus representative volume and multi-property load.
- **Trust gate:** in pilots, staff stop keeping side spreadsheets. The ledger reconciles daily with payment
  providers and channels, with zero unexplained differences.
- **Ease gate:** measured against named competitors with real staff: fewer steps per core task, shorter
  training per role, faster first connection, higher share of correctly suggested mappings. Recorded honestly
  as better, comparable or behind.
- **Adoption gate:** hotels move up the ramp because the evidence convinces them, not because a contract forces
  them. A pilot at one property never declares a whole group ready.

## How the three briefs fit

| Brief | Answers | Lives in |
|---|---|---|
| Product brief | *What must Portico do, and how must it feel?* | Modules, UX, the 20 scenarios |
| Operational readiness brief | *How do we prove it is real, and who is responsible for what?* | `docs/readiness/`, readiness register, launch gates |
| Adoption & integration brief | *How does a hotel get from curious to running on it?* | `docs/adoption/`, data authority, environments, integration module |

Portico is all three at once: **a deep, truthful operating system that hotels can adopt one safe step at a time.**
