# Parity matrix and edge cases: crm

Module: `crm` (segments, marketing consent enforcement and suppression, campaigns and lifecycle journeys,
abandoned-booking recovery, attribution, surveys and NPS, reputation and review replies, review solicitation, topics
and sentiment, recognition tiers and benefits, external programme numbers, gift vouchers, external CRM export).
Spec: `docs/specs/crm-marketing.md` (Draft v1, wave 3 surveys/reputation, wave 4 campaigns/recognition/vouchers,
prefix CRM), proposed by the guest-journey audit. Profiles, consent evidence and erasure are in `guests.md`; message
transport in `comms.md`. Researched 2026-11-07 by the parity-ops researcher. **No code exists** (`modules/crm` not
started), so every row is `specified`, `missing`, `deferred` or `different`.

**Baseline:** OPERA Cloud 26.3 *Membership* (Loyalty Cloud Service: tiers, points calculation and expiry, claims,
award redemption, pay with points, auto discounting), *external loyalty enrolment*, *profile e-certificates* and
*promotional e-certificates*, *mailing action codes*, *Responsys profile exports*, *profile subscription*.
**Specialists:** Revinate (reputation, guest feedback surveys, marketing with segmentation and cart abandonment),
TrustYou (review response features), Shiji ReviewPro (reputation across 140+ sources, surveys by department, case
management, guest communications; NH Hotel Group across 350 properties). Our research: R05 digest #33 (Lighthouse AI
agents free), §2 crm row (CRM consolidating into private-equity suites — Revinate, Cendyn; dailypoint around OPERA
migrations), R03 §13 (features to adopt), R04 C1 (GDPR consent and processor roles); journey coverage §1.4 (WhatsApp
marketing templates charged per delivered message). Mews, Cloudbeds, Apaleo, Guesty, RMS and RoomRaccoon document no
native campaign, survey or reputation suite found in this session; they integrate specialists (assumption). Portico
terms in the Capability column (segment, campaign, journey, survey, recognition tier, benefit, voucher, sender
register).
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches here — facts resting only on it are unverified; product pages and press are vendor claims. Priorities: P0
compete/pilot, P1 full-service/resort/group expectation, P2 differentiator or rare.

## Capabilities

### 1. Segments, consent and suppression

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-001 | Segments over profile attributes, stay history, spend by category, occasions, survey results and consent, evaluated at send time, with counts and consent breakdown | Revinate [marketing and segmentation][rev-mkt] · OPERA [Responsys profile exports][op-responsys] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R01 | — |
| PAR-CRM-002 | Segments across properties only within the organization's sharing policy and the user's visibility | assumption | P1 | specified | crm-marketing.md CRM-R01, CRM-I05; guests.md GUE-R16 | — |
| PAR-CRM-003 | Marketing consent re-checked per recipient, purpose and sending legal entity at send time | OPERA [profile subscription][op-subscription] · verified 2026-11-07 | P0 | specified | crm-marketing.md CRM-R02, CRM-I01 | — |
| PAR-CRM-004 | OTA proxy emails never used for marketing | assumption (R03 §9) | P0 | specified | crm-marketing.md CRM-R02 | — |
| PAR-CRM-005 | Suppression and fatigue: unsubscribe per legal entity and channel, bounces, complaints, in-house guests, recent detractors, frequency caps; reason per suppressed recipient | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R03 | — |

### 2. Campaigns and journeys

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-006 | Campaigns: segment, channel, marketing template, schedule in the recipient's time zone with quiet hours, preview with real data, test send, approval above an audience size | Revinate [marketing][rev-mkt] · OPERA [mailing action codes][op-mailing] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R04 [SHOULD] | — |
| PAR-CRM-007 | Per-recipient outcome (sent, delivered, failed, suppressed and why) and cost estimate before sending | journey coverage §1.4 (per-message pricing) | P1 | specified | crm-marketing.md CRM-R04 | — |
| PAR-CRM-008 | Lifecycle journeys (post-stay, anniversary, win-back, remarketing) on the comms automation semantics | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R05 [SHOULD] | — |
| PAR-CRM-009 | Abandoned-booking recovery with the lawful basis chosen by the hotel; never a lower price than seen unless a promotion is attached | Revinate [cart abandonment][rev-mkt] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R06 [SHOULD] | — |
| PAR-CRM-010 | Direct-booking attribution to campaigns and journeys with the attribution rule stated | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R07 [SHOULD] | — |
| PAR-CRM-011 | Drag-and-drop email designer with brand kit | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P2 | missing | — (comms templates are text with variables) | — |
| PAR-CRM-012 | A/B tests of subject line or content with automatic winner | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-CRM-013 | Direct-mail lists (printed mailings, labels) from mailing codes | OPERA [mailing action codes][op-mailing] · verified 2026-11-07 | P2 | missing | — | — |

