# Spec: crm (CRM, marketing, feedback, reputation, recognition, vouchers)

Status: Draft v1 · 2026-11-07 · Proposed by the guest-journey audit (`docs/journey/`) · Wave 3 (surveys, reputation,
review requests) / Wave 4 (campaigns, recognition, vouchers) · Schema `crm` · Prefix `CRM`
Entitlements (proposed, SCR-03): `crm.surveys` (all editions), `crm.reputation` (all editions; external review sources
may carry hub/vendor fees), `crm.campaigns` (Professional+), `crm.recognition` (Professional+), `crm.vouchers`
(add-on); paid sends metered by `usage.messages` (Q45).

## 1. Purpose

Everything after "thank you for staying" — and the reasons a guest comes back — in one place that respects consent:
ask how the stay went and act on bad answers the same day; see and answer every public review; invite happy guests
to review without breaking platform rules; recognise returning guests; sell and honour gift vouchers; and send the
occasional relevant offer only to people who agreed to receive it. A guesthouse owner should be able to answer this
morning's Booking.com review from a phone; a group should see NPS and review scores across islands with the
complaints that caused them.

`crm` decides **who** and **what**; `comms` remains the only transport for guest messages (templates, delivery,
quiet hours, sender register); `guests` remains the owner of profiles and consent evidence; `finance` owns money
(voucher liabilities).

## 2. Scope and non-goals

**In scope:** segments, consent and suppression enforcement for marketing, campaigns and lifecycle journeys
(post-stay, anniversary, win-back, remarketing), abandoned-booking recovery, attribution of direct revenue to
campaigns, surveys and NPS (in-stay pulse, post-stay), low-score alerts → service recovery, review aggregation from
OTAs/Google/TripAdvisor, reply drafting/approval/publication, sentiment and topic tagging, review solicitation,
recognition tiers and benefits, external loyalty membership numbers, gift vouchers (products, sale, delivery,
redemption, expiry), integration with external CRMs for organizations that keep one.

**Non-goals:** message transport and templates (`comms`), consent evidence storage (`guests` GUE-R06), operational
messages (confirmations, pre-arrival logistics — `comms` automations), service recovery execution (`guest-services`),
loyalty **points** with monetary liability (LATER, Q87), paid advertising management, website analytics, a full
marketing-automation suite for enterprises (integrate).

## 3. Capabilities

### 3.1 Segments, consent and suppression

