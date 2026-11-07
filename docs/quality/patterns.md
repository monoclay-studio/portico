# Attack, test and UX-trap pattern library

Each P0 and P1 class found by any review, generalized so that **any module can be checked for it**. Each entry has:

- **Seen in:** the finding that taught us the class. File references point to `docs/orchestration/reviews/` unless
  stated otherwise.
- **Probe:** what a reviewer, or a builder in self-check, actually runs.
- **Applies to:** where to look first.
- **Canary:** the seeded defect in `canaries.md` that tests whether checkers run the probe.

**How it is used.**
- Steward reviewers sweep every applicable pattern and declare the result
  (`playbooks/steward-reviewer.md`, SR2-1).
- Builders run the AP probes for their module before "done" (`playbooks/module-builder-self-check.md`).
- Parity researchers turn applicable classes into edge-case rows (`playbooks/parity-researcher.md`, PR2-2).
- The **UX-** traps are probes for UI reviews (SR2-5) and lab traps for L4 canaries.
- **The black-box tester never reads this file.** Its traps are hidden in the lab build instead.
- **Examples are illustrations, not boundaries (added in round 2).** The "Seen in" and "Applies to" lists show where a
  class has appeared; they do not limit it. Mark a pattern "not applicable" only with a reason about the **class**,
  never because the module is missing from the examples. The fix sweep marked AP-56 not applicable because erasure
  was not among its examples, and an erasure race then survived (E-083).

**Maintenance.** This file is append-only by ID. A new class gets the next free number in its group. A pattern that
proves useless is marked *retired* with a date, never deleted.

## Test-harness conventions used in the probes

- Two tenants come from `createTestTenant()`. Inside one tenant there are two properties, A and B, and users scoped
  `@A`, `@B` and `@none` (no grants).
- "Concurrent" means at least two `withTenantTx` transactions started together. The test must prove that the second one
  waited on the first one's lock, or must assert the invariant after N=10 runs. A sequential simulation is not enough.
- "Reverse order" means running the same attack with the actors' order swapped (see AP-08).
- Every probe ends by asserting the invariant, not only the HTTP status.

---

## A. Isolation, authorization and identity

### AP-01 · Cross-property reference: the caller's declared scope is checked, the record's scope is not
- **Seen in:**
  - payments P0-1: USD 777 posted onto a folio at property B by a desk user scoped to A;
  - guests G-P1-1 and G-P1-3: B's private items edited, and B's passport numbers exported;
  - integration F12;
  - identity R2-P2-2: `transferMember` without a property.
- **Probe:** for every mutation and read that takes a record id plus a `propertyId`, act as user `@A` with
  `propertyId = A` but a record id from B. The call must be refused (404 or `scope_mismatch`) and nothing may be
  written. Repeat for delegated or provider calls made through ports (ADR-0015): the provider must check that the
  referenced record belongs to the passed property and legal entity.
