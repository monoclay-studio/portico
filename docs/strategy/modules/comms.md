# comms — 10x brief (unified guest conversations, templates, automations)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2d; email needed before a pilot) · Spec
`docs/specs/comms.md` (COM-R01–R11) · Parity: **none** (planned on `docs/parity-ops`) · Source key:
`docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **No `comms` module exists.** Modules that need it work around it: payments creates links that staff must send
  (README-payments PAY-R19 gap); integration's notifier queues staff messages but never delivers (README-identity
  branch); reservations' confirmations (PAR-RES-020) and "notify guest when the unit is ready" (PAR-RES-117,
  PAR-OPS-032 draft) are unbuilt. Platform's tenth data-authority domain `guestCommunications` exists on the
  identity-plus branch (sender register for coexistence).
- **No parity file**, so no competitor baseline is recorded for messaging.
- **Owner questions:** Q84 guest-facing AI answers; Q25 AI processing of guest data.

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Unified inbox + automation engine | Guesty | OTA, email, SMS in one inbox; two-level conditions (reservation vs message), time anchors on ETA/ETD, waiting and expired states, condition library, tag scoping — **but** sent messages are not re-sent after an alteration | R03 §6.2 |
| WhatsApp in the inbox | Hostaway | Unified inbox incl. WhatsApp; owner portal | R03 §8.1 |
| Messaging bundled in the PMS | Mews OS Guest Messaging (May 2026) | Part of the OS | DD02c §2; DD02b §1.2 |
| AI front office | Canary (AI Voice, Webchat; 20,000+ properties) | Guest-facing AI | DD02c §2 |
| Status-to-task | Mews | Exceptions become tasks | R02 §2.7 |
| Research | António et al. | Contacting likely-to-cancel bookings reduced cancellations (A/B in production) | DD03 §5.2 |

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Email channel with honest delivery states (queued, sent, delivered, bounced, failed — simulated in non-live) and a sender register so Portico and an external system never both send the same message | COM-R09; `guestCommunications` authority |
| 2 | Conversation with context (guest, stay, owner team, promises, open requests) and collision prevention between departments | COM-R01–R03 |
| 3 | Templates per purpose and language with variables from booking/stay/guest/property; previews | COM-R05 |
| 4 | Automations with trigger/condition/action, waiting/expired states **and re-evaluation on booking change**, idempotent steps, run history per automation and per stay | COM-R06, R07 (beats Guesty's known gap) |
| 5 | Requests → owned tasks (operations); "done" only when the task is done | COM-R04 |
| 6 | Quiet hours in the guest's timezone; urgent override | COM-R08 |
| 7 | WhatsApp Business and SMS via providers; OTA messaging via hub | COM-R09 |
| 8 | Translation with the original preserved | COM-R02 |
| 9 | Response-time SLAs and shared views; AI drafts and summaries (via `ai`, never auto-sent without an automation rule) | COM-R10, R11 |
| 10 | Confirmation/reconfirmation tied to no-show risk | DG §2 comms row; DD03 §5.1 |

## 4. The 10x outcome (TARGETS)

**Picture:** the butler, the spa and the front desk all see one conversation with the guest's stay beside it; when the
spa starts typing a reply the butler sees it; the honeymoon couple's Russian message is shown translated with the
original one tap away; the pre-arrival message re-plans itself when the seaplane changes; and no guest ever gets two
contradictory answers or a "paid" message for an unpaid booking.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Duplicate or contradictory replies to one guest message across departments | — | 0 (collision prevention + single owner) |
| Powerful | Automated messages that went out with stale facts after a booking change | Guesty does not re-send after alteration (R03 §6.2) | 0 (re-evaluation on change) |
| Seamless | Reply to a guest with context | baseline to measure | ≤ 60 s, inbox only, 0 duplicate replies (UXP §19) |
| Friendly | Automations staff can read: trigger, conditions, action, owner, history (brief §14) | — | 100% of automations; every run explains why it sent, waited or skipped |
| Well-rounded | Channels with honest delivery state | — | email (pilot), WhatsApp, SMS, OTA via hub; each R4 before live |
| Well-rounded | Languages with preserved original | — | every inbound message; templates in ≥ 3 languages for a pilot (EN + guest top markets: ZH, RU per DD09 §1) |

## 5. Next 3 increments

### Increment 1 — Email, honest delivery, sender register
- Module skeleton; `message.guest` and `message.staff` effects through `assertExternalEffectAllowed` (simulator in
  non-live, provider adapter in live); delivery state machine; sender register per message purpose honouring the
  `guestCommunications` authority; templates with variables and previews; delivery of payment links (payments), booking
  confirmations (reservations), invoices/receipts (finance) and staff invitations (identity notifier).
- **Acceptance:** each consumer's message goes out once under retries (idempotency key per purpose and ref); bounce →
  owned exception; demo/trial never sends; parity file written with the parity workstream.

### Increment 2 — Conversations and requests
- Conversation aggregate (guest, stay, owner team, status, promises), message with original + translations, collision
  prevention (who is replying), requests → operations tasks with status mirrored back, quiet hours; universal record
  contract and search provider.
- **Acceptance:** COM-R01–R04, R08 tested; a request is "done" only when the task is verified; unmerge of profiles
  covers comms items (guests R12 gap closed jointly).

### Increment 3 — Automations that re-evaluate
- Trigger/condition/action engine with waiting/expired states, time anchors on ETA/ETD, re-evaluation on every booking
  or stay change (cancel or re-plan pending sends), idempotent steps, run history per automation and per stay;
  reconfirmation workflow for arrivals at risk (rule-based signals first).
- **Acceptance:** COM-R06, R07 tested incl. a booking change between scheduling and sending; automation history readable
  by staff; no automation sends outside quiet hours unless marked urgent.

## 6. Cross-module dependencies and contract changes

**guests:** consent per purpose, contact verification, language. **reservations/resort:** events with versions; ETA
changes. **operations:** tasks from requests. **payments/finance/identity:** delivery port. **ai:** drafts and summaries.
**crm:** campaigns and surveys reuse channels and suppression. **integration:** OTA messaging via hub; external
messaging system authority. **platform:** quiet-hours and sender policies.

## 7. Power check — never lose or hide

Original messages are never altered by translation; consent and quiet hours are enforced; one sender per purpose when
another system coexists; "sent" is never shown before the provider confirms; automations never act silently — every run
is explained; AI drafts are suggestions unless an approved automation sends them.
