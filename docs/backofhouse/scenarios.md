# Back-of-house proof scenarios (B01–B20)

Status: Draft v1 · 2026-11-07. Proposed addition to `docs/scenarios/README.md` (CR-30). Same rules as S/E/A items:
each runs through real product workflows on its own test tenant with the Maldives sample data (*Kandu Atoll Resort*,
120 villas, USD functional currency; *Hiyani Guesthouse* for single-person policies; *Azure Isles Group* for
intercompany), ends with the global consistency checks **plus** the back-of-house checks: every control account =
its sub-ledger (FIN-I14, ACC-I02, STK-I02, PRC-I03, CNC-I01), clearing accounts zero or listed as open items, no
duplicate idempotency effects, audit rows for every consequential command. Tax figures use the **unverified** Maldives
rule pack (Q41/Q106 defaults). Test names are normative: `scenarios/bNN-*.test.ts`.

### B01 — Month-end close at a resort, end to end
- **Pre:** Kandu, October 2026 fully operated in Portico: Day Close for 1–31 Oct, POS outlets, stock, procurement, AP,
  workforce, spa concession, utilities.
- **Steps:** the controller follows the close cockpit (README §6): automatic checks turn green one by one; counts,
  GRNI review, landed-cost finalization, payroll journal import, service-charge run, bank reconciliations, depreciation,
  FX revaluation, allocations, concession settlement, statements review, soft close, tax return working papers, hard
  close.
- **State:** period `closed`; statements reproducible; MIRA 206 and 501 working papers `reviewed`.
- **Money:** TB balanced; every control = sub-ledger; GRNI = open receipts; clearing accounts zero.
- **Audit:** each check records who/when/evidence; reopen attempt needs ⚑ and reason.
- **Recovery:** a failed check names the module, record and action; nothing closes with a red check unless a
  documented override exists.
- **Modules:** accounting, finance, day-close, fnb-pos, stock, procurement, workforce, concessions, utilities.
  **Test:** `scenarios/b01-month-end-close.test.ts`.

### B02 — The same supplier invoice arrives three times
- **Steps:** email PDF, a photo of the paper copy, and a re-sent PDF with the number formatted `INV-0042` vs `42`.
- **Expected:** one voucher; second and third blocked as duplicates naming the first; an override needs
  `accounting.invoice.overrideDuplicate` and reason. **Test:** `b02-duplicate-supplier-invoice`.

### B03 — Fraudulent bank-detail change
- **Steps:** an email asks to change a seafood supplier's bank account; the AP clerk records the request.
- **Expected:** approval by a different person; out-of-band verification recorded using the number on file; 24 h
  cooling-off; the pending payment run holds that supplier with the reason; the supplier's existing contact receives
  a notice (simulated outside live). **Test:** `b03-bank-detail-change-control`.

### B04 — A released payment is returned by the bank
- **Steps:** a run of 14 payments is released (file); the statement shows 13 debits and one return.
- **Expected:** 13 `confirmed`, 1 `returned`; the voucher reopens; nothing showed `paid` before confirmation; a new run
  pays it once. **Test:** `b04-payment-return`.

### B05 — Bank reconciliation explains the difference to the cent
- **Pre:** USD bank account with an OTA payout, an acquirer batch settlement net of fees, a DMC transfer for two
  receivables invoices, one deposit covering two cashier sessions, an unknown bank fee.
- **Expected:** exact-reference matches for payout and DMC; many-to-one for the deposit; fee created from statement by
  rule; reconciliation statement difference 0.00; sign-off by a reviewer locks matches. **Test:** `b05-bank-reconciliation`.

### B06 — ERP export retried after a timeout
- **Steps:** the October batch to the accounting system times out (`pending_verification`); read-back finds it; a later
  correction to 12 Oct is posted.
- **Expected:** one journal in the target; the correction travels as a delta batch; coverage report shows every entry in
  exactly one batch. **Test:** `b06-erp-export-idempotent`.

### B07 — Late supplier invoice after soft close
- **Steps:** on 4 Nov an October invoice for goods received 28 Oct arrives; October is soft-closed with AP allowed to BD+5.
- **Expected:** with `accounting.period.postSoftClosed` it posts to October and relieves GRNI (no P&L change, cost was
  already in stock/GRNI); after hard close it posts to November with `relatesToPeriod` and appears in the restatement
  register. **Test:** `b07-late-invoice-cutoff`.

### B08 — Beach bar offline for 40 minutes
- **Pre:** Sunset Bar tablets with an outlet hub; internet lost 19:20–20:00.
- **Steps:** 12 checks; 5 room charges queued with signatures; meanwhile one guest checks out at the desk and one villa
  is set `cash_only`.
- **Expected:** KDS and printing continue; devices show queue and snapshot age; on sync 3 charges post, 1 posts as a late
  charge to a supplementary folio with collection follow-up, 1 becomes an unposted-room-charge exception; device fiscal
  series continuous; no duplicates on repeated sync. **Test:** `b08-pos-offline-room-charges`.