- **CRM-R01** [MUST] **Segments**: saved rules over profile attributes (language, nationality, VIP, tags, recognition
  tier), stay history (property, dates, nights, unit type, rate plan, source/channel, market segment, spend by
  category from `guests` history), occasions (anniversary, birthday month), survey results, and consent state;
  evaluated at send time; counts shown with consent breakdown ("1,240 match; 610 have marketing-email consent for
  Kandu Resorts Pvt Ltd"). Segments over another property's guests require `guests.profile.readShared` and the
  organization's sharing policy (GUE-R16, Q46).
- **CRM-R02** [MUST] **Consent enforcement**: a marketing send requires `granted` consent for the purpose
  (`marketing_email`, `marketing_whatsapp`, `marketing_sms`) **and** the sending legal entity (GUE-R06, COM-I01);
  `profiling` consent is required where policy says segmentation beyond service needs it; OTA proxy emails
  (GUE-R09 low-confidence contacts) are never marketed to; consent is re-checked per recipient at send time.
- **CRM-R03** [MUST] **Suppression and fatigue**: global unsubscribe per legal entity and channel, hard bounces,
  complaints, guests currently in house (unless the journey is in-stay), recent negative survey or open complaint
  (policy), frequency cap per guest per period; each suppressed recipient has a recorded reason.

### 3.2 Campaigns and journeys

- **CRM-R04** [SHOULD] **Campaigns** (`crm.campaigns`): segment, channel, `comms` template classified **marketing**,
  schedule in the recipient's timezone with quiet hours (COM-R08), preview with real data, test send to staff,
  approval (`crm.campaign.approve` ⚑ when audience > policy size), send through `comms` with effect
  `message.marketing` (SCR-04; simulated outside live), per-recipient outcome (sent, delivered, failed, suppressed and
  why), cost estimate before send from `usage.messages` rates (WhatsApp marketing templates are charged per delivered
  message [V-web, journey coverage §1.4]).
- **CRM-R05** [SHOULD] **Lifecycle journeys**: trigger (stay checked out, survey answered, anniversary − n days,
  no stay for n months, booking abandoned) → waits → conditions → actions (send template, create task, create
  voucher, add tag); built on the `comms` automation engine semantics (waiting/expired/run history, COM-R06/R07)
  with marketing classification enforced; one journey per purpose per property (contradiction check at save).
- **CRM-R06** [SHOULD] **Abandoned-booking recovery**: `distribution` emits `distribution.checkout.abandoned`
  (SCR-39) only when the guest entered an email and the booking engine's notice permits a reminder under the
  applicable rules (policy `crm.abandoned.lawfulBasis`: `consent` default | `legitimate_interest`, decided by the
  hotel with advice); one reminder within a configurable window with the same search pre-filled; never includes a
  price lower than the guest saw unless a promotion is explicitly attached.
- **CRM-R07** [SHOULD] **Attribution**: direct bookings carry campaign/journey/source parameters captured by the
  booking engine (SCR-39); reports show bookings, room nights and revenue per campaign with the attribution rule
  stated (last touch within n days).

### 3.3 Surveys and NPS

- **CRM-R08** [MUST] **Survey definitions** (`crm.surveys`): versioned questions per language (NPS 0–10, ratings by
  department/outlet, free text, multiple choice), conditional questions, branding; templates for in-stay pulse
  (day 2) and post-stay (day 1 after checkout); a response is linked to stay, property, departments and outlets
  touched (from folio and itinerary) so results can be routed.
- **CRM-R09** [MUST] **Distribution** through `comms` (operational-feedback classification decided by policy and
  market advice: `feedback` purpose consent, SCR-22) and the guest portal; one survey per stay per type; the
  **sender register** (CR-9) must name Portico as sender of post-stay surveys before activation, so an existing
  survey tool and Portico never both ask.
- **CRM-R10** [MUST] **Alerts and recovery**: a detractor score (≤ policy threshold, default 6) or a low department
  rating in an in-stay pulse creates a `guest-services` service-recovery case with owner and due time while the guest
  is still on property; post-stay detractors create a follow-up case; responses are visible on the guest profile
  history (GUE-R14).
- **CRM-R11** [MUST] **Results**: NPS and ratings per property, department, outlet, unit type, segment and period
  with response counts and confidence note for small samples; metric definitions in the analytics catalog (SCR-42);
  free-text with topics (CRM-R15).

### 3.4 Reputation

- **CRM-R12** [SHOULD] **Review aggregation** (`crm.reputation`): reviews from OTAs via the channel hub's reviews
  capability (Channex messaging and reviews add-on — readiness brief §5 baseline +$7/property/month, unverified per
  channel), Google Business Profile and TripAdvisor where API access is granted (dependency register, SCR-09), and
  manual import (CSV/paste) as a labelled fallback; each review stored with source, rating scale normalised to 0–10
  with the original kept, language and original text (translation alongside, COM-R02 style), stay match (by
  reservation reference where provided, else suggested match for staff confirmation), and provenance `external`.
- **CRM-R13** [SHOULD] **Replies**: draft (staff or AI suggestion via `ai`, labelled suggestion), approval by
  `crm.review.approveReply` when policy requires, publication through the source's API where supported (new effect
  `reputation.publish`, SCR-04 — simulated outside live) or "copy and open the extranet" with a manual "posted"
  confirmation; published replies are immutable in Portico and versioned if edited on the platform; response-time
  targets and an unanswered-reviews view.
