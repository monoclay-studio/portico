# Owner decisions

Decisions made by the owner (Monoclay) that refine the brief. Engineering decisions live in `docs/adr/`.

| # | Date | Decision | Notes |
|---|------|----------|-------|
| D1 | 2026-11-07 | **Working name: Portico** (repository `monoclay-studio/portico`). The final product name is **not decided**. Company: **Monoclay LLC** (Delaware, formed via Stripe Atlas; founder based in the Maldives; may run several software products). | Keep the name in one config place so it can be changed (Q1). Product-level bookkeeping must be identifiable within Monoclay. |
| D2 | 2026-11-07 | **Guest payments: the hotel (its legal entity) is the merchant of record.** Preferred embedded option: **Stripe Connect** with Monoclay as platform (may take a platform fee). The payment domain is **provider-agnostic** (Stripe, Adyen, local acquirers, bring-your-own). | Research (doc 04): use *direct charges* so disputes debit the hotel's balance. **Caveat (Q2):** Stripe availability for a Maldivian legal entity is unverified and believed unavailable — Maldives hotels may need a local acquirer adapter. Monoclay's US Stripe account does not make it eligible to collect money for hotels. |
| D3 | 2026-11-07 | **First market: Maldives / Indian Ocean.** | TGST 17%, Green Tax ($12 / $6 per person-night by property class), 10% service charge custom, USD/MVR. |
| D4 | 2026-11-07 | **All segments from day one**: guesthouses, boutique and full-service hotels, resorts, serviced apartments, multi-property groups. The product scales down and up. | Requires plan-based packaging (editions + entitlements) because small and large customers will be priced differently. |
| D5 | 2026-11-07 | **Stack: engineering's choice**, optimizing for time-to-market, very high security, easy migration from incumbent systems, and easy integration with any platform (POS, CRM such as Salesforce, payments, cloud, future APIs). | See ADR-0001..0010. |
| D6 | 2026-11-07 | **Cloud: AWS.** Infrastructure as code (Terraform). | Region choice: OPEN_QUESTIONS Q4. |
| D7 | 2026-11-07 | **OTA connectivity: connectivity hub first** (white-label channel API such as Channex), with our own channel-manager core and an OTA simulator. Direct certifications later. | Google free booking links direct (research doc 04). |
| D9 | 2026-11-07 | **Companion operational-readiness brief adopted** (`docs/product/operational-readiness-brief.md`) as recommendations applied with judgment: 9-level readiness scale with technical vs external-approval tracks, external dependency register, zero-cost demo mode, launch gates, cost model. | Deliverables in `docs/readiness/`. |
| D8 | 2026-11-07 | **No pilot property yet.** Build with realistic Maldives sample data: a guesthouse, a ~120-villa resort, and a 3-property group. All migration importers are planned; generic CSV + OPERA formats first. | |