### 3. Surveys and NPS

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-014 | Versioned surveys per language: NPS, ratings by department and outlet, free text, conditional questions, branding | Revinate [guest feedback][rev-feedback] · Shiji [ReviewPro surveys][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R08 | — |
| PAR-CRM-015 | In-stay pulse (day 2) and post-stay survey templates | Shiji [ReviewPro][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R08 | — |
| PAR-CRM-016 | Responses linked to the stay and to departments and outlets the guest used, for routing | Shiji [ReviewPro: by department and room type][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R08 | — |
| PAR-CRM-017 | Survey distribution by email, WhatsApp and the portal; one per stay per type; sender register prevents two tools asking | Shiji [ReviewPro][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R09, CRM-I02 | — |
| PAR-CRM-018 | A detractor or low department rating while the guest is on property opens a service-recovery case with owner and due time | Shiji [ReviewPro case management][shiji-reviewpro] · Revinate [guest feedback][rev-feedback] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R10; guest-services.md GSV-R08 | — |
| PAR-CRM-019 | Results by property, department, outlet, unit type, segment and period with response counts and small-sample notes | Revinate [guest feedback][rev-feedback] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R11 | — |
| PAR-CRM-020 | Competitive benchmark of reputation against a competitor set | Shiji [ReviewPro reputation][shiji-reviewpro] · verified 2026-11-07 | P2 | missing | — | — |

### 4. Reputation

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-021 | Review aggregation from OTAs, Google and TripAdvisor (manual import as labelled fallback): normalized score with original kept, language, stay match, provenance `external` | Revinate [reputation][rev-rep] · Shiji [ReviewPro: 140+ sources][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R12 [SHOULD] | — |
| PAR-CRM-022 | Replies drafted by staff or AI (labelled), approved where policy requires, published by API or copied to the extranet with a "posted" confirmation | TrustYou [response features (press)][ty-response] · Revinate [reputation][rev-rep] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R13 [SHOULD] | — |
| PAR-CRM-023 | Response-time targets and an unanswered-reviews view | Revinate [reputation][rev-rep] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R13 | — |
| PAR-CRM-024 | Review solicitation for direct, phone, agency and corporate guests; no incentives; no review gating by default | Revinate [guest feedback][rev-feedback] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R14 [SHOULD] | — |
| PAR-CRM-025 | Topics and sentiment across reviews and survey free text, drill-down count equals the trend count | Revinate [reputation][rev-rep] · Shiji [ReviewPro][shiji-reviewpro] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R15 [SHOULD] | — |
| PAR-CRM-026 | Social-media mentions monitored with reviews | Revinate [reputation][rev-rep] · verified 2026-11-07 | P2 | missing | — | — |

### 5. Recognition and loyalty

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-027 | Recognition tiers by stays, nights or spend over a period, group-wide or per property, computed nightly; manual grant with expiry | OPERA [membership tiers][op-tiers] · [Loyalty Cloud Service][op-loyalty] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R16 [SHOULD] | — |
| PAR-CRM-028 | Benefits by tier or occasion (welcome amenity, late check-out, upgrade priority, member rate, common-area access) shown on the arrival recognition summary | OPERA [membership auto discounting][op-memberdisc] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R17 [SHOULD] | — |
| PAR-CRM-029 | External programme numbers (airline, brand, partner) on the profile with verification state; exported per stay for crediting | OPERA [external loyalty enrolment][op-extloyalty] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R18 | — |
| PAR-CRM-030 | Points programme: accrual, expiry, award redemption, pay with points, as a finance liability | OPERA [points and awards][op-points] · [redeeming awards][op-redeem] · [pay with points][op-paypoints] · verified 2026-11-07 | P2 | deferred | crm-marketing.md CRM-R19 [LATER] (monetary liability; owner question Q87) | — |
| PAR-CRM-031 | Membership claims for missing stay credit | OPERA [membership claims][op-claims] · verified 2026-11-07 | P2 | deferred | crm-marketing.md CRM-R19 [LATER] (with points) | — |
| PAR-CRM-032 | Member-only rates in the booking engine | OPERA [membership auto discounting][op-memberdisc] · verified 2026-11-07 | P2 | deferred | crm-marketing.md CRM-R17 (rates RAT-R10 LATER, enabled by SCR-17) | — |
| PAR-CRM-033 | Explicit enrolment in the recognition programme with consent at booking or check-in | OPERA [Loyalty Cloud Service][op-loyalty] · verified 2026-11-07 | P2 | missing | — (tiers are computed from history; no enrolment step) | — |

### 6. Gift vouchers

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-034 | Voucher products: monetary or experience, validity, eligible outlets or charge codes, transferability, partial redemption, terms per language | OPERA [profile e-certificates][op-ecert] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R20 [SHOULD] | — |
| PAR-CRM-035 | Sale through the booking engine, portal, desk and outlets; issued as a stored-value liability with its tax rule | OPERA [profile e-certificates][op-ecert] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R21, CRM-I04 | — |
| PAR-CRM-036 | Delivery as PDF, email or WhatsApp to buyer or recipient on a chosen date; resend; delivery status | assumption | P1 | specified | crm-marketing.md CRM-R22 | — |
| PAR-CRM-037 | Redemption as a tender on folios, at the booking engine or outlets; partial redemption keeps the remainder | OPERA [promotional e-certificates][op-promoecert] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R23 | — |
| PAR-CRM-038 | Expiry and breakage per terms and jurisdiction; extensions with reason; refunds through payments | assumption | P1 | specified | crm-marketing.md CRM-R24 | — |
| PAR-CRM-039 | Fraud controls: ≥ 80-bit random codes, rate-limited lookups, full code to redeem, audited voids, blocking | assumption | P1 | specified | crm-marketing.md CRM-R25 | — |
| PAR-CRM-040 | Complimentary vouchers for service recovery or marketing against a configured expense account | OPERA [promotional e-certificates][op-promoecert] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R21 | — |

### 7. External CRM, privacy and control

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-CRM-041 | Export of profiles, stays, spend and consent with evidence to an external CRM; opt-outs and tags back | OPERA [Responsys profile exports][op-responsys] · R05 digest §2 crm row · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R26 [SHOULD] | — |
| PAR-CRM-042 | Native campaigns or surveys switched off per property when an external tool is the named sender | assumption | P1 | specified | crm-marketing.md CRM-R26, CRM-R09 | — |
| PAR-CRM-043 | Surveys, reputation and review solicitation next to an external PMS; mirrored consent treated as unknown unless evidence is supplied | assumption | P1 | specified | crm-marketing.md §14 | — |
| PAR-CRM-044 | Permissions: segments, campaigns, campaign approval ⚑, journeys ⚑, surveys, responses, reviews, reply approval, recognition, vouchers ⚑, export ⚑ | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P1 | specified | crm-marketing.md §8 | — |
| PAR-CRM-045 | No campaign, survey, invitation or reply reaches a real recipient or platform outside live | assumption | P0 | specified | crm-marketing.md CRM-I06 | — |
| PAR-CRM-046 | Marketing history per guest (what was sent, delivered, answered) on the profile | Revinate [marketing][rev-mkt] · verified 2026-11-07 | P2 | missing | — (survey responses on the profile only, CRM-R10) | — |
| PAR-CRM-047 | Marketing data included in data-subject export and erasure | R04 C1 | P1 | specified | guests.md GUE-R17, GUE-R18 (module contributors) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-CRM-001 | A segment matches 1,240 guests; 610 have marketing-email consent for the sending legal entity | Only the 610 receive it; the others are listed as suppressed with the reason | P0 | specified | — |
| EC-CRM-002 | Consent is withdrawn after the campaign was scheduled | Skipped at send time with "consent withdrawn" | P0 | specified | — |
| EC-CRM-003 | A post-stay journey would fire for a guest who is back in house | Suppressed (in-house rule) unless the journey is an in-stay journey | P1 | specified | — |
| EC-CRM-004 | A guest with an open complaint is in a promotion segment | Suppressed per policy until the case closes | P1 | specified | — |
| EC-CRM-005 | A guest already received three marketing messages this month | Frequency cap suppresses the fourth with the reason | P1 | specified | — |
| EC-CRM-006 | An OTA alias email lands in a segment | Excluded from marketing; recorded as suppressed | P0 | specified | — |
| EC-CRM-007 | A campaign's audience exceeds the approval threshold | Needs `crm.campaign.approve` ⚑ from someone other than the creator | P1 | specified | — |
| EC-CRM-008 | A WhatsApp marketing campaign to 5,000 guests | Cost estimate shown before sending from usage rates; the cap is enforced | P1 | specified | — |
| EC-CRM-009 | A trial organization sends a campaign | Simulated; no real recipient reached (CRM-I06) | P0 | specified | — |
| EC-CRM-010 | A day-2 pulse returns NPS 3 for housekeeping | Service-recovery case with owner and due time while the guest is still on property | P1 | specified | — |
| EC-CRM-011 | An existing survey tool also sends post-stay surveys | Portico's surveys stay off until the sender register names Portico (one sender per type) | P1 | specified | — |
| EC-CRM-012 | An outlet has three survey responses this month | Result shown with a small-sample note | P2 | specified | — |
| EC-CRM-013 | A review is matched to the wrong stay | Suggested match needs staff confirmation; corrections audited; never auto-linked without a reservation reference | P1 | specified | — |
| EC-CRM-014 | A review is written in Chinese | Original kept with translation beside; reply drafted in Chinese and approved before publishing | P1 | specified | — |
| EC-CRM-015 | A published reply is edited on the platform | Portico keeps a new version linked to the platform state; the published version is never changed in place | P2 | specified | — |
| EC-CRM-016 | API access to a review source is not granted | Manual import labelled as such; replies copied to the extranet with a "posted" confirmation | P1 | specified | — |
| EC-CRM-017 | A manager wants to invite only guests with high survey scores | Off by default; enabling needs an explicit acknowledgement that the platform's rules permit it | P1 | specified | — |
| EC-CRM-018 | An OTA-booked guest checks out | Not invited to review by default (OTAs invite their own guests) | P1 | specified | — |
| EC-CRM-019 | A cancelled or adjusted stay changes a guest's tier qualification | Tier recomputed nightly with the reason; benefits adjusted from the next stay | P2 | specified | — |
| EC-CRM-020 | The same voucher is redeemed at the desk and at an outlet at the same moment | One redemption succeeds (idempotent per code and reference; value lives in finance) | P1 | specified | — |
| EC-CRM-021 | A non-partial voucher is used for a smaller bill | Refused or applied in full per the product terms; the guest sees why | P1 | specified | — |
| EC-CRM-022 | A voucher expires with a balance | Breakage posted per policy; an extension needs permission and a reason | P1 | specified | — |
| EC-CRM-023 | Someone tries voucher codes repeatedly | Lookups rate-limited; full code required; alert on repeated failures | P1 | specified | — |
| EC-CRM-024 | A paid voucher is refunded | Refund through payments; the liability is reversed by finance; never deleted | P1 | specified | — |
| EC-CRM-025 | A USD voucher is redeemed on an MVR-denominated outlet bill | Redeemed in the voucher's currency with conversion per finance rules shown to the guest | P2 | missing | — |
| EC-CRM-026 | A cheaper rate appears after a booking was abandoned | The reminder never shows a lower price unless a promotion is explicitly attached | P1 | specified | — |
| EC-CRM-027 | A guest in active segments asks for erasure | Removed from segments and journeys; a minimal suppression record (keyed hash) prevents re-adding from imports | P1 | missing | — |
| EC-CRM-028 | The external CRM sends back an opt-out | Recorded as a consent withdrawal with the external source as evidence | P1 | specified | — |
| EC-CRM-029 | Two profiles with different tiers are merged | Survivor's tier recomputed from the combined history with the reason; unmerge restores both | P2 | missing | — |
| EC-CRM-030 | An anniversary journey would reach a guest for whom the occasion is sensitive | Staff can suppress the occasion for that guest; journeys honour it | P2 | missing | — |
