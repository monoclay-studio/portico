# Agent run: Research enterprise PMS vendors

- Started: 2026-11-07T06:42:05.857Z · last activity: 2026-11-07T06:52:51.830Z
- Turns: 25 · tool uses: 70 · output tokens: 61,080
- Type: general-purpose

## Brief (2026-11-07T06:42:05.857Z)

````text
You are doing competitive research for a new cloud hospitality property-management platform (working company name "Monoclay"). It aims to match Oracle OPERA Cloud's operational depth while being much easier to use. Research these ENTERPRISE / RESORT vendors using web search and fetching vendor pages, docs, review sites (G2, Capterra, Hotel Tech Report, TrustRadius), Reddit/hotel forums and industry press:

1. Oracle OPERA Cloud (PMS, Sales & Event Management, Distribution, Payments, OHIP integration platform)
2. Infor HMS (Hospitality Management Solution)
3. Shiji Daylight PMS (and Shiji Enterprise Platform)
4. Agilysys (Stay PMS, rGuest, Book, Spa, Golf, POS, Agilysys Pay — the connected-resort story)

For EACH vendor capture:
- Positioning, target segments, rough market share/notable customers, pricing model if public.
- Their real competitive advantage — what they do better than anyone (be concrete: specific features, workflows, data models, e.g. OPERA's routing instructions, AR, block management, multi-property/cross-property profiles, business date / end-of-day sequence; Daylight's portfolio config & search; Agilysys's outlet/spa/activity tie-in to the stay).
- What customers praise and what they complain about (UX complexity, training time, slowness, outages, support, integration cost). Quote/paraphrase specific review themes.
- Architecture & openness: APIs, marketplace, event/webhook model, multi-tenancy, hosting, mobile apps.
- Finance specifics: folios/windows, routing, night audit / end-of-day, AR/city ledger, cashiering, fiscal handling.
- Specific features or patterns Monoclay should adopt, and anti-patterns to avoid.

Also research specifically: OPERA Cloud's night audit / End of Day steps, its reservation status model, its block (group) status model (inquiry/tentative/definite/actual/cancel/lost), its routing instructions and folio windows, and its rate code / package model. These are reference concepts we need to understand deeply (we will design our own original terminology).

Write a thorough, well-structured markdown report to /home/user/research/01-enterprise-vendors.md (create the directory if needed). Cite source URLs inline. Mark clearly what is verified from a source vs. your inference. Aim for depth over length padding (~4,000-6,000 words is fine). End with a section "Top 15 takeaways for Monoclay" ranked by impact.

Your final reply to me should be a ~400-word summary of the most important findings plus the file path. Do not ask me questions; use judgment.
````

## Report (2026-11-07T06:52:51.598Z)

````text
I've written the report to **/home/user/research/01-enterprise-vendors.md**. It runs about 9,000 words including the inline URLs. Every claim is labelled verified, verified only in older OPERA 5.x docs, or inference.

**How solid it is:** I couldn't open docs.oracle.com or hoteltechreport.com directly because the network allowlist blocks them. Those citations rest on the search engine's indexed copies, so exact wording and version numbers may differ slightly. The shared search budget also ran out near the end, so Agilysys Pay and the details of the Marriott deal are thin. Review samples are small (3 to 65 reviews per product), so read the sentiment as directional.

**Main findings:**

1. **OPERA's advantage is its data model and the workforce trained on it, not its interface.**
   - **Business date and End of Day:** a set of required and optional steps, and failed steps are retried on the next run. Rolling the date forces every other user to log out. The automatic scheduler retries 3 times, stops when exceptions are found, and still needs a person to print the final reports.
   - **Blocks:** each status (inquiry, tentative, definite, actual, cancel, lost, refused) has a type that decides whether rooms are taken from inventory. Lost, cancelled and refused need a reason, and the allowed next statuses are configurable.
   - **Billing:** up to 8 folio windows, with routing by transaction code or code bundle. Routing can be limited by dates, days and amounts, and defaults come from profiles and rate codes in a fixed order.
   - **Tax and service charges:** an inherited, chainable rule tree.
   - **Packages:** set by posting type, calculation rule and posting schedule, with allowance tracking.
2. **OPERA's weak points:**
   - New front-desk staff can't learn it in one shift.
   - Reviewers say it runs slowly and crashes on weak hotel internet, and support is inconsistent.
   - Turning on profile sharing across properties can never be undone.
   - Event streaming has to be switched on by Oracle's services team. It does keep 7 days of replay, with partners paying $10 per 100,000 events.
3. **Market signals:**
   - Wyndham migrated about 20 hotels a week.
   - In January 2026 IHG approved OPERA Cloud as an option, not a mandate.
   - Agilysys's earnings calls say its large PMS project is with **Marriott**, with hundreds of sites installing.
4. **Infor HMS** stands out for casino and gaming links (player value, comps, charges to checked-out rooms). Reviewers complain about bugs after updates, extra steps for common tasks, and a steep learning curve.
5. **Shiji Daylight** is configured once at global, brand or region level and has a single guest profile across properties. It claims fiscal compliance in 36 countries, put 100+ hotels live in two months, and IDC calls it the fastest-growing PMS. Reviewers like the ease of use but mention bugs, speed and limited customization. I couldn't find documentation on its folio routing or end of day.
6. **Agilysys** builds the stay as one itinerary: room, spa, golf and dining under one confirmation, and guests can book their own package entitlements. Its Stay PMS separates rolling the date from closing the accounting day, and it holds a **patent on ranked folio routing rules (US 2017/0124610)**. Check that before copying its routing design. Its APIs are only open to partners who sign an NDA, and reviewers report no senior support after hours.

**Top takeaways (all 15, ranked, are in the file):**
- Match OPERA concept for concept under original names.
- Make end of day non-blocking and separate it from the accounting close.
- Use ranked, previewable billing rules instead of numbered windows.
- Keep real-time double-entry ledgers.
- Treat packages as entitlements guests can see.
- Make the portfolio the root of configuration.
- Offer self-serve APIs with replay.
- Build a fiscal adapter framework.
- Design so staff are productive in one shift.
- Treat moving properties off OPERA as a product.
````

