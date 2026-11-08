# Steward review — day-close (night audit / business-date close)

| | |
|---|---|
| **Verdict** | _(in progress — written incrementally)_ |
| **Branch / commit reviewed** | `feat/day-close` @ `cb0fbf33d31118be1e3c8b979713b6d38f7047e4` |
| **Scratch copy** | detached worktree of `cb0fbf3`, merged with `main` @ `2df56d1` (local merge `d2726cc`) |
| **Playbook** | steward-reviewer v2.1 (launch brief v2) |

## Findings (appended as confirmed)

### DCL-P0-1 — A package line that re-pricing moves to another night is charged twice or never (deferred lines and posted nights are never reconciled with re-sealed terms)

- **Where.** `modules/day-close/src/service/steps/postings.ts:112-131` (a line whose service date is later than the
  night is snapshotted into `day_close.deferred_lines`), `:297-313` (every pending deferred line whose service date
  has come is posted, whatever the stay's current terms say), `:318-364` (`postDeferred` posts the snapshot),
  `:82` (a night is posted from the terms current at that night's close). The line identity comes from rates:
  `modules/rates/src/domain/terms.ts:86-89` (`inclusion:{stay}:{inclusion}:{allocated night}`, departure-rhythm
  lines are allocated to the *last* night).
- **Problem.** Day Close posts each night from whatever terms are sealed at that night's close and never compares
  the stay's full current plan with what it has already posted or deferred. A re-pricing that moves a line to a
  different night (an extension or a shortened stay moves the departure transfer to the new last night) changes the
  line's key, so neither `night_postings` nor finance's unique key notices.
- **Reproduced** (`day-close-poc/zz-review-money.test.ts.txt` › `R-DEFER`, real rates + finance):
  - AI package, 7→9 Nov, departure seaplane USD 750 on the last night (service date 9 Nov) — deferred at the close of
    8 Nov. On 9 Nov the seaplane is cancelled and front office extends the stay to 10 Nov (exactly what Day Close's
    own blocking message tells them to do, `readiness.ts:168`); reservations re-confirms the price. The close of
    9 Nov posts the stale deferred line (the flight that did not happen); night 9 Nov is posted from the new terms,
    whose departure transfer is deferred again (service 10 Nov) and posted by the close of 10 Nov.
    **Result: three `TRANSFER_SEAPLANE` charges of 75 000 (one arrival, two departures) on the folio.**
  - Mirror case (`R-PREGRANT` early-departure probe, same file): stay 7→10 Nov shortened to 7→8 Nov after the close
    of 7 Nov. The new terms put the departure transfer on night 7 Nov, which is already posted, so **the departure
    seaplane that was flown is never charged** (the folio holds only the arrival transfer).
- **Why it matters.** Money correctness (CLAUDE.md §5 "retries must never duplicate charges"; DCL-I01's intent),
  in the single most common Maldives disruption (weather-cancelled seaplane). Latent on `main` only because no
  composed path can re-price a stay until `feat/integration-step` binds reservations' rates port — the calibration
  rule for latent money defects applies, hence P0.
- **Fix (principle).** *A line of the agreement is posted exactly once, identified by what it is, not by the night it
  happens to be allocated to; whatever is pending or already posted is reconciled against the terms in force before
  anything new is posted.* Instances: departure-rhythm lines, arrival-rhythm lines, added components with their own
  service date, a re-allocated inclusion, allowance lines (see P0-2). Concretely: (1) key departure/arrival-rhythm
  lines by occurrence (`inclusion:{stay}:{inclusion}:departure`, contract change in rates), (2) at each close
  recompute the stay's full plan and cancel pending `deferred_lines` that are no longer in it (and post lines whose
  night is already posted but which are new in the plan, e.g. the shortened stay's departure transfer), (3) put a
  `status in ('pending','posted','cancelled')` + reason on `deferred_lines`.
  **Attack run against the fix:** an extension *after* the deferred line was posted (the transfer charged, then the
  flight cancelled) — the occurrence key makes the second posting a replay or an idempotency conflict, never a
  second charge; the refund of a charged-but-not-flown transfer is a finance correction, not Day Close's.
  **Sibling paths** (same state change "post a plan line"): posting step (`postStayNight`), catch-up items, the
  pre-advance sweep, `postDeferred`, `pregrantAllowances`, reservations' future check-out posting (CR-4) — all must
  use the occurrence identity. **Load-bearing:** the fix relies on rates' plan identity (cross-module contract change)
  and on the catch-up (P1-1 below) not re-posting what the reconciliation skipped.

### DCL-P0-2 — The next night's allowance is pre-granted before that night exists: an early departure is billed for it, and any later correction makes the night unpostable

- **Where.** `modules/day-close/src/service/steps/index.ts:589` (`pregrantAllowances(s, D+1)` after the advance),
  `steps/postings.ts:239-265`, `:197-232` (`grantAllowanceLine` uses the plan key; finance hashes the whole request:
  `modules/finance/src/service/allowances.ts:66-67`, `support.ts:315-319`), `domain/errors.ts:24` (409 ⇒ "retryable").
- **Problem.** Right after the advance to N, Day Close charges night N's allowance to the folio (debit folio /
  credit allowance clearing, **with service charge and TGST**). Nothing ties that charge to the night actually
  happening:
  1. **Early departure** (`R-PREGRANT` › "an early departure…"): stay 7→10 Nov shortened to one night and checked out on
     8 Nov. The folio still carries `ALLOWANCE_DINING` for night 8 Nov: 10 000 + 1 870 + 1 000 (taxes) = **USD 128.70
     for a night that is not part of the stay**, and finance's check-out consumer
     (`finance/src/service/index.ts:736`, `closeAllowances(upTo 9999-12-31)`) forfeits it to **breakage revenue**
     (`breakage:{instance}:2026-11-08` entry).
  2. **Any correction between the pre-grant and N's close** (`R-PREGRANT` › "an occupancy correction…"): one adult
     leaves on 8 Nov and the price is re-confirmed (credit 50 instead of 100). At the close of 8 Nov the posting step
     re-sends the plan key with a different amount → finance `idempotency_conflict` → **the whole night is rolled
     back, room charge included**. The failure is marked `retryable: true` (409), so the scheduler retries it 3× in
     vain, no blocking follow-up is raised (only non-retryable item failures raise one, `postings.ts:430`), and
     resume fails identically. The only way out is the item override, which **skips the room night too**; the next
     close's catch-up then fails on the same key again (asserted). A change of default folio or of the inclusion's
     label has the same effect (they are in finance's request hash).
- **Why it matters.** Guest overcharge + wrongly recognized breakage revenue + tax on it (money correctness), and a
  routine correction turns into an unpostable night whose only recovery loses room revenue. Latent on main for the
  same reason as P0-1.
- **Fix (principle).** *Nothing for night N is committed to a folio before night N's own close, unless it is
  provisional and reconciled at that close.* Either drop the pre-grant (CR-5 already asks reservations to grant the
  arrival night at check-in; for the following nights, grant at the close of the previous night as a **provisional
  instance** that N's close confirms, adjusts or reverses), or make the posting step reconcile a pre-grant whose
  inputs differ (reverse + re-grant under a derived key) instead of re-sending the key. A stay that is no longer in
  house for N at N's close must have its pre-granted instance reversed (not forfeited). Classify
  `idempotency_conflict` as **not retryable** in `toFailure` (a deterministic conflict never heals).
  **Attack run against the fix:** the guest *consumes* part of the provisional credit at lunch and leaves early —
  the reversal must cover only the unused part and the consumed part stays a charge (finance's usage rows already
  give the split). **Sibling paths:** the posting step's allowance line, `pregrantAllowances`, reservations' future
  check-in grant (CR-5), finance's check-out consumer (forfeit vs. reverse).

### DCL-P1-1 — A night overridden "to be posted by hand" is posted again by the next close (catch-up ignores overrides)

- **Where.** `modules/day-close/src/service/readiness.ts:475-521` (`catchUpNights` only asks "is there a
  `night_postings` row?"), `steps/postings.ts:288-295` (catch-up items), `postings.ts:76-79` (the item's own
  message: "or override this item and post the night by hand"), `runs.ts:257-274` (the override records no intent).
- **Reproduced** (`zz-review-money.test.ts.txt` › `R-CATCHUP`): a stay with a bad seal fails at the close of 7 Nov;
  the auditor overrides it with the builder's own test reason ("…the night will be posted by hand tomorrow"); the
  next morning revenue posts the night by hand (`manual:{stay}:{D}`, USD 500) and front office re-confirms the price.
  The close of 8 Nov's catch-up posts `room:{stay}:2026-11-07` (USD 830). **Two room charges for one night**; the
  `night_not_posted` readiness item that announces it is only `info`.
- **Fix (principle).** *An overridden stay-night is a decision, not a gap: the catch-up never posts a night that a
  person overrode; it raises a blocking "decide: post now or confirm posted elsewhere" item instead.* Record the
  override's intent (`skip_night` with the run, stay and night) in the register (`night_postings` row with
  `posted_by = 'override'`, or a separate `night_decisions` table), make `catchUpNights` respect it, and change the
  message so it no longer recommends a hand posting that Day Close does not know about.
  **Attack run against the fix:** override, *no* hand posting, price fixed next day — the decision item makes the
  auditor post it (once, with the plan key); the night is not silently lost either. **Sibling paths:** overrides of
  posting-step items, of pre-advance sweep items (step `advance`), of catch-up items themselves, and of deferred-line
  items.

