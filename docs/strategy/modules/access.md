# access — 10x brief (keys and credentials bound to the stay)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2; manual key log is pilot-critical) · Spec
`docs/specs/access.md` (ACC-R01–R24) · Parity: **none** (planned on `docs/parity-ops`) · Source key:
`docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff and a lock vendor.**

## 1. Current state (evidence)

- **No `access` module exists.** Reservations has an `AccessPort` with only an **environment-safe fallback adapter**
  (no lock vendor — R1 for real locks); check-in treats a lock outage as a recorded manual fallback; room moves and
  extensions re-encode keys through the port; future-dated moves are not segment-aware (README-reservations § What is
  built, § Known gaps; `check-in-resume.test.ts`). Integration's catalogue lists `doorLock.encoders` as planned (R1) and
  flags the need for a local connector.
- **Owner questions:** Q80 door-lock partner programmes and key issuance for pilots; Q62 local connector; Q150 key/kiosk
  patents (new).
- **UX1:** the check-in panel shows "Issue key" as a step that cannot be done; no key status anywhere.

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Key encoding at kiosk/desk | Stayntouch | Kiosk with ID scan and key encoding; room moves from one view | R02 §4.3, §4.5 |
| Multi-interface keys | OPERA 26.2 | Create room keys for multiple interfaces; partial key failure handling | DD02a §1.2 |
| Mobile/kiosk key patents | various | Phone-to-kiosk key printing, encoder multiplexing, QR-activated cards, passport-face matching; Hilton Digital Key litigation | DD04 P13–P16, L1 |
| Lock vendors | ASSA ABLOY, dormakaba, Salto | Certified SDKs carry their own patent positions | DD04 §2.5; dependency register §6.1 |

Recommendation from research: integrate lock vendors' certified SDKs; never invent key-issuance protocols (DD04 §2.5).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Manual key log and mechanical-key register — the P0 path for every pilot without a live lock connection | ACC-R16, R17 |
| 2 | Credential aggregate bound to the stay; truthful, idempotent key operations ("encoding pending verification", never "issued" before the encoder confirms) | ACC-R01, R19 |
| 3 | Key lifecycle on stay events: issue at check-in, additional/duplicate, extension/late checkout, room move, end of stay (checkout, early departure, no-show, cancellation, reverse check-in) | ACC-R06–R10 |
| 4 | Lock-system connection model with a capability truth table per connection; unit ↔ lock mapping | ACC-R02, R03, R05 |
| 5 | Outage behaviour and exceptions to desk, handover and Day Close (keys still active after checkout = blocker) | ACC-R22, R23 |
| 6 | Pre-encoded key packets for jetty/airport/villa check-in; lost or stolen keys with charges | ACC-R11, R12 |
| 7 | Encoder simulator (fault matrix), then one vendor SDK via the local connector | ACC-R04, R18; Q80 |
| 8 | Mobile keys and PIN codes for self check-in (guesthouses, late arrivals) | ACC-R13, R15 |
| 9 | Door audit-trail retrieval for incidents and disputes | ACC-R21 |

## 4. The 10x outcome (TARGETS)

**Picture:** the desk always knows which credentials exist for a stay and whether each one is confirmed, pending or
failed; a room move re-keys the guest without a second step; at checkout no key stays valid without a visible
exception; and a guesthouse with brass keys gets the same truth from a simple key register.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Credentials still valid after checkout without an open exception | — | 0 |
| Powerful | Duplicate encodes or wrong-room keys under retries and encoder timeouts (simulator fault matrix) | OPERA partial key failure handling (DD02a §1.2) | 0 |
| Seamless | Keys at check-in / room move | step not available | ≤ 1 action inside the check-in or move flow; 0 re-typed unit numbers |
| Friendly | Key status shown as "issued" before encoder confirmation | — | never ("pending verification" instead) |
| Well-rounded | Pilot paths | none | manual log + mechanical register (pilot), one vendor SDK at R4 before a resort pilot that wants integrated keys (Q80) |

## 5. Next 3 increments

### Increment 1 — Truthful manual path (pilot-critical)
- Module skeleton; credential aggregate (kind, unit, validity, status, source); manual key log (staff record keys made
  outside Portico, with expiry) and mechanical-key register (guesthouse default); bind reservations' `AccessPort` to the
  module; key exceptions in the common shape (active after checkout, lost key, missing return).
- **Acceptance:** ACC-R16, R17, R19, R23 tested; check-in/check-out/move/extension produce correct credential records
  with the manual path; Day Close shows active keys after checkout as blocking.

### Increment 2 — Lifecycle on stay events + encoder simulator
- Full lifecycle (ACC-R06–R12) on reservations events with `aggregateVersion`; encoder simulator with faults (timeout →
  pending verification, duplicate request, wrong encoder); capability truth table per connection; unit ↔ lock mapping in
  integration; pre-encoded packets; lost/stolen with charge via finance.
- **Acceptance:** lifecycle tests for every stay event incl. reverse check-in and early departure; no duplicate encode
  under retries; ACC-R02–R05, R11, R12, R18, R22 tested against the simulator.

### Increment 3 — First vendor through the local connector (only with Q80/Q62 approval)
- Local connector agent (with integration) and one vendor's certified SDK in a sandbox; door audit-trail retrieval
  where supported; PIN codes for self check-in (guest-experience) designed with counsel guidance (Q150).
- **Acceptance:** R4 evidence recorded in the readiness register with the vendor's sandbox; otherwise this increment is
  replaced by mobile/PIN design work at R1 and the brief says so.

## 6. Cross-module dependencies and contract changes

**reservations:** `AccessPort` contract incl. segment-level validity for future moves. **integration:** lock connections,
local connector, mapping kind `lockDoor`. **finance:** lost-key charges. **day-close/handover:** exceptions.
**guest-experience:** mobile key and PIN display (status as reported by the credential). **operations:** lock battery
and maintenance work orders. **guest-services:** incident references to door audit trails.

## 7. Power check — never lose or hide

A key is never shown as issued before confirmation; every credential is tied to a stay or a recorded reason; end-of-stay
always ends or flags every credential; environment safety blocks real encoders in demo/trial; no home-grown key
protocols, no biometrics (Q150).
