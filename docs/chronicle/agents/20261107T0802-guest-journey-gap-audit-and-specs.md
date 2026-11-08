# Agent run: Guest journey gap audit and specs

- Started: 2026-11-07T08:02:08.303Z · last activity: 2026-11-07T11:16:04.819Z
- Turns: 79 · tool uses: 172 · output tokens: 196,395
- Type: general-purpose

## Brief (2026-11-07T08:02:08.303Z)

````text
You are Portico's guest-journey auditor. The owner noticed that door locks / key cards had no module and asked us to find EVERYTHING else we missed: "go through an entire guest stay. Portico needs to solve all of a hotel's problems from pre-reservation to reservation to check-out and follow up." Your job: an exhaustive, practical audit of the guest journey for every property type (12-room Maldivian guesthouse, 120-villa Maldives resort with seaplane transfers, city hotel, serviced apartments, multi-property group), then specs for the gaps.

WORK ONLY in the git worktree /home/user/wt/journey (branch docs/guest-journey-audit). Only create/edit files under docs/journey/ and NEW spec files under docs/specs/ (do not edit existing specs — put proposed changes to existing specs in docs/journey/spec-change-requests.md). You may append owner questions to docs/OPEN_QUESTIONS.md numbered from Q80 upward. Commit with Conventional Commits ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do not push. Do not ask questions.