- **Applies to:** finance, payments, reservations, guests, operations, integration, every port provider.
- **Canary:** C-L2-01.
- **Round 1:**
  - Integration-step P1-1 (E-039): folios were checked, but **booking** refs were exempted ("first deposit: finance
    binds the booking on posting"). A Hiyani desk agent posted onto Kandu's booking, and so did a deposit for a booking
    that does not exist anywhere.
  - **Probe addition:** for every ref type a provider accepts (folio, booking, stay, account), run the A/B probe and
    the non-existent-id probe. **Grep for exemptions**: early `return`s and comments such as "first X is accepted".
- **Round 2:** fix sweep SW-PAY-3 (E-065). P0-1's fix checked the ledger target but not the **card**. A user who cannot
  read a method saved at property B charged it USD 2,500 onto an A folio. **Probe addition:** apply the A/B probe to
  **every record-valued parameter** of the command (method, authorization, request, account, VCC), not only to its
  target. A record the actor cannot read at the acting property cannot be a parameter of a command there.

### AP-02 · Cross-tenant access by id (per-table isolation)
- **Seen in:**
  - identity P2-13: most new tables had no isolation test, including `mfa_factors`, where P0-2 sat;
  - CLAUDE.md §6 (P0 by definition).
- **Probe:** build a per-table suite from `information_schema.tables` for the module's schema. Every table must have a
  cross-tenant read test and a write test that both return 404, and must have RLS **enabled and forced**. The suite
  fails when a table is added without being classified.
- **Applies to:** every module, and every new migration.
- **Canary:** C-L2-02.
- **Round 1:** identity R3-P3-1 (E-052). Tests run migrations as the superuser, so RLS-dependent logic inside
  `SECURITY DEFINER` "visit each tenant" functions is never exercised under RLS (PoC W-6). **Probe addition:** run the
  isolation suite with a migration owner that has `nobypassrls`, and give each definer function explicit tenant
  predicates.

### AP-03 · Claimable external identifier: unique per tenant only
- **Seen in:**
  - payments P0-2: a Stripe account could be registered by any org, and `route_webhook` returned 2 rows, of which it
    took `rows[0]`;
  - identity P0-2(b): an email domain on an SSO allow-list without proof of ownership;
  - identity P1-8: SSO matched people by the mutable `email` claim, not by `(issuer, sub)`, and accepted a missing
    `email_verified` (the "nOAuth" class).
- **Probe:** register the same external identifier in tenant 2. Examples: provider account id, webhook endpoint, SSO
  issuer or domain, OTA hotel code, channel property id, door-lock site id. The registration must be refused, or must
  require proof of ownership. Inbound routing on that identifier must resolve to exactly one tenant. Status fields that
  only the provider may set (for example `active`, fees) must not be writable by the tenant.
- **Applies to:** payments, integration, distribution, identity SSO, access (keys).
- **Canary:** C-L2-03.

### AP-04 · Trust attribute declared by the client
- **Seen in:**
  - rates R-04: the client declared its own channel, `bookingDate` and `companyId`;
  - payments P1-8: `initiator: 'customer'` bypassed the merchant-initiated-transaction agreement;
  - payments P0-2: the tenant set `status: active` and the application fee;
  - rates R-05: the terms "hash" was an unkeyed SHA-256 described as tamper detection, and `/v1/quotes/reprice`
    accepted client-supplied terms and returned them freshly sealed.
- **Probe:** list every request field that changes eligibility, price, liability or authority. Send each one forged.
  The server must derive it from the principal, the record or configuration, or reject it. Also send back a
  server-issued document (sealed terms, a preview token, a signed link) with one field changed. The server must verify
  a **keyed** seal before using it, and must never re-seal content the client supplied.
- **Also SSO:** after the first link, match people on `(issuer, sub)`, never on a mutable attribute, and require
  `email_verified === true`.
- **Applies to:** rates, payments, reservations (channel ingestion), integration, identity.
- **Round 1:** integration-step P2-3 (E-046). `priceChange` verified the seal, but the adapter fed unverified
  documents to `evaluateCancellationPenalty` and `instantiatePaymentSchedule`; nulling the policies gave a penalty of 0.
  **Probe addition:** tamper with the stored document and call **every** function that reads it, not only the one the
  original finding named.

### AP-05 · Ungated secondary endpoint, or a route reachable by the wrong role
- **Seen in:**
  - operations P0-2: `/sync/mutations` had no permission check;
  - guests P2: `snapshotProfile` was public and unchecked;
  - backoffice / L4 (E-029): a role reached a workspace by URL.
- **Probe:** enumerate **all** routes (`fastify.printRoutes`) and every exported service function. Call each as
  `@none`, and as a user of another property. Every one must refuse before reading. For UI, request each route as each
  persona role; the screen must not render data the server would refuse.
- **Applies to:** every module, plus `apps/backoffice` routes.

### AP-06 · Permission checked but never registered (catalogue drift)
- **Seen in:** E-014 `platform.dataAuthority.manage`. The guard is now `apps/api/test/permission-catalog.test.ts`.
- **Probe:** run the catalogue test on the merged tree. Grep `requirePermission(` and compare against the manifests.
- **Applies to:** every module.
- **Canary:** C-L1-02.

### AP-07 · An organization controls a person's global credential
- **Seen in:**
  - identity P0-1: another org set a member's password;
  - identity P0-2: another org stripped or replaced MFA.
- **Probe:** for each global attribute (password, MFA factors, recovery codes, email, SSO links, API keys, sessions),
  try to change it as an admin of org X for a person with **any** membership elsewhere, in any status (`invited`
  included). The change must be refused, or must require proof of the person's existing factor.
- **Applies to:** identity, support access, SCIM, SSO.

### AP-08 · Pre-hijacking: the attacker acts **before** the victim exists
- **Seen in:**
  - identity R2-P0-1 (E-001): an org minted a global identity, with its own password, for an email it did not own;
  - identity R2-P1-3 (E-003): a pre-created SSO link skipped the domain gate later.
- **Probe:** **reverse the order.** For every "victim exists, then the attacker acts" test, also run "the attacker
  creates the identity, link, account or record first; the legitimate owner arrives later". Ask the question: *who
  controls this email, identity, domain or external account before the person or hotel does?* Credentials set by
  anyone except the verified owner must be wiped at first verification.
- **Applies to:** identity (users, invitations, SSO, SCIM), payments (connected accounts), integration (connections,
  webhook endpoints), guests (profile claims), guest-experience (guest accounts).
- **Canary:** C-L2-08.

### AP-09 · A delegated permission that is equivalent to an administrator
- **Seen in:**
  - identity R2-P1-1 (E-002): `identity.sso.manage` could repoint the issuer and impersonate the admin;
  - identity P2-16: SCIM provision is equivalent to the mapped roles;
  - identity P1-5: `identity.security.manage` could self-designate break-glass;
  - identity P1-6: `identity.role.assign` could revoke the last admin.
- **Probe:** for each delegable permission, list what it reaches **transitively**: configure an IdP, mint keys, map
  roles, designate break-glass, change data authority. If that set includes admin, the permission must be marked
  admin-equivalent and guarded like a root change (owner approval, power check, alert).
- **Applies to:** identity, platform, integration (credentials), payments (account management).
- **Round 1:** identity R3-P1-2 (E-048). Root changes were enumerated (issuer, allow-list, `trustIdpMfa`,
  SSO-required), so `groups_claim`, `jit_provisioning` and `client_id` stayed delegable, and a re-pointed groups claim
  gave `org_admin`.
  - **Probe addition:** for each delegable configuration **field**, ask: does this field decide who signs in, or which
    roles a sign-in grants? If yes, it is a root change.
  - Recommend the **principle**, not a list.

### AP-10 · Separation of duties satisfied by one person
- **Seen in:**
  - identity P1-4: the requester approved with an API key they had issued;
  - R2-P2-4: the approval came from a second identity the requester had created.
- **Probe:** have the requester approve through their API client, a support session, a break-glass session, and a
  second account they created or granted. Every attempt must be refused (`human_approval_required` or a
  provenance-of-grant check).
- **Applies to:** platform activation, data-authority transitions, configuration rollouts, finance approvals, refunds
  above a threshold.

### AP-11 · Windows where step-up or MFA is bypassed
- **Seen in:** identity P1-2 (a 72-hour grace that restarts) and P1-3 (API keys with ⚑ permissions, no expiry, no
  step-up).
- **Probe:** list every path to a ⚑ permission without a fresh factor: grace windows, re-activation, API keys,
  IdP-asserted `amr`, elevated sessions, idempotent replays. Each path must be closed or bounded and alerted.
- **Applies to:** identity, and every module with ⚑ permissions.

### AP-12 · A brute-force or rate limit is keyed wrongly, or is a race
- **Seen in:**
  - identity P1-7: limited per challenge, not per account;
  - R2-P2-1 (E-005): check-then-act on the per-person counter;
  - P1-8: limits per IP while the IP was spoofable.
- **Probe:**
  - Send N concurrent wrong attempts (N = pool size, or 10). At most `limit` attempts may be evaluated.
  - Check the key: per account, per person, and per IP behind a trusted proxy.
  - The reservation must be atomic: `update … set attempts = attempts + 1 where … returning`, or a row lock, before
    the code is verified.
- **Applies to:** identity (password, TOTP, recovery, confirm), guest portal codes, payment links, API keys.
- **Canary:** C-L2-12.

### AP-13 · Client IP spoofing through `X-Forwarded-For`
- **Seen in:** identity P1-8. `packages/http` set `trustProxy: true`; it was fixed on main in `739e671` with
  `TRUSTED_PROXY_CIDRS`.
- **Probe:** rotate `X-Forwarded-For` on every request from one client. Per-IP limits must still trigger (429).
  Check that the deployed `TRUSTED_PROXY_CIDRS` is the load balancer's subnet, never `0.0.0.0/0`.
- **Applies to:** `packages/http`, infra, and every per-IP control.

### AP-14 · Server-side request forgery on outbound calls
- **Seen in:**
  - integration F1: `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, `[fe90::1]`, `localhost.`, any port, and DNS
    names resolving to private addresses;
  - identity P2-2: the SSO issuer could be `http://localhost` in production.
- **Probe:**
  - Point each configurable outbound URL (webhooks, IdP issuer, JWKS, connector base URLs, image fetches) at the bypass
    list: IPv4-mapped IPv6, link-local, the metadata addresses `169.254.169.254` and `fd00:ec2::254`, decimal and octal
    IPs, a trailing dot, a single-label name, a redirect to a private address, a disallowed port, and a DNS name that
    resolves to `127.0.0.1`.
  - Zero connections may reach the local listener.
  - The call must go through the shared `safeFetch` (resolve and pin).
- **Applies to:** integration, identity, payments, comms, distribution, AI.
- **Canary:** C-L2-07.
- **Round 2:** SW-INT-1 (E-072). The RFC 2765 IPv4-translated form `::ffff:0:a.b.c.d` (`::ffff:0:0:0/96`) was not
  decoded. Add it to the bypass list.

### AP-15 · Secrets or credentials persisted, returned or replayable
- **Seen in:**
  - identity P0-1: the reset link came back in the HTTP response;
  - identity P2-7: the plaintext API key was stored in the idempotency table;
  - guests FR-1: idempotency replay was not bound to the caller.
- **Probe:**
  - After each credential-issuing flow, scan the idempotency records, audit before/after, outbox payloads, logs and
    HTTP responses for the secret value.
  - Replay the `Idempotency-Key` as a different user of the same org: it must not return the stored body.
- **Applies to:** identity, payments (tokens), integration (credentials), guests (PII in create responses).

### AP-16 · Cached or session state leaks across users on a shared device
- **Seen in:** backoffice P0-1. After the session expired, the next user on the same tab saw the previous user's staff
  list and workspaces.
- **Probe:** user 1 opens sensitive data. The session expires with a 401. User 2, with fewer permissions, signs in on
  the same tab. No request may have been made for user 2's view, and nothing of user 1's may render: no cached rows,
  no account label, no saved views. Query keys must include `userId`. `localStorage` must hold no personal data after
  sign-out.
- **Applies to:** `apps/backoffice`, `apps/staff` (offline caches), `apps/guest`.
- **Canary:** C-L2-11. The black-box form is UX-15.

### AP-17 · Personal data remains after erasure
- **Seen in:**
  - guests G-P0-1: duplicate keys held the plaintext email, merge decisions held the date of birth, and consent
    evidence held an IP address;
  - integration F18: raw guest data sat in append-only tables;
  - integration F6: guest names were in the outbox.
- **Probe:** plant 15 distinctive values on one guest. Use them in merge, duplicate, consent, documents, exports and
  integration. Erase the guest. Then scan **every** table of the schema (driven by `information_schema`), plus the
  tenant's outbox, audit, idempotency records and file stores, for each value. Every hit must be classified as
  legally retained, with a reason, or the test fails.
- **Applies to:** guests, integration, comms, finance (payer names), reservations.
- **Canary:** C-L2-10.
- **Round 2:** SW-GUE-1 (E-067). After erasure, `core.idempotency_keys` still held the name and date of birth, and
  **replaying the original key returned them** (201 `Idempotent-Replayed`). **Probe addition:** after erasure, replay
  every idempotency key the subject's requests used. The replay must not return personal data. Scan every `core` jsonb
  store, not only the module schema, the outbox and the audit log.
- **Round 2 (E-082):** a redaction net can **over-reach**. Matching free-text contact values as substrings 410'd
  unrelated records and other guests' replays. **Probe addition:**
  - plant the erased subject's values inside unrelated records, such as `Maldives` inside `Indian/Maldives`;
  - plant another guest with a shared email.

  Only records that **identify** the subject (exact ids, normalized email or phone as whole JSON strings) may be
  touched.

### AP-18 · A privacy or sharing setting is bypassed through a secondary path
- **Seen in:**
  - guests G-P0-2: profile resolution ignored the sharing setting and the guest's objection;
  - guests G-P1-2: `links` leaked B's stay ids.
- **Probe:** turn the setting off, or record the guest's objection. Then try **every** path that returns, reuses or
  references the record: resolve, suggestions, links, search, history, export, events and counts. Nothing from the
  hidden scope may appear, not even ids.
- **Applies to:** guests, search providers, record history, analytics, crm.
- **Round 1:** integration-step P2-1 (E-044). FD-15 redacted the blocker `message`, but kept `status`, `ready` and
  `blockingReason.key`, and the booking and stay records still returned totals and `status.payment`. Housekeeping could
  read the payment state. **Probe addition:** after redacting, check every **derived** field (status, readiness,
  counts, sort order) and every **other route** that returns the same record.
- **Round 2:** integration-step R2-P2-2 (E-076). This was the second sibling miss on FD-15: workflow runs (check-in
  step results) and stay issues built from them still gave payment state to every booking reader. **Probe addition:**
  enumerate every **derived** artefact (step results, issues, counts, messages), not only routes.

### AP-19 · A simulator or dev path is reachable in live, or the environment changes mid-operation
- **Seen in:**
  - integration F8: a simulator became the system of record in a live org;
  - backoffice P2-9: the simulator ran inside live orgs;
  - payments P1-11: a simulated intent executed after a trial-to-live switch;
  - identity P2-17: the operator console was enabled in production;
  - guests P2: a dev encryption key was used whenever `NODE_ENV` was not "production".
- **Probe:**
  - In a live org, try to bind or use every simulator, dev key and operator path.
  - Start an operation in trial, switch the org to live, then execute: it must be refused (`environment_changed`).
  - Confirm `assertExternalEffectAllowed` runs at execution time, not only when the operation is recorded.
- **Applies to:** payments, integration, comms, identity, backoffice, kernel crypto.

### AP-53 · A delegated port call accepts effect parameters the entry permission does not imply (numbered in order of discovery)
- **Seen in:** integration-step P1-2 (E-040). Check-in (`reservations.stay.checkIn`) could hold **any** saved card for
  **any** amount. ADR-0015 delegation granted `payments.payment.collect` at the property, and the card and the amount
  came from the request.
- **Probe:**
  - For each delegated provider call, list the parameters that choose *what* is affected: which card, how much, which
    account, which recipient, which unit. Supply hostile values: another guest's card, 100× the amount, another
    payer.
  - Each must be bound to the record (the booking's guarantee method, the agreed amount), or require an **explicit**
    capability. That capability is named in the ADR, including **whose** key it is.
- **Applies to:** every ADR-0015 delegation: reservations → payments, finance and inventory; finance → payments;
  operations → inventory.
- **Canary:** C-L2-16.
- **Round 2:** integration-step R2-P1-1 (E-073). The fix required that "the card belongs to the booker, an occupant or
  the payer", but a role without payments rights writes those links. The exception "bound to the agreed guarantee" was
  controlled by the role it restrains. **Probe addition:** for each exception that allows a delegated effect, ask who
  writes the facts that make the exception apply (AP-57).

---

## B. Money and finance

### AP-20 · Concurrent over-correction: the remaining amount is checked before the lock
- **Seen in:**
  - finance F-01: three concurrent full corrections turned 128.70 into −257.40;
  - finance F-02: two credit notes for one invoice;
  - payments P1-1: two concurrent charges on one folio;
  - inventory INV-05: one hold converted into two bookings.
- **Probe:** N concurrent corrections, refunds, credit notes, captures or conversions with **different** keys against
  one original. Invariant: the corrected, refunded or converted total never exceeds the original, and exactly one
  conversion happens.
- **Applies to:** finance, payments, inventory, reservations (deposits), POS later.
- **Canary:** C-L2-04.

### AP-21 · A retry with the same key duplicates the effect
- **Seen in:** the baseline, which passed in finance: 20 concurrent retries produced exactly one entry. It is CLAUDE.md
  §4.7.
- **Probe:** run the same money command with the same `Idempotency-Key` (or derived business key) 20 times
  concurrently. Exactly one effect must happen, enforced by a unique constraint, and the stored response is replayed.
- **Applies to:** every money or inventory mutation.
- **Canary:** C-L2-05.

### AP-22 · Agreed terms are not honoured
- **Seen in:**
  - rates R-01: the service charge was recomputed from current configuration at posting;
  - reservations R-04: a stale free-cancellation preview committed against a now non-refundable plan.
- **Probe:**
  - Book. Then change everything configurable: fees, tax rates, the plan's refundability, policies and inclusions.
    Post the nights and commit the previewed changes. The agreed values must hold, or the preview must answer
    `preview_stale`.
  - The preview token must bind the rates configuration.
- **Applies to:** rates, reservations, finance, groups, contracting.
- **Canary:** C-L2-06.

### AP-23 · Boundary values in money arithmetic
- **Seen in:**
  - reservations R-01: a 1-cent difference in a channel price dropped every tax;
  - rates R-06: a zero night aborted the quote for every plan;
  - rates R-07: a 150 % promotion produced negative prices and taxes.
- **Probe:** try ±1 minor unit around every equality and threshold, plus zero, 100 %, above 100 %, negative, the
  largest value, and the currency's exponent. No exception may abort unrelated items, and no negative price or tax may
  appear unless it is an explicit credit.
- **Applies to:** rates, reservations (channel), finance, payments, POS.

### AP-24 · Tax base or time-of-supply errors
- **Seen in:**
  - rates R-08: Green Tax charged twice on split deposits;
  - rates R-09 and reservations: a complimentary stay lost Green Tax;
  - finance F-05/F-06: invoices misstated tax;
  - finance F-09: imported deposits were taxed twice.
- **Probe:** run the same stay through these variants: full prepayment, split deposits, a complimentary night, a
  transfer twice, a rate change between deposit and stay, and an imported deposit with tax already declared. Total
  tax must equal the tax for the plain stay, levies must stay outside the GST base, and the invoice lines must
  reconcile to the ledger.
- **Applies to:** rates, finance, reservations, migration.

### AP-25 · A limit ignores adjustments, or re-applying a configuration resets usage
- **Seen in:**
  - payments P1-4: refunds ignored negative adjustments;
  - finance F-04: re-applying the rule set reset cap usage, and a company was billed 514.80 against a 300.00 cap.
- **Probe:** adjust, then refund past the net amount. Re-apply an identical configuration in the middle of a period.
  Limits must count adjustments, and usage must survive.
- **Applies to:** payments, finance (billing rules, allowances), rates (sales limits).

### AP-26 · An uncertain outcome is shown as a definite one
- **Seen in:**
  - integration F4: a disconnect turned an uncertain charge into `cancelled`;
  - backoffice P1-2: a network failure was shown as "nothing was sent";
  - payments P1-7: a bank transfer was posted at record time.
- **Probe:** cut the connection after the request is sent, time out the provider, disconnect or pause during a send,
  record a transfer with no receipt. The state must be `pending_verification` or `awaiting_receipt`, with a way to
  check, and never "cancelled", "paid" or "safe to retry".
- **Applies to:** payments, integration, backoffice client, comms.
- **Canary:** UX-11 is the L4 form.
- **Round 2:** integration-step R2-P2-4 (E-078). When the domain was external, the money step was marked `done` with
  "taken in Legacy PMS", and nobody attested anything. An external domain changes **who** confirms, not **whether**.

### AP-27 · Net-of-fee settlement does not reconcile
- **Seen in:** payments P1-9: settlements without fee columns produced amount mismatches, and the recovery text told
  staff to adjust the guest's payment.
- **Probe:** import a net statement with fees, a chargeback and a reversal. Matching must use gross minus fee equals
  net. Fees are booked as an expense, never as a guest adjustment.
- **Applies to:** payments, finance, accounting.

### AP-28 · The same money is collected twice through two channels
- **Seen in:** payments P1-2: a paid deposit link plus a desk charge.
- **Probe:** open a payment link for a purpose, then collect the same purpose at the desk, and by automation. The second
  collection must be blocked or warned, with a reference to the first.
- **Applies to:** payments, reservations (check-in guarantee), POS.
- **Round 1:** integration-step P1-3 (E-041), **over-collection**. A late charge on a folio still in credit
  opened a payment request for the full charge (11,700 against a folio at −38,300). **Probe addition:** every collection
  request equals `min(charge, max(0, balance after posting))`. A balance in credit creates no request.
- **Round 2:** fix sweep SW-PAY-1 (E-063). With a deposit paid by link, a desk **authorize, then capture** posted the
  deposit a second time. The guard covered `chargeNow` only. **Probe addition:** run the double-collection probe
  through every path that turns money into a posting (charge, authorize and capture, recorded payment, VCC, link,
  check-in guarantee), and under a lock per (ref, purpose).

### AP-29 · Time semantics and deadlines: the wrong clock, or a deadline that nothing enforces
- **Seen in:**
  - operations P1-7: escalation was anchored on `created_at`, so tomorrow's day plan escalated 15 minutes after it was
    generated, and preventive work was due at 23:59 **UTC** rather than in property time;
  - reservations R-10: late-checkout and early-check-in fees were posted with a future service date, which finance
    refuses;
  - inventory INV-07: an expired overbooking allowance left a cell oversold, with no conflict raised until something
    else touched it ("lazy expiry");
  - rates R-16: the quote estimate across a rate change;
  - CLAUDE.md §5: business date, stay date, service date, `occurred_at` and revenue date are all distinct.
- **Probe:**
  1. Run the module with a property in a non-UTC time zone (Maldives is UTC+5) and a clock set to 23:30 local, then
     to 00:30.
  2. Check every SLA, due time, escalation, posting date and report against the **property's** business date and
     time zone, never UTC and never `created_at`.
  3. For every expiry or deadline (holds, allowances, previews, invitations, links, grace periods), advance the clock
     past it **without touching the record**. A job must record the transition, its conflict or issue, and its event.
     It must not wait for the next command.
- **Applies to:** operations, inventory, reservations, finance (business date vs service date), rates, identity
  (expiries), day-close.

---

## C. Events, integration and concurrency

### AP-30 · An event is lost because the dedupe marker commits before processing
- **Seen in:** payments P0-3: a failure after the dedupe commit made every redelivery answer "duplicate", and the
  dispute was never recorded.
- **Also seen in:** integration F6. The vendor was acknowledged before the record was applied, so "applied" did not
  mean applied. Consumer failures went dead silently after 12 attempts.
- **Probe:** inject a failure after the dedupe marker and before the effect (throw, deadlock, process kill), then
  redeliver. The event must be processed. There must also be a backstop job that lists provider events since the
  cursor. Acknowledge the sender only **after** the effect commits. A consumer's final failure raises an issue that
  someone owns; it never just stops.
- **Applies to:** payments webhooks, integration inbound, the outbox consumers of every module.
- **Canary:** C-L2-05.

### AP-31 · Out-of-order or late events overwrite newer state
- **Seen in:**
  - operations P1-1 and P1-2: a late `unit.blocked` re-applied a released block, and `checkedIn` after `checkedOut`
    left the unit occupied;
  - reservations R-05: a cancellation arriving before its booking left a live booking;
  - integration F5: an older revision won.
- **Probe:** deliver each consumer's events in reverse order, with duplicates and late arrivals. State must equal
  in-order delivery. Producers set `aggregateVersion`, and consumers use `isNewerThan`.
- **Applies to:** every event consumer: operations, reservations, finance, guests, integration.
- **Canary:** C-L2-09.

### AP-32 · A valid but unexpected business state crashes the consumer and it retries forever
- **Seen in:** reservations R-05/R-06: a cancellation for an in-house stay, or a booking for past dates, threw, and
  ingestion retried forever with no issue raised.
- **Probe:** send every business state the source system can legally send, including late, past, in-house, cancelled
  twice and unknown codes. Each must be handled, or raised as an issue with an owner. None may throw into a retry
  loop.
- **Applies to:** integration, reservations (channels), distribution, operations (external PMS).

### AP-33 · A stale offline write is applied silently
- **Seen in:** operations P0-1: an "already in this state" shortcut ran before the version check and advanced the base.
- **Probe:** submit a mutation from a base version older than the current one, including a no-op ("already clean") and
  one against work that was reassigned meanwhile. It must be rejected with a conflict, or it must apply **and** raise a
  discrepancy. It must never be silently rebased.
- **Applies to:** operations, the staff PWA, any offline or batch API.

### AP-34 · An in-flight command is replayed blindly after a reconnect, pause or resume
- **Seen in:** integration F2: a send's completion overwrote `needs_revalidation`, and the command was sent again
  without approval.
- **Probe:** pause, disconnect or replace while a send is in flight, then resume. The command must be held for a
  person, never re-sent by itself. Adapter calls need a deadline shorter than the lease.
- **Applies to:** integration, payments (operation journal), distribution, comms.

### AP-35 · An unknown or undeclared value fails open
- **Seen in:**
  - integration F3: an undeclared operation was classed `standard`;
  - backoffice P3-2: an unknown environment showed no banner;
  - backoffice P1-3: an unknown status crashed the screen.
- **Probe:** feed unknown enum values, undeclared operations and unknown environments. The result must fail closed for
  safety decisions, and must render neutrally and visibly for display. It must never crash and never fall back to the
  most permissive value.
- **Applies to:** integration, the backoffice and UI, kernel environment checks, and every effect classifier.
- **Round 1:** integration-step P2-2 (E-045). An **omitted scope** widened to every property:
  `delegated(tx, perms, undefined)` granted folio and posting permissions at all properties. **Probe addition:** call
  each port function with no `propertyId` or legal entity. It must refuse, never widen. Scope parameters on port
  surfaces are required, not optional.
- **Round 2:**
  - SW-PAY-2 (E-064): `purpose: 'custom'` skips the guard, a label the client chooses.
  - SW-RAT-1 (E-069): `nature` defaults to `statutory`, so the R-01 protection is off by default.
  - R2-P2-3 (E-077): the reference check `return`s for unknown types or an unbound directory.
  - R2-P3-1: a non-numeric policy makes the cap `NaN`, and `amount > NaN` is false.

  **Probe addition:**
  - every exemption a fix adds is listed and attacked;
  - a default is the safe value;
  - a non-finite or unknown configuration falls back to the safe default.

### AP-36 · Rows are read before the lock is taken
- **Seen in:**
  - inventory INV-01 and INV-02: release read its rows, then locked, then subtracted twice;
  - finance F-01;
  - payments P1-1;
  - identity R2-P2-1.
- **Probe:** read the code: every "read what is left, decide, write" must be lock, then read, then decide. Add a
  two-transaction test that proves the second waits.
- **Applies to:** inventory, finance, payments, identity counters, every limit.
- **Canary:** C-L2-04.

### AP-37 · An external effect happens inside the database transaction
- **Seen in:**
  - reservations R-09: key operations inside the transaction, so a rollback left real keys changed;
  - identity P2-2: IdP calls inside a transaction holding `FOR UPDATE`.
- **Probe:** force a rollback after the effect call. No external state may have changed: it must go after commit
  (outbox) or use a two-phase pattern with an idempotency key.
- **Applies to:** reservations (keys, payments), identity (IdP), payments, comms, integration.

### AP-38 · Data authority is bypassed
- **Seen in:**
  - inventory INV-03: no availability authority check on sale, hold or assignment;
  - reservations R-07/R-08: read-only mode still wrote locally, check-in authorized the card before the authority
    check, and forward mode created duplicate forwarded changes.
- **Also seen in:**
  - operations P1-4: acknowledging a forwarded work order changed nothing, so return to service was impossible;
  - operations P1-5/P1-6: housekeeping next to an external PMS had no inbound stays contract, and every PMS-side status
    was refused.
- **Probe:** set each governed domain to external, in read-only and in forward mode. Try every write and every external
  effect. All must be refused or forwarded **before** any effect. A repeated forward must not duplicate. In
  **connected mode**, run the round trip end to end: forward, the external system acknowledges, the change takes
  effect in Portico; and an inbound change from the system of record is applied. A module that claims it can run
  standalone next to another system must show this loop working, not just a refusal.
- **Applies to:** every module that writes governed domains (CLAUDE.md §4.15).

### AP-39 · A concurrent duplicate insert aborts the whole transaction
- **Seen in:** integration F11: after a `23505` the code retried inside the aborted Postgres transaction.
- **Probe:** raise the same exception, issue or row from two transactions at once. One wins; the other reuses that
  row through a savepoint or `on conflict`, and neither transaction aborts.
- **Applies to:** every "raise once" queue (exceptions, issues, discrepancies, tasks).

### AP-56 · A one-time security transition races in-flight writers (numbered in order of discovery)
- **Seen in:** identity R3-P1-1 (E-047).
  - The first-verification wipe locked the user row, then deleted credentials.
  - A concurrent `confirmTotp` had read the pending factor before taking any lock. It waited, then activated **after**
    the wipe, so the attacker's authenticator survived.
- **Probe:**
  - For each one-time transition (credential wipe, key rotation, revocation, tenant offboarding, cutover), start the
    writers it is meant to neutralize **concurrently** with it (enrol, confirm, link, session, API key), using a
    test-only delay inside the transition to widen the window.
  - Nothing created before the transition commits may survive it.
  - The fix is a lock order (every writer locks the parent row before reading state) plus an **epoch** stamped on
    every credential and checked when it is used.
- **Applies to:** identity, payments (provider account switch), integration (cutover, disconnect), migration.
- **Canary:** C-L2-17.
- **Round 2 (wording correction, L8):** **erasure and anonymization** are one-time transitions too. The fix sweep marked
  AP-56 "not applicable" for G-P0-1 because the examples above did not name them, and a write racing an erasure
  survived it (E-083). **Probe addition:** a writer of the subject's data (contacts, documents, notes, consents)
  started concurrently with the erasure, with a test-only gate.

---

## D. Contracts and cross-module coherence

### AP-40 · A port does not match its provider
- **Seen in:** rates R-03, finance F-07/F-08, operations P1-3, guests G-P1-4, reservations R-02/R-03/R-10…R-14, and
  integration F9.
- **Probe:** put a compile-time test on a verbatim copy of the other side's types (as finance did in `test/compat/`).
  Also parse a real fixture from the provider with the consumer's schema. Compare refusal codes as well as shapes.
- **Applies to:** every port.

### AP-41 · A fake is more lenient than the real provider
- **Seen in:**
  - reservations R-11: the fake payments decided synchronously, while the real flow is two-phase;
  - reservations R-14: the fakes never checked permissions;
  - inventory: the fake did not model composites;
  - backoffice P1-6: the simulated data layer was validated against **its own copies** of the module contracts, so it
    drifted from the real ones without anyone noticing (an `HH:MM` ETA and a nullable readiness would crash the
    board).
- **Probe:** a checklist for each fake. Does it check permissions and scope? Is it two-phase where the provider is? Does
  it return the real refusal codes and model the real states (composites, nullables)? Then re-run the module's
  scenarios against the real provider once it is bound.
- **Applies to:** every module with ports.

### AP-42 · A closed enum or error code is copied instead of imported
- **Seen in:**
  - E-008: provenance gained `sandbox` in the kernel, but copies in inventory and payments did not;
  - E-009: data-authority domains were 9 in one module and 10 in another;
  - E-011: `module_unavailable` vs `module_not_available`;
  - payer types (`guest_profile|other`, `profile|house`, `guest`);
  - four provenance definitions in the UI (backoffice cross-module note).
- **Probe:** grep `z.enum([` literals and string-literal unions for values that equal a kernel or provider enum, and
  grep error codes for near-duplicates. They must be imported from the owner's contracts or the kernel, never copied.
- **Applies to:** every module, `packages/ui`, and the backoffice.
- **Canary:** C-L1-02.
- **Round 1 (E-054, E-058; canary C-L1-02b):**
  - Five modules hold six literal provenance copies; four of the value sets differ from the kernel's. Reservations lacks
    `sandbox`.
  - A planted kernel value was caught by typecheck only through payments' copy.
  - The backoffice rendered a discrepancy value with the occupancy vocabulary.
  - **Probe addition:**
    - `grep -rn "z.enum(\['live'" modules/*/src`, and the same for each kernel or provider enum;
    - every `StatusBadge`/vocabulary call site passes the vocabulary of the value's **own** family.

### AP-43 · An event payload schema drifts from its consumer
- **Seen in:**
  - reservations R-12: `earlyCheckIn: null` and an `HH:MM` ETA failed operations' parser, so events would
    dead-letter;
  - inventory `availability.changed` was emitted as `range` while consumed as `cells`.
- **Probe:** producers export Zod payload schemas from their contracts, and each consumer has a test that parses
  producer-generated events with the producer's schema.
- **Applies to:** every event.

### AP-44 · Validation at save time is weaker than at use time
- **Seen in:** finance F-03: a rule set nested `[BRKF, FOOD]` inside `food` and was accepted, but posting `BRKF` then
  failed with `billing_rule_conflict`.
- **Probe:** for each configuration save, generate the combinations it accepts and run the use path on each. Anything
  the use path refuses must have been refused at save.
- **Applies to:** finance (billing rules), rates (derived plans, restrictions), platform (policies), integration
  (mappings).

### AP-45 · A guard or fix misses a sibling path
- **Seen in:**
  - identity R2-P2-2 (E-006): power ordering on revoke and suspend, but not on `transferMember`;
  - identity R2-P2-3 (E-007): last-admin protection on SCIM user delete, but not on group reconciliation;
  - identity R2-P1-3 (E-003): the domain gate on new links only;
  - inventory INV-04: selling checked residence (composite) commitments, but assigning a component villa did not;
  - operations P1-12: return to service was enforced in operations, but inventory's own route could release the same
    block directly. The state change could be reached **through another module's API**.
- **Probe:** for each guard added, grep every entry point that makes **the same state change**: routes, services,
  SCIM, SSO, jobs, events and imports, **including other modules' routes and ports that change the same record**.
  Probe each one. An invariant that one module owns must be enforced where the record lives, or the other paths must
  be closed.
- **Applies to:** every fix round.
- **Canary:** C-L2-13.
- **Round 1:** sibling paths left by fixes:
  - E-044: redaction on one field only;
  - E-049: power check on adding a mapping, not on removing one;
  - E-053: e2e ports fixed in the config, not in the fixtures;
  - E-046: seal verified in one function only.

  **Probe addition:** removal is a sibling of addition; derived fields are siblings of the field; fixtures are
  siblings of the config.

### AP-46 · A failure path commits partial state
- **Seen in:** identity R2-P1-3 (E-003): `fail()` returned and phase 3 committed the user and the SSO link, although the
  sign-in was refused.
- **Probe:** for each refusal inside a multi-phase command, assert afterwards that no row was created: count rows in
  the touched tables before and after. Refusal audits go in a separate transaction.
- **Applies to:** identity, check-in and check-out workflows, integration activation, imports.

### AP-47 · A refusal can be weaponized against a legitimate user
- **Seen in:** identity R2-P1-2 (E-004): any org's `invited` membership permanently blocked a new person's first
  password.
- **Probe:** for every new refusal, ask whether a third party (another tenant, a guest, an OTA) can put a victim into
  that refused state. If so, the victim must have a recovery path that does not need the griefer.
- **Applies to:** identity, reservations (holds, waitlists), payments (blocks), integration (exceptions).
- **Round 1:** identity R3-P2-3 (E-051). A credential wipe triggered by the person's own good-faith verification
  elsewhere permanently locked them out of an SSO-required organization. **Probe addition:** for every *protective*
  transition (wipe, revoke, lock), check whether the legitimate user can be left with no way back.
- **Round 2 (E-082):** a holder of `guests.privacy.erase` could deny replays of any stored response containing a
  chosen value, by creating and erasing a dummy guest with that value as its "address".

### AP-48 · Effective-dated data without explicit bounds
- **Seen in:** rates R-19 (E-023): the earliest TGST version was open-ended backwards, so 2021 was taxed at 16 %
  instead of 12 %.
- **Probe:** every effective-dated rule pack (tax, FX, policy, plan) has an explicit first `valid_from`. A date before
  it is refused ("no rule known"), never silently mapped. Historical rates carry a source and a verification date
  (CLAUDE.md §4.13).
- **Applies to:** rates, finance (FX), platform (policies), migration (historical imports).

### AP-54 · A fix makes a known weakness load-bearing without re-rating it (numbered in order of discovery)
- **Seen in:** identity review 2 → review 3 (E-050).
  - Review 2 rated "domain verification is never re-checked and not exclusive" as P3 (R2-P3-5).
  - Its own P0 fix then made a verified-domain sign-in the **global** proof of email ownership.
  - Review 3 showed a stale verification forging consent to another organization's invitation.
- **Probe:** for each fix or recommendation, list the mechanisms it newly **relies on**. Look each one up among the
  open lower-severity findings and known gaps. A weakness the fix now depends on is re-rated at the fix's severity and
  fixed in the same round.
- **Applies to:** every fix round, and every reviewer recommendation.
- **Round 2 (E-084):** **volume and time** are load-bearing premises too. The erasure fix made completion depend on an
  unindexed scan of every stored response (4.4 s per 50,000 rows), so it fails under the 30 s statement timeout at
  about 340,000 rows. **Probe addition:** benchmark any new scan inside a command at 10× the largest expected tenant.

### AP-57 · Premise writers: the fact a fix trusts can be written by someone the fix does not restrain (numbered in order of discovery)
- **Seen in:**
  - R2-P1-1 (E-073): booker, occupant and guarantee links are written by the role the card rule restrains;
  - R2-P1-3 (E-075): opening-deposit imports write the `deposit_accounts` that the P1-1 fallback trusts;
  - SW-PAY-4 (E-066): the P1-8 fix trusts `entry_channel`, which the client writes;
  - G-P0-1 → SW-GUE-1 (E-067): "erased" was trusted to mean "absent from the scanned tables", while another store
    held the data.
- **Probe:**
  - For each fix, write down the **facts it reads to decide** (fields, rows, links, flags, statuses).
  - For each fact, enumerate **every writer**: routes, service functions, imports, channel ingestion, merges and
    unmerges, jobs, seeds, migrations.
  - Attack each writer with the actor the fix restrains. A writer that is not held to the same rule makes the fix
    bypassable.
  - "One step back" (N−1) from the refused attack is: **control the premise**.
- **Applies to:** every fix round (builder self-check v4 BS4-1(a)) and every reviewer recommendation (steward
  SR2-6).
- **Canary:** C-L2-18.

### AP-58 · Lifecycle closure: the fixed quantity drifts after a repeated or inverse operation (numbered in order of discovery)
- **Seen in:** R2-P1-2 (E-074), on a departed folio:
  - a **second** late charge was never requested;
  - a **reversal** left the request open;
  - the fix's own exception kept its first severity (routine), although the case was urgent.

  Also SW-FIN-1 (E-070): an edit to the rule reset the cap lineage.
- **Probe:**
  - State the fix as an **invariant over stored state**, for example "after departure a folio has at most one open
    balance request, and it equals the folio's debt".
  - Then apply the guarded operation **three times**, with the artefact the fix creates **already open**.
  - Apply every **inverse or compensating** operation: reversal, adjustment, transfer, refund, cancel, unmerge.
  - Check the fix's **own records** (exceptions, statuses, audits, requests) after each step. They are recomputed,
    never frozen at their first value.
  - "One step forward" (N+1) from the refused attack is: **repeat it, or undo it**.
- **Applies to:** money and collection logic, caps and limits, inventory consumption, redaction rules, any fix that
  creates a record of its own.
- **Canary:** C-L2-19.

---

## E. Claims and gates

### AP-50 · A claim is not backed by an asserting test
- **Seen in:**
  - guests G-P1-6: invariants claimed "proven" were contradicted by the probes;
  - backoffice P2-17: README e2e claims had no matching tests;
  - integration F10;
  - identity's S17 claim;
  - parity overclaims (E-019).
- **Probe:** for each README, readiness or parity claim, open the test and quote the line that asserts the claim. With
  no such line, the claim is downgraded.
- **Applies to:** every module README, `docs/parity/*`, `docs/readiness/*`.
- **Canary:** C-L5-01.

### AP-51 · A scenario is proven only against fakes
- **Seen in:**
  - guests S15/GUE-I03: held only against the test's fake consumer;
  - reservations: "never authorizes twice" was proven with a synchronous fake.
- **Probe:** list each scenario's ports with real or fake bindings. A scenario claim counts only when every port it
  exercises is real (`playbooks/scenario-tests.md`, ST2-1).
- **Applies to:** every `scenario-sNN` test.

### AP-52 · Gate integrity
- **Seen in:**
  - stale cache: E-008, E-009, and E-038 (latent);
  - piped output: E-010;
  - a gate too narrow: backoffice P2-5 (the axe gate);
  - a pass that depends on data: backoffice P2-6;
  - tool false positives: E-012, E-013;
  - parallelism budgets: E-015.
- **Probe:** the gate self-test (`canaries.md` C-L1-01…03):
  - plant a type error in one dependent each of `packages/`, `modules/` and `apps/`, and in a planted lint error; the
    gate must fail on each;
  - read exit codes, never piped output;
  - run the gates as CI runs them, and once with turbo's default concurrency.
- **Applies to:** L1.
- **Round 1:**
  - E-053: the e2e suite passed only on port 5180, and Playwright is outside `turbo test`.
  - E-059: the boundary checker misses `sql.raw('… other.table')` (canary C-L1-03b2).
  - E-052: superuser migrations in tests.
  - C-L1-01 now passes: `apps/*` are turbo inputs.

  **Probe addition:**
  - run every gate on non-default ports and with the production database roles;
  - list the checks the merge gate does **not** run.
- **Round 2:** E-079. An end-to-end test (409 toast) was flaky on non-default ports and passed on re-run. A flake is a
  tracked defect with an owner. Never accept a silent re-run.

### AP-55 · A test exercises the path but asserts neither the outcome nor the claim (numbered in order of discovery)
- **Seen in:**
  - integration-step P1-3 (E-041): `bindings.test.ts` ran the late-charge collection and over-collected 64,000 against
    a 14,000 debt, with no assertion on the amount;
  - P2-4 (E-042): S04 compared different villa types, so it could not prove child-age pricing, and never asserted
    Green Tax;
  - P3-8: S01's "nothing is posted" was a comment, not an assertion;
  - E-044: "FD-15 … (tested)", while derived fields leaked.
- **Probe:**
  - For each claimed behaviour, find the **asserting line**.
  - For each money path a test touches, check that it asserts the **amount** and the **counterparty**.
  - Mutate the expected value: the test must fail. If changing the outcome does not fail the test, the test proves
    nothing.
- **Applies to:** scenario tests (ST2-2 assertion map), binding tests, README "tested" claims, parity `tested` rows
  (PR2-1).
- **Round 2:**
  - SW-BO-1 (E-068): the P0-1 e2e test used `page.goto`, a full reload, so it passes with or without the fix.
  - R2-P2-4 (E-078): the regression test asserts `done`, not the attestation.

  **Probe addition:** remove or revert the fix; the regression test must fail. If it still passes, it proves nothing.

---

## F. UX traps (round 1)

These are the probes for UI reviews (steward SR2-5) and the traps for L4 lab canaries. Each was **seen** in
`docs/ux/round-1/blackbox-findings.md` (persona or "T" friction number) and refined in `docs/ux/round-1/refinements/`.

| ID | Trap | Seen in | Probe (UI review) |
|---|---|---|---|
| UX-01 | **Dead end:** an action leads nowhere | `N` opens a palette with no commands (T1); a search result does nothing (E-026); a tile opens the wrong list (T16); Confirm enabled on an infeasible preview (P1 extend); a "Check status" text with no button | Activate every button, link, key, result and tile; each must change state or navigate where its label says |
| UX-02 | **A number does not reconcile with its destination** | Today shows 9 ready, Arrivals 7; the payments-pending total matches nothing (T6/T11) | For each KPI or count, open its destination and count the rows; they must be equal |
| UX-03 | **Contradictory status** | "Paid" next to a balance due; in house and "Ready for check-in" together; "not operating" with 106 guests in house (T11) | For each record, compare the chips with the facts on the same screen; separate questions get separate chips |
| UX-03b | **Value shown under the wrong vocabulary family** (round 1) | A discrepancy (`skip`) rendered with the occupancy vocabulary fell back to a neutral chip (E-054) | For each chip, check that the value's own family supplies the vocabulary. A neutral fallback in a demo dataset is a finding, not polish |
| UX-04 | **Raw technical text shown to staff** | Zod JSON, `common.loading`, permission codes, role codes, UUIDs, "wave 1", "(scenario S03)", "demo-seeder" (T12/T13, E-025, E-031) | Copy sweep of every screen and every error; nothing from the development vocabulary may appear |
| UX-05 | **Harmful or wrong recovery advice** | "Reload the page" (loses edits); "Trying again unchanged will fail…" on every error; "Try fewer words" for one word; "nothing was sent" | Trigger each error class (validation, 403, 404, 409, network loss, timeout); the advice must be correct for that class and must not lose work |
| UX-06 | **Focus not moved, or a keyboard trap** | The drawer leaves focus behind it, so it takes 17 Tabs to reach Check in; there are no action keys (T15) | Keyboard only: open, act, close; focus must land in the drawer and return to the row |
| UX-07 | **Overflow, or controls off-screen** | 111 px overflow at 1024 px; the drawer's Close at x=1075 (E-027) | Viewport matrix 390/768/1024/1280/1440/1920: no horizontal page scroll, and every control is reachable |
| UX-08 | **The phone is a squeezed desktop** | The first number at about 830 px; sideways tables; a 10,514 px list (T17) | On a 390×844 screen, the first operational number must be within 300 px; there must be no sideways table |
| UX-09 | **The UI does not reflect permissions honestly** | The Invite button on the forbidden page; access by URL; "Whole organization" as the default (E-028, E-029) | Role × route and role × action matrix; risky defaults; hidden navigation is never treated as access control |
| UX-10 | **Empty help or learning shells** | Every lesson "CONTENT COMING" (T14) | Open help on every screen: it must have content or say plainly that none exists yet |
| UX-11 | **Success that changed nothing** | A "simulated" check-in toast while the status stays the same (T9) | After every action, re-read the record: the state must have changed, or the UI must say clearly that it did not |
| UX-12 | **A safety guard is missing on an action** | Check-in allowed 9 days early, or for a guest still in the air (T11) | Try each action in the wrong state, the wrong time or for the wrong person; it must be refused with a reason |
| UX-13 | **An accessible name is an id** | Radio buttons announced by UUID (E-030) | Screen-reader name sweep: no UUIDs, codes or keys in names |
| UX-14 | **Data leaks across context** | Resort items in the guesthouse's list; the header switcher not matching the edited property (P1, P7) | Switch property or org; every list and header must follow |
| UX-15 | **Shared-desk handover** | The next user on the tab sees the previous user's data (L2 P0-1, AP-16) | Sign in as user 1, let the session expire, sign in as user 2 with fewer rights; nothing of user 1's may show |
| UX-16 | **The most important text is truncated** | The arrival blocker is cut with "…", and the full text is only in a `title` attribute (backoffice P1-4, P1) | At each viewport, the decision-critical text must be fully readable without hovering |
| UX-17 | **A verb cannot be found** | 0 of 17 action words found by the palette; no Day Close in navigation or search (T5) | Search for every staff verb in the lookup set (`docs/ux/scorecard.md`); the right action must be first |