### B09 — All-inclusive guest and a friend share a check
- **Steps:** AI guest orders cocktails (covered) and a premium wine (excluded); non-AI friend orders dinner; bottle split
  50/50; tip by card.
- **Expected:** badges shown before send; covered lines recorded as entitlement uses; excluded wine and friend's dinner
  charged with 10% service charge then TGST 17%; tip outside the base; split residual ≤ 1 cent assigned
  deterministically; sold-item facts include covered items. **Test:** `b09-pos-ai-split-check`.

### B10 — Void after send and a comp
- **Expected:** void needs manager elevation and reason, `made` flag creates outlet wastage at cost in stock; comp to
  service recovery posts per policy; loss-prevention report lists both with approvers. **Test:** `b10-pos-void-comp`.

### B11 — Delayed container and landed cost
- **Pre:** a sea shipment from Colombo with water, wine and amenities; ETA Malé 2 Dec.
- **Steps:** forwarder reports a 10-day delay; buyer orders an air-freight top-up of water; the duty voucher arrives
  higher than estimated after 40% of the wine was consumed.
- **Expected:** ETAs and stock projections update; days-of-cover alert with suggestion; top-up PO approved per rules;
  actualization: 60% to stock value, 40% to cost of sales/variance, once. **Test:** `b11-shipment-delay-landed-cost`.

### B12 — Three-way match exceptions
- **Expected:** price variance accepted for 2 lines by the buyer (not the requester), debit note for the third; a short
  delivery line waits and re-matches when the second GRN posts; voucher posts GRNI relief once per receipt line.
  **Test:** `b12-three-way-match`.

### B13 — Month-end bar count
- **Expected:** count sheet frozen at 23:00; spirits variance above threshold triggers recount; controller approves;
  adjustments post once; count-based cost of sales; theoretical vs actual shows variance by item and lists 2 unmapped
  sold items with their sales value. **Test:** `b13-bar-count-variance`.

### B14 — Minibar after check-out, then disputed
- **Expected:** consumption recorded after departure posts as a late charge (FIN-R25) with stock issue in the same
  command; guest disputes; reversal removes the charge and returns the item to the minibar store together.
  **Test:** `b14-minibar-late-dispute`.

### B15 — Service-charge distribution for October
- **Pre:** USD pool from posted service charge, small MVR pool (MVR cash outlet sales); 1% deduction; 212 eligible
  employees incl. a joiner on 15 Oct and a leaver on 20 Oct; leave days counted as worked.
- **Expected:** shares by days worked per currency sum exactly to pool − deduction; approval (≠ calculator) posts
  `scdist:{runId}` once; payroll input exported without salaries or bank data; imported payroll journal clears the
  clearing account; evidence pack and employee statements available; collected-basis comparison shown. **Test:**
  `b15-service-charge-distribution`.

### B16 — Expiring certification and work permit
- **Expected:** a lifeguard's certificate expired yesterday → roster blocks the pool shift (override needs approval);
  an expatriate's permit expires in 25 days and a new arrival's visa is due within 15 days → dashboard with owners and
  Xpat checklists; references recorded after manual portal action. **Test:** `b16-workforce-compliance`.

### B17 — Spa concession settlement (agent model)
- **Expected:** room charges by the spa partner land in "due to concessionaire", not revenue; one refund; minimum
  guarantee true-up; electricity and water recharge from meters; 6 staff beds and meals; statement, hotel tax invoice
  and payable netted; each posting in exactly one settlement. **Test:** `b17-concession-settlement`.

### B18 — Diesel variance
- **Expected:** tank dips vs issues vs generator fuel meters show 3% unexplained loss → exception with owner, work order
  for the flow meter, days of cover recalculated; investigation trail retained. **Test:** `b18-fuel-reconciliation`.

### B19 — Trial and demo safety for back-of-house effects
- **Expected:** in trial and demo, POs, RFQs, remittances and bank-detail notices are simulated (`message.supplier`),
  payment files are watermarked `NOT FOR BANK — trial`, payroll exports watermarked, no Xpat or MIRA interaction exists.
  **Test:** `b19-boh-environment-safety`.

### B20 — Coexistence: resort keeps Simphony and SunSystems
- **Pre:** `charges` Portico; outlets' charge source = external Simphony connection; `accounting` external (ERP),
  `payables` external; `purchasing` and `stock` Portico.
- **Expected:** POS intake retries create no duplicate postings; `posSales` feeds theoretical consumption; GRNI and
  stock journals exported, matched invoice packs forwarded once to the ERP AP; no Portico supplier payment exists;
  export coverage complete. **Test:** `b20-coexistence-erp-pos`.

## Module participation (back-of-house)

| Module | Scenarios |
|---|---|
| accounting | B01–B07, B12, B15, B17, B20 |
| fnb-pos | B08–B10, B20 |
| procurement | B01, B11, B12, B19, B20 |
| stock | B01, B09–B11, B13, B14, B18, B20 |
| workforce | B01, B15, B16 |
| concessions | B01, B17 |
| utilities | B01, B17, B18 |
| finance | B01, B05, B07, B08, B14, B15, B17 |