READ FIRST: CLAUDE.md, docs/product/vision.md, the three briefs in docs/product/, docs/product/glossary.md, docs/architecture/domain-map.md, ALL specs in docs/specs/ (18 files — they are what exists/planned), docs/scenarios/README.md, docs/adoption/adoption-paths.md and integration-coverage-matrix.md, docs/readiness/dependency-register.md, docs/readiness/maldives-tax-rules.md, docs/research/*.md.

A separate agent is auditing BACK-OF-HOUSE (accounting/GL/AP, F&B POS & kitchen, procurement, stock, workforce/HR, utilities, concessions) in another worktree — reference those areas but do not spec them.

DELIVER:
1. docs/journey/guest-journey-coverage.md — stage-by-stage map: (a) Discover & decide (website/CMS, booking engine, metasearch & Google free booking links, OTA content, rate parity, promotions, gift vouchers/cards, enquiries via email/WhatsApp/chat, quotes/proposals, DMC/tour-operator & wholesale contracting — critical in the Maldives: static contracts, allotments, release periods, seasonal contracted rates, combinable offers like early-bird/free-nights/honeymoon), (b) Book (confirmation, payments, special requests, celebrations, arrival flight capture), (c) Pre-arrival (pre-arrival messaging, online check-in with registration card/ID capture/e-signature/payment authorization, Maldives IMUGA traveller-declaration reminder, transfer planning incl. seaplane daylight-only operations and transit-hotel nights in Malé/Hulhumalé, upsells, preference propagation to departments: dietary/allergies to kitchen, amenities, butler/host assignment, kids club), (d) Arrival (airport meet & greet, transfer manifests, jetty arrival, registration card, ID scan, incidental authorization, KEYS — RFID cards/wristbands/mobile keys via lock systems, Wi-Fi credentials, luggage/bell desk tracking, buggy dispatch, villa orientation, early check-in/day rooms), (e) In-stay (requests, in-villa dining, restaurant table reservations, dine-around/meal-plan allowances, bar tabs, minibar consumption & audits, laundry, spa, excursions/diving with certification & waivers & equipment, kids club, inter-island transfers, concierge third-party bookings, call accounting/telephony, Wi-Fi tiers, in-room entertainment, room moves/extensions, mid-stay check-ins & service recovery, complaints, incidents/security log, medical clinic charges, lost & found, wake-up calls, turndown, DND, celebrations, currency exchange at front desk, retail, photography, charge-to-room validation incl. posting privileges/credit limits/no-post flags, guest locator & emergency muster list, weather disruptions), (f) Departure (express checkout, e-folio, settlement & split tenders, tax invoice within 3 days per MIRA, key deactivation, luggage, departure transfer timed to flights, late checkout/departure lounge, deposit/hold release, gratuities), (g) Post-stay (thank-you, surveys/NPS, review solicitation & reputation management with replies, complaint follow-up, lost-and-found shipping, late charges, company/TA invoicing, travel-agent commission processing, loyalty/recognition, remarketing & re-booking, data retention). For EVERY touchpoint: who does it (role), system(s) involved, Portico module that covers it, coverage status (built / specified / planned / MISSING / integration-only), the external dependency if any (e.g. lock vendor, PBX, Wi-Fi gateway), Maldives specifics, and priority (P0 pilot-critical / P1 / P2). Be exhaustive — aim to surface things a hotel GM would list.
2. docs/journey/gap-register.md — every MISSING or partial item, with proposed owning module (existing or new), priority, dependencies, and whether Portico builds it natively, integrates, or both (per the adoption brief's "retain systems they like").
3. NEW specs (same structure as existing specs incl. §14 Adoption modes) for the new guest-facing modules you recommend. At minimum:
   - docs/specs/access.md — door locks, key encoders, RFID wristbands, mobile keys (issue/duplicate/extend/cancel on move/checkout; lock vendors ASSA ABLOY Vostio/Visionline, dormakaba, Salto, etc. via local connector where needed; manual fallback; environment safety 'access.key'; audit of every key event).
   - docs/specs/guest-experience.md — guest portal / web app (no app install): pre-arrival, online check-in with ID & e-signature, upsells, itinerary, requests, chat, digital folio, express checkout, feedback; plus kiosk mode.
   - docs/specs/crm-marketing.md (or split): guest segmentation, campaigns with consent, abandoned-booking recovery, surveys/NPS, reputation management (review aggregation & replies), loyalty/recognition, gift vouchers.
   - docs/specs/contracting.md — tour operator / DMC / wholesale contracts (Maldives-critical): contract seasons, contracted net rates, allotments & release, stop-sale, offers & combinability, rooming lists from tour operators, commission vs net models, statements.
   - In-stay services not covered elsewhere (table reservations, minibar, laundry, call accounting/telephony & Wi-Fi integrations, incidents/security & medical, luggage/bell desk, buggy dispatch, concierge, emergency muster) — either a `guest-services` spec or proposed additions to operations/resort via spec-change-requests.
4. docs/journey/README.md summarizing the top 25 gaps ranked by impact on a Maldives pilot and on the vision ("a hotel operating system you can trust at 2 a.m. and adopt without a leap of faith").
Use web search where it adds verified facts (e.g. Maldives IMUGA declaration rules, seaplane operating hours, common lock vendors' integration models), citing URLs with "verified 2026-11-07"; label assumptions. Final reply (~300 words): top gaps, new modules proposed, files, questions added.
````

## Follow-up message (2026-11-07T08:02:08.303Z)

````text
You are Portico's guest-journey auditor. The owner noticed that door locks / key cards had no module and asked us to find EVERYTHING else we missed: "go through an entire guest stay. Portico needs to solve all of a hotel's problems from pre-reservation to reservation to check-out and follow up." Your job: an exhaustive, practical audit of the guest journey for every property type (12-room Maldivian guesthouse, 120-villa Maldives resort with seaplane transfers, city hotel, serviced apartments, multi-property group), then specs for the gaps.

WORK ONLY in the git worktree /home/user/wt/journey (branch docs/guest-journey-audit). Only create/edit files under docs/journey/ and NEW spec files under docs/specs/ (do not edit existing specs — put proposed changes to existing specs in docs/journey/spec-change-requests.md). You may append owner questions to docs/OPEN_QUESTIONS.md numbered from Q80 upward. Commit with Conventional Commits ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do not push. Do not ask questions.

READ FIRST: CLAUDE.md, docs/product/vision.md, the three briefs in docs/product/, docs/product/glossary.md, docs/architecture/domain-map.md, ALL specs in docs/specs/ (18 files — they are what exists/planned), docs/scenarios/README.md, docs/adoption/adoption-paths.md and integration-coverage-matrix.md, docs/readiness/dependency-register.md, docs/readiness/maldives-tax-rules.md, docs/research/*.md.

A separate agent is auditing BACK-OF-HOUSE (accounting/GL/AP, F&B POS & kitchen, procurement, stock, workforce/HR, utilities, concessions) in another worktree — reference those areas but do not spec them.

DELIVER:
1. docs/journey/guest-journey-coverage.md — stage-by-stage map: (a) Discover & decide (website/CMS, booking engine, metasearch & Google free booking links, OTA content, rate parity, promotions, gift vouchers/cards, enquiries via email/WhatsApp/chat, quotes/proposals, DMC/tour-operator & wholesale contracting — critical in the Maldives: static contracts, allotments, release periods, seasonal contracted rates, combinable offers like early-bird/free-nights/honeymoon), (b) Book (confirmation, payments, special requests, celebrations, arrival flight capture), (c) Pre-arrival (pre-arrival messaging, online check-in with registration card/ID capture/e-signature/payment authorization, Maldives IMUGA traveller-declaration reminder, transfer planning incl. seaplane daylight-only operations and transit-hotel nights in Malé/Hulhumalé, upsells, preference propagation to departments: dietary/allergies to kitchen, amenities, butler/host assignment, kids club), (d) Arrival (airport meet & greet, transfer manifests, jetty arrival, registration card, ID scan, incidental authorization, KEYS — RFID cards/wristbands/mobile keys via lock systems, Wi-Fi credentials, luggage/bell desk tracking, buggy dispatch, villa orientation, early check-in/day rooms), (e) In-stay (requests, in-villa dining, restaurant table reservations, dine-around/meal-plan allowances, bar tabs, minibar consumption & audits, laundry, spa, excursions/diving with certification & waivers & equipment, kids club, inter-island transfers, concierge third-party bookings, call accounting/telephony, Wi-Fi tiers, in-room entertainment, room moves/extensions, mid-stay check-ins & service recovery, complaints, incidents/security log, medical clinic charges, lost & found, wake-up calls, turndown, DND, celebrations, currency exchange at front desk, retail, photography, charge-to-room validation incl. posting privileges/credit limits/no-post flags, guest locator & emergency muster list, weather disruptions), (f) Departure (express checkout, e-folio, settlement & split tenders, tax invoice within 3 days per MIRA, key deactivation, luggage, departure transfer timed to flights, late checkout/departure lounge, deposit/hold release, gratuities), (g) Post-stay (thank-you, surveys/NPS, review solicitation & reputation management with replies, complaint follow-up, lost-and-found shipping, late charges, company/TA invoicing, travel-agent commission processing, loyalty/recognition, remarketing & re-booking, data retention). For EVERY touchpoint: who does it (role), system(s) involved, Portico module that covers it, coverage status (built / specified / planned / MISSING / integration-only), the external dependency if any (e.g. lock vendor, PBX, Wi-Fi gateway), Maldives specifics, and priority (P0 pilot-critical / P1 / P2). Be exhaustive — aim to surface things a hotel GM would list.
2. docs/journey/gap-register.md — every MISSING or partial item, with proposed owning module (existing or new), priority, dependencies, and whether Portico builds it natively, integrates, or both (per the adoption brief's "retain systems they like").
3. NEW specs (same structure as existing specs incl. §14 Adoption modes) for the new guest-facing modules you recommend. At minimum:
   - docs/specs/access.md — door locks, key encoders, RFID wristbands, mobile keys (issue/duplicate/extend/cancel on move/checkout; lock vendors ASSA ABLOY Vostio/Visionline, dormakaba, Salto, etc. via local connector where needed; manual fallback; environment safety 'access.key'; audit of every key event).
   - docs/specs/guest-experience.md — guest portal / web app (no app install): pre-arrival, online check-in with ID & e-signature, upsells, itinerary, requests, chat, digital folio, express checkout, feedback; plus kiosk mode.
   - docs/specs/crm-marketing.md (or split): guest segmentation, campaigns with consent, abandoned-booking recovery, surveys/NPS, reputation management (review aggregation & replies), loyalty/recognition, gift vouchers.
   - docs/specs/contracting.md — tour operator / DMC / wholesale contracts (Maldives-critical): contract seasons, contracted net rates, allotments & release, stop-sale, offers & combinability, rooming lists from tour operators, commission vs net models, statements.
   - In-stay services not covered elsewhere (table reservations, minibar, laundry, call accounting/telephony & Wi-Fi integrations, incidents/security & medical, luggage/bell desk, buggy dispatch, concierge, emergency muster) — either a `guest-services` spec or proposed additions to operations/resort via spec-change-requests.
4. docs/journey/README.md summarizing the top 25 gaps ranked by impact on a Maldives pilot and on the vision ("a hotel operating system you can trust at 2 a.m. and adopt without a leap of faith").
Use web search where it adds verified facts (e.g. Maldives IMUGA declaration rules, seaplane operating hours, common lock vendors' integration models), citing URLs with "verified 2026-11-07"; label assumptions. Final reply (~300 words): top gaps, new modules proposed, files, questions added.
````

## Follow-up message (2026-11-07T11:13:08.350Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (you were on the access spec; check `git status` — commit any uncommitted file first). Finish the remaining deliverables and your final report as originally specified.

Address this before completing your current task.
````

## Report (2026-11-07T11:16:04.549Z)

````text
The guest-journey audit is finished and committed on branch `docs/guest-journey-audit` in `/home/user/wt/journey`. There are 6 commits on top of f7dd056, including one "wip(journey): checkpoint" commit you asked for. Nothing was pushed. It is all documentation, so no tests were run.

**What the audit found.** I mapped 235 guest touchpoints across 7 stages and the five property types. None of them is built yet (only the platform and identity foundations exist). 33% are specified, 27% partially specified, 4% planned, 2% left on purpose to other systems or back-of-house, and 34% are missing.

**Top gaps** (P0 = pilot-critical, P1 = next):
1. Tour-operator/DMC contracting (P0): seasons, market-specific rates, supplements, combinable offers, allotments with release dates, stop-sales, and an automatic check of each operator's voucher against the contract.
2. Door keys (P0): a manual key log, room-move and checkout rules, and an honest checkout status ("expires at" or "collect") for locks that can't be cancelled remotely.
3. Emergency muster list, guest locator and offline snapshot (P0).
4. Allergies reaching every kitchen and outlet, with acknowledgement (P0).
5. Tax invoice within 3 days, plus delivering it to the guest (P0).
6. Charge-to-room privileges and credit limits (P0).
7. Green Tax 12-hour checkout rule and verified child ages (P0).
8. A booking confirmation the immigration desk will accept (P0).
9. Nationality per guest for the Ministry's tourism statistics system (TIMS) (P0).
10. Guest portal and online check-in (P1).
11. Seaplane cut-off times and Malé transit nights (P1).

The other 14 of the top 25 are ranked in `docs/journey/README.md`.

**New modules (one spec each):** `access`, `guest-experience`, `crm` (in `crm-marketing.md`), `contracting`, `guest-services`. Each follows the existing spec structure, including §14 Adoption modes. They add no dependency cycles.

**Files:**
- `docs/journey/README.md`: summary, top 25, proposed wave sequencing
- `docs/journey/guest-journey-coverage.md`
- `docs/journey/gap-register.md`: 62 gaps, each with owner module, build/integrate/both, priority and dependencies
- `docs/journey/spec-change-requests.md`: SCR-01 to SCR-46, changes to existing specs plus proposed journey scenarios J01–J12
- `docs/specs/access.md`, `guest-experience.md`, `crm-marketing.md`, `contracting.md`, `guest-services.md`

**Merge notes:**
- `main` moved on after this branch was cut and now has `docs/parity/` and a "Universal record contract" rule. I didn't touch either; SCR-46 records what the five new modules owe them.
- No new specs conflict with `main`. `docs/OPEN_QUESTIONS.md` changed on both sides but at different lines, so it should merge cleanly.

**Sources:** facts from the web are cited with "verified 2026-11-07", but they came from search-result extracts, not the pages themselves. That covers IMUGA, visa on arrival, seaplane daylight hours, the 30 m dive limit, lock-vendor integration models, the Wi-Fi login pattern and WhatsApp pricing. Two points are still unresolved:
- Whether departing travellers must also file the IMUGA declaration: sources conflict.
- The exact seaplane cut-off: secondary sources only. `transmaldivian.com` and `mfr.mv` didn't resolve from this environment.

**Questions added (Q80–Q87), each with a default so nothing is blocked:** lock-vendor partner programmes; whether contracting is in the first pilot slice; review-platform access and the paid reviews add-on; voucher tax treatment and expiry; guest-facing AI; a paid flight-status feed; incident/medical record duties and retention; loyalty points versus recognition only.
````

