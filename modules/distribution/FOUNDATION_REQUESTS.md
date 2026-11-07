# Foundation requests — distribution

Changes outside this module that distribution needs. Each has a local workaround today.

## FR-1 Shared vocabularies in the kernel (BS3-1)

**Problem.** `severity` (`urgent | routine`) and `responsibleParty` (`hotel | monoclay | vendor`) are owned by the
integration module's contracts. Modules may not import each other in `src` (tools/check-boundaries.mjs), so
distribution keeps equal copies in `src/contracts.ts`.
**Workaround.** `test/compat/contracts.test.ts` asserts the copies equal integration's options (a drift fails the test).
**Proposed diff.** `packages/kernel/src/vocabulary.ts` exporting `SEVERITIES` and `RESPONSIBLE_PARTIES` as `as const`
arrays; integration and distribution build their Zod enums from them.

## FR-2 A body-returning SSRF-safe client

**Problem.** `safeFetch` (integration) discards response bodies; a hub client must read JSON answers.
**Workaround.** `src/adapters/http-transport.ts`: an exact host allowlist (`secure.channex.io`, `staging.channex.io`),
https on the default port only, no redirects, deadline, 5 MB body cap. Hosts are code constants, never
customer-supplied, so the SSRF exposure is the DNS of those two names.
**Proposed diff.** Move `safeFetch` to `packages/http` (or a `packages/net`) with an option `readBody: { maxBytes }`
returning `{ status, headers, body }`; distribution's transport then pins the vetted address like webhooks do.

## FR-3 Channel connections as integration connections

**Problem.** The integration catalogue lists `channel.channex` as a planned entry with no adapter; `createConnection`
refuses it and the registry refuses a second registration of the key. Integration's exceptions and exchange log
require an integration connection, so distribution keeps its own `connections`, `exceptions` and `exchange_log`.
**Proposed diff.** (a) `createConnectorRegistry(deps, { replace: [definition, adapter] })` so the composition root can
register distribution's Channex definition; (b) an integration provider `getCredential(tx, connectionId)` for
the owning module; (c) distribution's connection gains `integration_connection_id` and raises exceptions through the
integration provider. Until then the "My work" inbox does not include distribution exceptions.

## FR-4 Producer-owned Zod schemas for inventory and rates events

**Problem.** `inventory.availability.changed`, `rates.prices.changed` and `rates.restrictions.changed` export TS
interfaces only (self-check item 22 asks producers to export schemas).
**Workaround.** `src/events.ts` parses with local schemas; `test/compat/contracts.test.ts` checks them against the
producers' interfaces at compile time and with sample payloads at run time.
**Proposed diff.** Each producer exports `availabilityChangedPayloadSchema` etc. from its `contracts.ts`.

## FR-5 Erasure and retention for stored channel revisions

**Problem.** Revisions carry guest name, e-mail and phone; the table is append-only (immutability is the point), so
there is no redaction path for an erasure request or for retention.
**Proposed diff.** A reviewed SECURITY DEFINER function `distribution.redact_revision_payload(id)` replacing personal
fields with a marker while keeping hashes and ids, called by the guests module's erasure flow and by a retention job
(e.g. 30 days after the booking's departure, like integration's inbound retention).

## FR-6 Platform activation scope for live channels

**Problem.** Live publication must be authorized per property (G-04). The composition binds a stub that refuses.
**Proposed diff.** Bind `liveScope.assertLiveChannelAllowed` to platform's `assertEffectInScope(tx, propertyId,
'channel.publish', { connectionId })` when it is on main.