- **CRM-R14** [SHOULD] **Review solicitation**: invite guests from direct, phone, agency and corporate bookings to
  review on chosen platforms (OTA-booked guests are excluded by default — OTAs invite their own guests); no
  incentives and no "review gating" (inviting only guests with good survey scores is off by default and requires an
  explicit policy acknowledgement that the platform's rules permit it); invitations go through `comms` with
  consent per SCR-22.
- **CRM-R15** [SHOULD] **Topics and sentiment** for reviews and survey free text (rule-based keywords per language;
  AI tagging optional via `ai` with budget) → trends per topic (cleanliness, food, transfers, Wi-Fi), each topic
  linking to the underlying reviews (drill-down equals count).

### 3.5 Recognition and loyalty

- **CRM-R16** [SHOULD] **Recognition tiers** (`crm.recognition`): tiers by stays, nights or spend over a period,
  per organization (group-wide) or property; computed nightly from `guests` history; tier changes with reason;
  manual tier grant with permission and expiry.
- **CRM-R17** [SHOULD] **Benefits**: rules attached to tiers/occasions — welcome amenity (creates a `guest-services`
  amenity order), late checkout eligibility, upgrade priority (flag for assignment ranking INV-R22), member-only rate
  eligibility (RAT-R10 LATER → enabled by SCR-17), common-area access (`access` groups); benefits appear on the
  recognition summary (GUE-R15) so the desk sees them at arrival.
- **CRM-R18** [MUST] **External programme numbers** (airline, brand or partner programmes): captured on the profile
  with programme, number and verification state; exported per stay for partner crediting (file) — Portico does not
  operate those programmes.
- **CRM-R19** [LATER] **Points programme** with accrual/redemption as a liability in `finance` (Q87).

### 3.6 Gift vouchers

- **CRM-R20** [SHOULD] **Voucher products** (`crm.vouchers`): monetary (amount, currency) or experience (a defined
  package, e.g. "Sunset cruise for two", with its charge codes and a monetary value for accounting), validity
  period, eligible outlets/charge codes, transferability, partial-redemption allowed or not, design per language,
  terms text (versioned).
- **CRM-R21** [SHOULD] **Sale** through the booking engine (`distribution` voucher shop page), the guest portal, and
  the desk/outlet; payment via `payments` (hotel = merchant, D2); on confirmed payment `finance` issues the voucher
  as a **stored-value liability** (SCR-26) with a unique, non-guessable code and the tax treatment given by the
  voucher's tax rule (`taxPoint: issue | redemption` as rule data — Q83); complimentary vouchers (service recovery,
  marketing) are issued against a configured expense/marketing account with permission.
- **CRM-R22** [SHOULD] **Delivery** as PDF/e-mail/WhatsApp to the buyer or recipient with a scheduled delivery date;
  resend allowed; delivery status from `comms`.
- **CRM-R23** [SHOULD] **Redemption** as a tender: on a folio, at the booking-engine checkout, or at an outlet —
  through the `payments` voucher adapter (SCR-29) which asks `finance` to apply the stored value (idempotent
  `voucher:{code}:{redemptionRef}`); balance and history visible; partial redemption leaves the remainder when
  allowed.
- **CRM-R24** [SHOULD] **Expiry and breakage**: expiry per product terms and jurisdiction rules (Q83); breakage
  posted by `finance` per policy at expiry (like FIN-R20 for allowances); extensions with permission and reason;
  refunds of unredeemed paid vouchers through `payments` (never deletion).
- **CRM-R25** [SHOULD] **Fraud controls**: codes are random (≥ 80 bits of entropy), rate-limited lookups, redemption
  requires the full code, voids are permissioned and audited, a voucher can be blocked with reason.

### 3.7 External CRM and marketing systems

- **CRM-R26** [SHOULD] Organizations that keep an external CRM/marketing/survey tool (e.g. Salesforce, Revinate-class,
  ReviewPro-class): `integration` workflow `crmProfiles` exports profiles, stays, spend summaries and **consent with
  evidence** (W-CRM-01), receives back opt-outs and segment tags where supported; native campaigns and/or surveys are
  then disabled per property and the sender register names the external system (one sender per message type).

## 4. Entities and states

