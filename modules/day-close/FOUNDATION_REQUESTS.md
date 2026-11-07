# day-close — foundation requests

Changes Day Close needs in shared packages (`packages/*`) or in another module's guarantees. Day Close works around
each locally and says so; nothing here blocks the module.

## FR-1 — platform `lockBusinessDate` (cut-over for postings in flight)

**Problem.** Finance stamps a posting with the business date it reads inside its transaction (FIN-I10), without a
lock. A posting whose transaction read D before the advance and commits after it is stamped D after D closed.
`test/concurrency.test.ts` › "lands before the advance on D, after it on D+1, and an in-flight posting is surfaced in
the report" proves the case exists and that Day Close **detects** it (the day report's "restatements since" annex
shows D's revenue moved after the close) — it cannot prevent it.

**Proposed.** `platform.lockBusinessDate(tx, propertyId): Promise<LocalDate>` =
`select business_date from platform.properties where id = $1 for share`. Finance (and every module that stamps a
business date on money) calls it instead of `getBusinessDate`. `advanceBusinessDate` already updates the row, so it
waits for postings in flight to commit (they land on D) and postings that start after it read D+1. The brief's gap
plan already lists it (PF). Day Close then changes nothing: the annex stays as the safety net.

## FR-2 — kernel vocabularies as value arrays (BS3-1)

`Provenance` and `EffectMode` are exported as types only. Day Close's Zod contracts type them from the kernel
(`z.string() as z.ZodType<Provenance>`), so OpenAPI shows a plain string. Proposed: `export const PROVENANCES =
[...] as const` and `EFFECT_MODES` in `@portico/kernel`, so contracts can `z.enum(PROVENANCES)` without copying.

## FR-3 — kernel `zonedTimeToInstant` in a DST gap

The doc comment says "during a DST gap the next valid instant is returned". For Europe/London on 2027-03-28 (01:00 →
02:00), `zonedTimeToInstant('2027-03-28', '01:30', 'Europe/London')` returns 01:30Z = 02:30 BST, not 02:00 BST.
Day Close corrects it locally (`src/domain/schedule.ts` `nextValidLocalMinute`, tested in
`src/domain/domain.test.ts` › "starts at the next valid local minute on a spring-forward night (EC-DCL-024)").
Proposed: the same correction in the kernel (other modules use it for cancellation deadlines).

## FR-4 — data-authority vocabulary in the kernel (BS3-1)

`DayClosePorts.platform.getDataAuthority` declares `authority: 'portico' | 'external'` and `DayCloseDomain` lists the
three domains Day Close reads. Both are subsets of platform's vocabulary, type-checked where the composition root binds
platform (a new platform value fails `tsc` there), but they are still written out because a module cannot import
platform. Proposed: `DataDomain` and `DataAuthorityKind` exported from `@portico/kernel` (as value arrays, see FR-2).
