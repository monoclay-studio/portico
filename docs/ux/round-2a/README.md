# UX round 2a: focused (2026-11-07)

**Scope:** the screens changed by the backoffice and identity merges: sign-in with the code step, the arrivals board,
Departures and In house, Today tiles, permission honesty and language. 4 personas: a resort front desk agent on desktop
and tablet, a housekeeping supervisor on tablet, the group director, and a brand-new guesthouse hire on a phone.
**Tester:** black-box, from tester playbook v2: stable finding IDs, evidence manifest, 74 cited files, 0 duplicates.
**Hand-off checks (orchestrator):** H-1 copy and convert every cited file, references rewritten, 74/74 present;
H-2 duplicate hashes, none; H-3 the tester's originals kept in the session scratchpad; H-4 no build context given.

**Routing decision (orchestrator):** no separate refiner run for this focused round.
- Most findings are on SIMULATED screens. The plan is to replace the simulator with real data, through the backoffice
  real-data round after integration-step merges. Refining simulated contradictions would be wasted work.
- **[LIVE] findings go straight to the backoffice's next round** (`docs/orchestration/pending-fixes.md`).
- **[SIM] findings become acceptance checks for the real-data round:** the same contradictions must be impossible with
  real data.
- The full 34-task re-measure (round 2) runs after the real-data round.