`segment(id, scope, rules jsonb, owner_id, version)` · `campaign(id, property_ids, segment_id, channel, template_ref,
schedule jsonb, status, approval_ref?, version)` · `campaign_recipient(campaign_id, profile_id, outcome, reason?,
message_ref?)` · `journey(id, trigger, steps jsonb, status, version)` · `journey_run(id, journey_id, profile_id,
stay_id?, step, state, reason?)` · `survey(id, kind, versions jsonb, status)` · `survey_invitation(id, survey_id,
stay_id, channel, status)` · `survey_response(id, invitation_id, answers jsonb, nps?, submitted_at, case_ref?)` ·
`review(id, property_id, source, external_id, rating_original, rating_normalised, language, text_original,
translations jsonb, stay_match jsonb, posted_at, status)` · `review_reply(id, review_id, draft, approved_by?,
published_at?, publish_method, external_ref?, version)` · `recognition_tier(id, scope, rules jsonb)` ·
`profile_tier(profile_id, tier_id, since, until?, reason)` · `benefit_rule(id, tier_id | occasion, action jsonb)` ·
`external_membership(profile_id, programme, number_hash, number_enc, verified)` · `voucher_product(id, kind,
terms jsonb, status, version)` · `voucher_sale(id, product_id, buyer_ref, recipient jsonb, payment_ref,
finance_voucher_ref?, delivery_status)`.

**Campaign:** `draft → scheduled → sending → completed` · `draft|scheduled → cancelled` · `scheduled → awaiting_approval
→ scheduled`. **Survey invitation:** `scheduled → sent → answered | expired` · `scheduled → suppressed`.
**Review:** `new → acknowledged → replied | no_reply_needed` · reply `draft → approved → published | copied_manually`.
**Voucher** (balance and states held in `finance`, SCR-26): `issued → partially_redeemed → redeemed` · `issued →
expired | voided | refunded`.

## 5. Invariants

- **CRM-I01** No marketing message is sent to a recipient without `granted` consent for that purpose and legal entity
  at send time (extends COM-I01).
- **CRM-I02** A stay receives at most one survey invitation per survey kind.
- **CRM-I03** A published reply is never modified in place; edits create a new version linked to the platform's
  state.
- **CRM-I04** Voucher value exists only in `finance` (liability); `crm` holds no balances; redemption is idempotent per
  `(code, redemptionRef)`.
- **CRM-I05** Segment counts shown to a user include only profiles the user may see.
- **CRM-I06** In non-live environments no campaign, survey, invitation or reply reaches a real recipient or
  platform.

## 6. Cross-module interactions

Calls `guests` (profiles, consent, history, recognition summary contribution), `comms` (template sends, sender
register, delivery status), `guest-services` (service-recovery cases, amenity orders for benefits), `finance`
(voucher issue/void/breakage via SCR-26), `payments` (voucher sale payments), `ai` (reply drafts, topic tagging),
`integration` (review sources, external CRM), `platform`. Reads `reservations` (stays, via events and queries) and
`analytics` facts. Called by `distribution` (voucher redemption goes to `payments`, not here — no cycle) and
`guest-experience` (survey links, recognition).

### Proposed contract changes (SCR-01)

Module row `crm` (schema `crm`); arrows `crm ─► guests, comms, guest-services, finance, payments, ai, integration,
platform`; `guest-experience ─► crm`. New `guests.getConsentBatch(tx, { profileIds, legalEntityId, purpose })`.

## 7. Events

Emitted: `crm.campaign.completed`, `crm.survey.responded {nps?, detractor}`, `crm.review.received|replied`,
`crm.tier.changed`, `crm.voucher.sold`. Consumed: `reservations.stay.checkedIn|checkedOut`,
`reservations.booking.confirmed` (attribution), `distribution.checkout.abandoned`, `guests.consent.changed`,
`guests.profile.merged|unmerged`, `comms.message.failed`, `finance.voucher.redeemed|expired`.

## 8. Permissions

