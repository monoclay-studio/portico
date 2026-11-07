# Spec: comms

Status: Draft v1 · 2026-11-07 · Wave 2 · Schema `comms` · Prefix `COM`
Entitlements: `comms.inbox`, `comms.automation` (all editions — see editions.md); paid channels metered by
`usage.messages`.

## 1. Purpose

One place where every guest conversation lives with its context — who the guest is, which stay, which team owns
the reply, what has been promised, what is still open — so departments never send duplicate or contradictory
answers, multilingual guests are understood without losing the original words, and routine messages go out by
automation that staff can read, trust and stop.

## 2. Scope and non-goals

**In scope:** conversations, messages (original + translations), channels (email, SMS, WhatsApp, OTA messaging via
hub, web chat/guest portal), templates (localized), automations (trigger → reservation conditions → message
conditions → action, with waiting/expired states and run history), delivery tracking, consent enforcement for
marketing, quiet hours, staff collision prevention, conversation-to-task links, internal notes.
**Non-goals:** marketing campaigns and segmentation (integrate a CRM), reputation/review management (LATER via
hub), voice/telephony (LATER), guest portal UI (`apps/guest`, later wave), the tasks themselves (`operations`).

## 3. Capabilities

- **COM-R01** [MUST] Conversation: guest (profile), optional booking/stay, channel thread(s), responsible department
  and assignee, status `open | waiting_on_guest | waiting_on_staff | resolved`, priority, response-time target,
  labels; one conversation per guest per stay by default, merging threads from several channels.
- **COM-R02** [MUST] Message: direction, channel, sender (staff/automation/guest/system), **original text and
  language**, translations (machine, with provider and provenance "machine-translated"; staff may correct), attachments
  (scanned), delivery status (`queued → sent → delivered → read | failed`) from the provider, template/automation ref.
- **COM-R03** [MUST] **Collision prevention**: presence ("Mariyam is replying…"), soft lock on the reply composer per
  conversation, warning on send if another reply was sent since the composer opened, internal notes and @mentions
  for hand-offs between departments.
- **COM-R04** [MUST] **Requests → tasks**: staff (or AI suggestion, approved by staff) convert a message into a service
  request (operations); the conversation shows the task status; closing the conversation does not close the task;
  automatic guest update on task completion (optional per request kind).
- **COM-R05** [MUST] Templates per purpose and language with variables from booking/stay/guest/property; every
  template is classified **operational** (contractual/logistics; not consent-gated) or **marketing** (consent-gated per
  `guests` consent and legal entity); preview with real data before saving.
- **COM-R06** [MUST] **Automations** (`comms.automation`): trigger (event such as `reservations.booking.confirmed` or a
  time anchor relative to arrival/departure/ETA in property time), **reservation conditions** (which stays enter),
  **message conditions** (evaluated at send time), action (send template, create task, create payment request via
  payments, notify staff), owner; scheduled sends whose conditions are unmet enter **waiting** until met or
  **expired**; changes to the booking **re-evaluate** pending and sent steps (e.g. send "your dates changed" notice when
  a sent pre-arrival message referenced old dates); idempotency key `automation:{id}:{stayId}:{step}` prevents repeats;
  contradictory automations (same purpose, overlapping audience) are flagged at save.
- **COM-R07** [MUST] Run history per automation and per stay: evaluated, waiting, sent, skipped (why), failed (why),
  with links to messages.
- **COM-R08** [MUST] Quiet hours in the guest's local timezone where known (else property), per channel; urgent
  operational messages may override with permission.
- **COM-R09** [MUST] Channel providers via adapters (email first; SMS, WhatsApp Business via a provider; OTA messaging
  via the hub LATER) with sender verification status, template approval status (WhatsApp), per-message costs reported to
  `usage.messages`, fallbacks (e.g. WhatsApp failed → email) by policy; every send calls
  `assertExternalEffectAllowed(ctx, 'message.guest')` (simulated in demo/trial/training — messages appear in a
  simulated outbox).
