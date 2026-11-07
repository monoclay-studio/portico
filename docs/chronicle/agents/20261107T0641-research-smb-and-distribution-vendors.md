# Agent run: Research SMB and distribution vendors

- Started: 2026-11-07T06:41:50.059Z · last activity: 2026-11-07T06:52:37.972Z
- Turns: 0 · tool uses: 0 · output tokens: 0
- Type: general-purpose

## Brief (2026-11-07T06:41:50.059Z)

````text
You are doing competitive research for a new cloud hospitality property-management platform (working company name "Monoclay"). It aims to match Oracle OPERA Cloud's operational depth while being much easier to use, and to serve small properties without enterprise complexity. Research these ALL-IN-ONE / DISTRIBUTION / SMB / ALTERNATIVE-ACCOMMODATION vendors using web search and fetching vendor pages, public docs, review sites (G2, Capterra, Hotel Tech Report), Reddit/hotel forums and industry press:

1. Cloudbeds (PMS + channel manager + booking engine + Cloudbeds Payments + revenue intelligence + Whistle messaging)
2. SiteMinder (channel manager, SMX/platform, booking engine "SiteMinder Direct Booking", Little Hotelier for small properties, Channels Plus)
3. RoomRaccoon (all-in-one for small hotels, auto-pricing, upsell)
4. Guesty (short-term rental/serviced apartments, unified inbox, automation, owner accounting)
5. RMS Cloud (holiday parks, campgrounds, flexible accommodation units/sites)
6. Briefly also: Hostaway, eZee Absolute, protel, Clock PMS+, WebRezPro, Hotelogix, Lighthouse/Duetto/IDeaS (revenue management only) — just 3-6 bullets each on what they're known for.

For EACH major vendor capture:
- Positioning, segments, notable scale, pricing model if public.
- Real competitive advantage, concrete features & workflows (e.g. Cloudbeds' unified calendar, how channel manager and PMS share one inventory; SiteMinder's channel health/visibility, mapping, retry handling; Guesty's unified inbox & automation rules and owner statements; RMS's flexible area/site types and multi-unit configurations; RoomRaccoon's ease of setup).
- What customers praise and complain about (overbookings, sync delays, support, hidden fees, payment holds). Quote/paraphrase specific review themes.
- Channel manager mechanics: how ARI (availability, rates, inventory) push works, how reservation pull/push and acknowledgements work, how they handle duplicates, modifications, cancellations, missed messages, mapping errors, and what they show staff about connection health.
- Payments model: merchant of record, fees, payouts, holds/reserves.
- Onboarding/migration approach and time-to-live.
- Features Monoclay should adopt, and anti-patterns to avoid.

Write a thorough, well-structured markdown report to /home/user/research/03-smb-distribution-vendors.md (create the directory if needed). Cite source URLs inline. Mark clearly what is verified from a source vs. your inference. Aim for depth (~4,000-6,000 words fine). End with a section "Top 15 takeaways for Monoclay" ranked by impact.

Your final reply to me should be a ~400-word summary of the most important findings plus the file path. Do not ask me questions; use judgment.
````

## Report (2026-11-07T06:52:37.972Z)

````text
The report is written: **/home/user/research/03-smb-distribution-vendors.md** (about 9,600 words including URLs and tables). Some sources were out of reach, so a few sections rest on weaker evidence:
- **Blocked domains:** the research environment refused developer.siteminder.com and myfrontdesk.cloudbeds.com. Those details come from search-engine extracts of the pages, though the inline citations point to the real pages.
- **Search budget:** the shared limit ran out before I could check Lighthouse, Duetto and IDeaS, so those short profiles rely partly on general knowledge.
- **Labels:** every claim is tagged as vendor source, third-party, my inference, or unchecked background knowledge.
- **Prices:** aggregator prices for the quote-only vendors (Cloudbeds, RoomRaccoon, Guesty Pro, RMS) disagree with each other, so treat them as rough ranges.

**Main findings**

1. **All-in-one is now the baseline for small properties.** Cloudbeds, RoomRaccoon, Little Hotelier, eZee and Hostaway all sell PMS, channel manager, booking engine and payments as one product. SiteMinder (56,000 hotels, A$313.7m ARR in FY26) is the large standalone distribution layer, and its new Channels Plus offers one contract, one invoice and commission only on completed stays.
2. **Payments drive profit and complaints.** SiteMinder's transaction revenue grew 33.8% against 14.6% for subscriptions, and RMS Pay has passed US$1B processed. Guesty holds 10% of transactions for 90 days and pays out about 7 days after it receives funds. Cloudbeds' first payout takes 7–14 days and instant payouts cost an extra 1.5%. Reviewers complain about RoomRaccoon effectively forcing RaccoonPay and about slow Cloudbeds payouts.
3. **The most damaging pattern in reviews is an overbooking caused by a sync failure, followed by support that doesn't help.** Guesty posted three public sync-degradation notices in July–August 2026 alone.
4. **SiteMinder's developer docs are the clearest public reference for how a channel manager should work:**
   - rate and availability changes sent as deltas in 2-minute rounds, with a full push on connect;
   - modifications that replace the whole reservation and keep the same ID;
   - the PMS confirms each reservation, and anything unconfirmed is resent;
   - failed messages retried with increasing delays; malformed ones are not retried;
   - bookings for unmapped rooms are accepted but don't reduce availability, which Monoclay should not copy.
5. **The best ideas to borrow:**
   - Cloudbeds: one inventory shared by PMS and channel manager, with linked dorm-bed and private-room inventory.
   - Guesty: two-level automation conditions with "waiting" and "expired" states, and formula-based owner statements.
   - RMS: site and category model with rig type, length and power constraints, utility meters, and payment schedules.
   - RoomRaccoon: a fixed 28-day onboarding plan that ends when the first channel goes live.
6. **Common anti-patterns:** quote-only pricing with large renewal increases (a reported "nearly 200%" at Guesty), billing during trials, paid reservation import (Cloudbeds), map edits that need a support ticket (RMS), OTAs connected only after go-live (RMS), and "unlist and relist" as the fix for a broken sync (Guesty).

**Top takeaways for Monoclay (the report ranks 15)**
1. A native channel manager on one inventory, with updates in under 60 seconds and automatic reconciliation.
2. A "distribution health" screen showing each channel's status, mapping gaps and plain-language errors, plus a public status page.
3. Reservation intake that never loses or duplicates a booking.
4. Fully published pricing, including payment fees and reserve policy.
5. Optional, transparent payments rather than mandatory ones.
6. Free migration, with same-day go-live for small properties.
7. A general inventory model that covers hotels, hostels, apartments and campgrounds.
8. Fast, human escalation for overbooking and sync incidents.
````

