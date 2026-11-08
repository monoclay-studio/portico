# Steward review — migration ("Move to Portico", D13; increments 1–2)

> Written incrementally. Status: IN PROGRESS — the verdict, counts and coverage declaration are filled in at the end.

| | |
|---|---|
| **Verdict** | _pending_ |
| **Branch / commit reviewed** | `feat/migration` @ `45be8b93614653fffb9fa5721979d6a63c48ed89` |
| **Scratch copy** | detached worktree of `45be8b9`, merged with `main` @ `2df56d1` (local merge `e9a141a`, clean) |
| **Playbook** | steward-reviewer v2.1 (launch brief v2), plus the queued v3 items the run parameters asked for (gates on a merged copy with exit codes; re-run 2 builder mutants + plant 1) |
| **PoCs** | `docs/orchestration/reviews/migration-poc/*.test.ts.txt` |

---

## 2. Findings (appended as confirmed)

### R-P0-1 · The card-number guard misses PANs written in ordinary ways, so card numbers are stored

- **Where:** `modules/migration/src/domain/sensitive.ts:57` (`CARD_CANDIDATE = /(?:\d[ -]?){12,18}\d/g`) and `:65-76`
  (`findCardNumbers` scans `rows` only); caller `modules/migration/src/sources/files.ts:80`; storage
  `modules/migration/src/service/extract.ts:403-415` (every parsed cell, every header, into `extract_payloads`).
- **Problem.** The regex is greedy and `matchAll` never retries inside a match, so adjacent digits swallow the PAN:
  - `4111 1111 1111 1111 12/27` and `Visa 4111111111111111 1227` (PAN followed by expiry) → 18–19-digit candidate fails
    the length/IIN check → **not refused**;
  - `room 12 4111111111111111` (a number before it) → not refused;
  - only one `' '` or `'-'` between groups: double spaces, dots, U+00A0, `" - "`, full-width digits → not refused;
  - header cells are never scanned, but are stored and echoed back in the upload review.
- **Why it matters.** CLAUDE.md §5 "Portico never stores raw card numbers"; MIG-I7 / MG-02 / PAR-MIG-023 /
  EC-MIG-022 are claimed `tested`. A PAN in a notes column lands in `migration.extract_payloads`, the rehearsal copy
  in the trial organization (see R-P1-6), and every backup — PCI scope for Portico. The tests only use the forms the
  regex already matches.
- **Reproduce:** `migration-poc/zz-review-domain.test.ts.txt` › "R-P0-1 …" (6 tests, all pass on `45be8b9` = defect
  present; the last one runs `readPack` and shows the PAN in the tables that `uploadFiles` stores).
- **Fix (principle):** *any run of 13–19 digits that can be formed from a cell by ignoring non-alphanumeric
  separators, at any offset, that passes Luhn and an issuer range, refuses the upload* — instances: spaces, multiple
  spaces, dots, dashes, slashes, U+00A0/U+2007/U+202F, full-width and other Unicode decimal digits (`\p{Nd}`,
  NFKC first), adjacent digits before or after (slide a window over each digit run instead of one greedy match), header
  cells, sheet names, and XLSX numeric cells in exponent form (`4.111111111111111E15` is an exact double for 16-digit
  PANs < 9.007e15). **Sibling paths:** `uploads/preview` (same `readPack`, OK once fixed), the simulator records
  (`recordsFromSimulator` — no scan at all today), the trial copy sent through the rehearsal bridge, any future
  connector extract. **Attack on the fix:** a sliding window will raise false positives on long OTA references; that is
  acceptable (the refusal names row/column only and the hotel removes it) and must be stated in the error, not
  "fixed" by shrinking the window back to one greedy match. Add each bypass above as a refusal test.