`crm.segment.read` · `crm.segment.manage` · `crm.campaign.manage` · `crm.campaign.approve` ⚑ · `crm.journey.manage` ⚑ ·
`crm.survey.manage` · `crm.survey.readResponses` · `crm.review.read` · `crm.review.reply` · `crm.review.approveReply` ·
`crm.recognition.manage` · `crm.voucher.sell` · `crm.voucher.manage` ⚑ (products, comp vouchers, voids, extensions) ·
`crm.export.run` ⚑.

## 9. UX surfaces

Reputation inbox (unanswered first, by platform, with stay context and suggested reply), survey dashboard with
detractor list and open cases, campaign builder with consent breakdown and cost estimate, journey builder (plain
language summary like comms automations), recognition panel on the profile, voucher shop configuration, voucher
lookup/redeem at the desk and outlet app, group view of NPS and review scores per property. Guesthouse profile:
"Reviews to answer" and "Last week's guests' scores" on the owner's phone; everything else hidden until enabled.

## 10. Proof scenarios and evidence

| ID | CRM must demonstrate |
|---|---|
| E14 (supporting) | `usage.messages` cap reached: campaign stops with recovery text; surveys via portal still work; operations unaffected. |
| S15 (supporting) | Profile merge/unmerge re-points survey responses, tiers and voucher buyer references exactly. |
| A01 | Trial: campaigns, invitations and replies land in the simulated outbox; no platform call. |
| J06 (proposed, SCR-06) | In-stay pulse score 4 for "dinner": case for F&B manager due in 2 h, resolved with an amenity; post-stay NPS 9; review invitation sent (direct booking) and reply published; all linked on the profile. |
| J07 (proposed) | Gift voucher sold online, redeemed partially on a folio and at the spa, remainder expires; liability, breakage and payments reconcile to the minor unit. |

## 11. Maldives specifics

OTA review scores are a primary demand driver for guesthouses [A] — reply-from-phone matters most for the
guesthouse profile; multilingual reviews (Chinese, Russian, Italian, German) need originals preserved; WhatsApp is
the likely survey and campaign channel and its marketing templates are paid per message [V-web]; group resorts
compare islands; anniversary returns and honeymoon-to-anniversary marketing are a resort pattern [A]; vouchers for
spa and dining sold to Malé residents and expatriates for staycations [A]; tax point for vouchers under MIRA's
time-of-supply rule is unverified (Q83).

## 12. Competitive inspirations

- Guest experience and reputation as a bundled tier — Cloudbeds "Experience" (research 03 §3); dedicated reputation
  and guest-feedback tools in the Shiji ecosystem (ReviewPro) and marketing platforms (dailypoint) noted in the
  coverage matrix §5.8.
- Guest recognition across properties — Shiji Daylight (research 01 §5.2).
- Improvement: one consent model shared with operations, review replies with approval and immutable history,
  vouchers as a real liability with breakage instead of a "gift card" list outside the ledger.

## 13. Open questions

Q82 (review platform access and the paid reviews add-on), Q83 (voucher tax point and expiry rules), Q84 (AI drafts
of public replies are suggestions only — guest-facing automation), Q87 (points programme), Q45 (usage costs).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** for surveys, reputation and review solicitation (P1 — a classic
  module hotels add without changing PMS); campaigns and recognition **conditional** on profile and stay mirrors with
  consent; vouchers **no** (they need Portico `finance`/`payments` as tender and liability) unless a later forward
  workflow posts voucher redemptions to the external folio.
- **Hard dependencies:** `platform`, `identity`, `guests` (mirror allowed), `reservations` mirror (stays,
  checkout events), `comms` (transport), `integration` (review sources).
- **Connected mode:** consent captured in Portico channels is Portico-authoritative evidence (GUE §14); consent
  mirrored from the PMS is `external` and treated as `unknown` for marketing unless the connector supplies evidence.
- **Data-authority domains:** owns none of the nine; proposes that **survey and review-request sending** are entries
  in the `guestCommunications` sender register (G-06, SCR-05).
- **Trial:** reviews can be imported read-only for analysis; no replies, invitations or campaigns leave the trial.
