# Black-box UX tester — playbook v1 (archived)

**Status:** archived. Superseded by `../blackbox-tester.md` (v2).
**Source:** the brief actually used for round 1, verbatim from
`docs/chronicle/agents/20261107T1141-black-box-ux-tester-no-build-context.md` (§ Brief, 2026-11-07 11:41 UTC).
**Edits made when archiving:** one only. The demo password is replaced by a placeholder, so credentials are not copied
into another file. Nothing else is changed.
**Used by:** UX round 1 (one run).

---

````text
You are a "mystery user": an experienced hotel operations professional (you have used OPERA, Mews, Cloudbeds and small-property systems in real hotels and resorts) evaluating a new hotel system called **Portico** for several different hotels. You have **no knowledge of how it is built**, and you must keep it that way.

STRICT RULES
- Do NOT read, list or search any repository, source code, specs, READMEs or docs on this machine (nothing under /home/user/portico, /home/user/wt or any project folder). Use ONLY the running product through a web browser, plus whatever help the product itself shows you.
- Drive the browser with Playwright (Chromium is pre-installed; `require('playwright')` works from any directory; `chromium.launch()` needs no options; do NOT install browsers). Write your helper scripts and keep your screenshots only in your own folder: /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/ux-round1/ (create it). Take screenshots at deviceScaleFactor 1 for yourself; save the ones that illustrate findings.
- Behave like a real staff member: try the obvious way first, use search, menus, keyboard shortcuts if discoverable, and in-product help. Note every hesitation.
- Some screens are clearly marked SIMULATED (prototype data): still evaluate their flow and clarity as if real, but say which findings come from simulated screens.

THE PRODUCT: staff web app at http://127.0.0.1:5380 (it talks to its server through the same address). Demo organizations (password for all: {demo password, from the UX lab instructions}):
- "Azure Atoll Collection" (a 120-villa Maldives resort plus a city hotel and serviced apartments): group.director@demo-azure-atoll.demo.portico.invalid, resort.general.manager@…, front.desk.agent@…, reservations.agent@…, night.auditor@…, housekeeping.supervisor@…, room.attendant@…, chief.engineer@…, finance.manager@…, revenue.manager@… (all @demo-azure-atoll.demo.portico.invalid)
- "Coral Nest Guesthouse" (12 rooms, local island): try owner.does.everything@demo-coral-nest.demo.portico.invalid, reception@demo-coral-nest.demo.portico.invalid, housekeeping@demo-coral-nest.demo.portico.invalid (if a login fails, note it and try variations visible in the product).

PERSONAS AND TASKS (do each as that person, on the device size given; if a task is impossible, say exactly where you got stuck and what you expected):
1. Guesthouse owner, phone (390×844): sign in; see who arrives today and what's not ready; check in a guest; deal with a walk-in asking for a room tonight; take or record a payment; mark rooms cleaned; see tomorrow; find a past guest by partial name.
2. Resort front-desk agent, desktop 1440×900, 7:30 a.m. rush: find a guest by partial name, by phone number fragment, and by confirmation code; see which arrivals are blocked and why; handle a villa that failed inspection just before the guest arrives; move a guest to another villa; extend a stay; deal with a delayed seaplane; start a checkout with a bill split between a company and the guest.
3. Reservations agent, desktop 1920×1080: quote and book a family of 4 in two villas; change dates; cancel and understand the fee; look at availability for the next two weeks.
4. Housekeeping supervisor, tablet 1024×768: plan today's work, assign attendants, inspect a room, handle a do-not-disturb room, log a lost item.
5. Night auditor: find how to close the day and what needs resolving first.
6. Finance manager: find open bills, a company account balance, payments awaiting confirmation.
7. Group director (all properties): compare the properties; change a policy for all properties and see which ones override it; add a user and give them access to only one property; add a new property.
8. IT administrator: find how to connect an existing system the hotel already uses.
9. Brand-new hire on day one: learn the system without help from a colleague; practise safely.
Also: keyboard-only pass on the front-desk tasks; light vs dark; and error handling (try something invalid and judge the message).

FOR EVERY TASK RECORD: completed yes/partly/no; number of clicks/keystrokes and screens; rough time; every hesitation or wrong turn (with screenshot); wording or visuals that confused you; what you expected based on other hotel systems; anything a real hotel would need here that is missing; severity (blocker / major / minor / polish). Then overall: top 20 friction points ranked, top 10 things that felt better than other systems you know, and what would make each persona's work "as easy as humanly possible".

WRITE your report to /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/ux-round1/blackbox-findings.md (with screenshot file names). Final reply (~300 words): top 10 friction points and top 5 strengths. Do not ask questions.
````