- **COM-R10** [SHOULD] Response-time metrics and SLA alerts per department; shared views ("Unassigned", "Waiting on us >
  15 min").
- **COM-R11** [SHOULD] AI drafting and summarization through `ai` (suggestions, never auto-sent unless an automation
  explicitly uses a fixed template).

## 4. Entities and states

`conversation(id, property_id, profile_id, stay_id?, department_id, assignee_id?, status, priority, version)` ·
`message(id, conversation_id, direction, channel, sender, body_original, lang, translations jsonb, delivery_status,
provider_ref?, template_id?, automation_run_id?)` · `template(id, purpose, classification, locales jsonb, version)` ·
`automation(id, trigger, reservation_conditions, message_conditions, action, owner_id, status active|paused, version)` ·
`automation_run(id, automation_id, stay_id, step, state, scheduled_at, evaluated_at, outcome, reason)` ·
`channel_account(id, kind, provider, sender, verification_status)`.

**Conversation:** `open ⇄ waiting_on_guest ⇄ waiting_on_staff → resolved → open` (new inbound reopens).
**Message delivery:** `queued → sent → delivered → read` · `queued|sent → failed` · `queued → blocked` (environment or
consent; reason recorded).
**Automation run:** `scheduled → waiting → sent | expired | skipped | failed` · `scheduled → sent | skipped | failed` ·
`sent → superseded` (re-evaluation produced a follow-up).

## 5. Invariants

- **COM-I01** A marketing message is never sent without `granted` consent for its purpose and legal entity.
- **COM-I02** An automation step for a stay sends at most once (idempotency key).
- **COM-I03** In non-live environments no message reaches a real recipient.
- **COM-I04** Original message text is immutable; translations are stored separately with provenance.
- **COM-I05** A message shown as `delivered` or `read` has a provider confirmation.

## 6. Cross-module interactions

Calls `guests` (profile, contacts, consent, language), `reservations` (read: stays, bookings), `operations`
(createTask), `payments` (payment requests), `platform` (usage meters, environment), `integration` (provider and hub
connections), `ai` (drafts). Domain map arrow: `comms ─► guests, reservations (read), operations (tasks)`.

## 7. Events

`comms.message.received|sent|failed`, `comms.conversation.assigned|resolved`, `comms.automation.runCompleted`.
Consumed: reservations booking/stay events (triggers and re-evaluation), `payments.request.paid|expired`,
`operations.serviceRequest.completed`, `guests.consent.changed`, `guests.profile.merged|unmerged`.

## 8. Permissions

Implemented in role templates: `comms.conversation.manage`. Defined: `comms.conversation.read` ·
`comms.conversation.manage` · `comms.message.send` · `comms.template.manage` · `comms.automation.manage` ⚑ ·
`comms.channel.manage` ⚑ · `comms.quietHours.override` ⚑.

## 9. UX surfaces

Unified inbox (filters by department, assignee, status, channel; guest context side panel with stay, alerts, open
tasks, balance chip), conversation view with original/translation toggle, composer with templates and AI draft
(suggestion badge), automation builder (plain-language summary "2 days before arrival at 10:00, if no ETA, send
'Arrival details' in the guest's language"), run history.

## 10. Proof scenarios and evidence

| ID | Comms must demonstrate |
|---|---|
| S12 (supporting) | Transfer delay triggers a guest update and staff notifications without duplicates. |
| S20 (supporting) | Messaging provider outage: queued messages shown as queued/failed, fallback by policy, nothing shown as delivered. |
| E14 | `usage.messages` cap reached: paid sends blocked with recovery text; operational in-app notes unaffected. |
| A03 (adoption) | Messaging-only adoption alongside an external PMS: triggers from mirrored reservations; re-evaluation on PMS modifications. |

## 11. Maldives specifics

WhatsApp is a dominant channel for guest contact in the region (verify per property); multilingual guests (Chinese,
Russian, Italian, German, English) need translation with originals preserved; messages often concern transfer
logistics (flight details, seaplane timing) — templates for arrival details are core; Ramadan and local holiday
quiet-hour considerations per property policy.

## 12. Competitive inspirations

Guesty two-level automation with waiting/expired states and its gaps (no re-send after modification) (research 03
§6.2); unified inbox incl. WhatsApp — Hostaway/Guesty (research 03 §8.1, §13); automated SMS/WhatsApp pre-arrival —
Stayntouch (research 02 §4.2).

## 13. Open questions

Q45 (usage cost pass-through). Messaging provider accounts and WhatsApp business verification are external
dependencies tracked in the readiness register.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes — a primary "replace selected capabilities" module.**
- **Hard dependencies:** `platform`, `identity`, `guests` (mirror allowed), `reservations` mirror for context and
  triggers (via a PMS connector `reservations: read`), `integration` (channel providers). `operations` is optional
  (requests become tasks only if operations is active; otherwise they stay as conversation follow-ups).
- **Connected mode:** triggers fire on mirrored reservation changes (with provenance and freshness: an automation
  whose data is `delayed` beyond its tolerance waits rather than sending stale details); payment requests require
  Portico payments or are disabled.
- **Data-authority domains:** respects `reservations`, `guestProfiles` (contact edits forwarded or local per authority);
  owns conversations and consent evidence captured in Portico channels.
- **Trial:** all sends simulated into a visible simulated outbox; staff can review what *would* have been sent.
