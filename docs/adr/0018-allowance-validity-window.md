# ADR-0018 — Allowance validity window: a night's credit exists only once its night does

**Status:** accepted (orchestrator, 2026-11-08), from the day-close review P0-2 and fix round 1.
**Context:**
- Day Close pre-granted the next night's dining or package allowance right after the advance, before that night
  existed. On an early departure, the guest was billed (credit plus taxes) for a night outside the stay, and finance's
  check-out consumer forfeited it to breakage revenue. An occupancy correction also hit finance's
  `idempotency_conflict` and rolled back the whole night.
- The reviewer's alternative, a provisional grant confirmed at the close, cannot be built on finance's current
  allowance options:
  - `credit_back` does not return the tax charged at grant time on an early departure;
  - `prepayment` covers tax-inclusive amounts, so the guest gets less food than with the default treatment.

## Decision
1. Night N's allowance is granted **at N's own close**, and is valid for charges dated the day after N, until the N+1
   close or check-out. No allowance is ever granted for a night that has not happened.
2. **The arrival day's credit is granted at check-in** by reservations (contract request CR-5, re-scoped), when the
   package intends one (for example dinner on arrival for half board). Until CR-5 is built, packages with per-night
   dining credits are **R2 for arrival-day coverage**. The readiness register says so, and a pilot hotel that sells
   such packages needs CR-5 first.
3. Corrections are posted from the corrected agreement, so they never collide with an earlier grant's key. A line
   whose key finance already holds with different content is set aside with a `posting_conflict` follow-up, and the
   rest of the night still posts.

## Consequences
- No early-departure overbilling and no breakage on nights that did not happen.
- The arrival-day dinner on a half-board package depends on CR-5. This is a known, labelled gap, never silent.
- Revisit if finance gains a provisional-grant treatment that returns its tax.
