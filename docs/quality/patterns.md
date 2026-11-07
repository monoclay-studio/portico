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

### AP-02 · Cross-tenant access by id (per-table isolation)
- **Seen in:**
  - identity P2-13: most new tables had no isolation test, including `mfa_factors`, where P0-2 sat;
  - CLAUDE.md §6 (P0 by definition).
- **Probe:** build a per-table suite from `information_schema.tables` for the module's schema. Every table must have a
  cross-tenant read test and a write test that both return 404, and must have RLS **enabled and forced**. The suite
  fails when a table is added without being classified.
- **Applies to:** every module, and every new migration.
- **Canary:** C-L2-02.

### AP-03 · Claimable external identifier: unique per tenant only
- **Seen in:**
  - payments P0-2: a Stripe account could be registered by any org, and `route_webhook` returned 2 rows, of which it
    took `rows[0]`;
  - identity P0-2(b): an email domain on an SSO allow-list without proof of ownership.
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
  - payments P0-2: the tenant set `status: active` and the application fee.
- **Probe:** list every request field that changes eligibility, price, liability or authority. Send each one forged.
  The server must derive it from the principal, the record or configuration, or reject it.
- **Applies to:** rates, payments, reservations (channel ingestion), integration, identity.

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

### AP-18 · A privacy or sharing setting is bypassed through a secondary path
- **Seen in:**
  - guests G-P0-2: profile resolution ignored the sharing setting and the guest's objection;
  - guests G-P1-2: `links` leaked B's stay ids.
- **Probe:** turn the setting off, or record the guest's objection. Then try **every** path that returns, reuses or
  references the record: resolve, suggestions, links, search, history, export, events and counts. Nothing from the
  hidden scope may appear, not even ids.
- **Applies to:** guests, search providers, record history, analytics, crm.

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

---

## C. Events, integration and concurrency

### AP-30 · An event is lost because the dedupe marker commits before processing
- **Seen in:** payments P0-3: a failure after the dedupe commit made every redelivery answer "duplicate", and the
  dispute was never recorded.
- **Probe:** inject a failure after the dedupe marker and before the effect (throw, deadlock, process kill), then
  redeliver. The event must be processed. There must also be a backstop job that lists provider events since the
  cursor.
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
- **Probe:** set each governed domain to external, in read-only and in forward mode. Try every write and every external
  effect. All must be refused or forwarded **before** any effect. A repeated forward must not duplicate.
- **Applies to:** every module that writes governed domains (CLAUDE.md §4.15).

### AP-39 · A concurrent duplicate insert aborts the whole transaction
- **Seen in:** integration F11: after a `23505` the code retried inside the aborted Postgres transaction.
- **Probe:** raise the same exception, issue or row from two transactions at once. One wins; the other reuses that
  row through a savepoint or `on conflict`, and neither transaction aborts.
- **Applies to:** every "raise once" queue (exceptions, issues, discrepancies, tasks).

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
  - inventory: the fake did not model composites.
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
  - identity R2-P1-3 (E-003): the domain gate on new links only.
- **Probe:** for each guard added, grep every entry point that makes **the same state change**: routes, services,
  SCIM, SSO, jobs, events and imports. Probe each one.
- **Applies to:** every fix round.
- **Canary:** C-L2-13.

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

### AP-48 · Effective-dated data without explicit bounds
- **Seen in:** rates R-19 (E-023): the earliest TGST version was open-ended backwards, so 2021 was taxed at 16 %
  instead of 12 %.
- **Probe:** every effective-dated rule pack (tax, FX, policy, plan) has an explicit first `valid_from`. A date before
  it is refused ("no rule known"), never silently mapped. Historical rates carry a source and a verification date
  (CLAUDE.md §4.13).
- **Applies to:** rates, finance (FX), platform (policies), migration (historical imports).

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

---

## F. UX traps (round 1)

These are the probes for UI reviews (steward SR2-5) and the traps for L4 lab canaries. Each was **seen** in
`docs/ux/round-1/blackbox-findings.md` (persona or "T" friction number) and refined in `docs/ux/round-1/refinements/`.

| ID | Trap | Seen in | Probe (UI review) |
|---|---|---|---|
| UX-01 | **Dead end:** an action leads nowhere | `N` opens a palette with no commands (T1); a search result does nothing (E-026); a tile opens the wrong list (T16); Confirm enabled on an infeasible preview (P1 extend); a "Check status" text with no button | Activate every button, link, key, result and tile; each must change state or navigate where its label says |
| UX-02 | **A number does not reconcile with its destination** | Today shows 9 ready, Arrivals 7; the payments-pending total matches nothing (T6/T11) | For each KPI or count, open its destination and count the rows; they must be equal |
| UX-03 | **Contradictory status** | "Paid" next to a balance due; in house and "Ready for check-in" together; "not operating" with 106 guests in house (T11) | For each record, compare the chips with the facts on the same screen; separate questions get separate chips |
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
