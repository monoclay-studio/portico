# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> back office smoke (real API on :4201) >> key screens have no serious accessibility violations (axe, incl. colour contrast) in light and dark
- Location: e2e/smoke.spec.ts:138:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "dark /today color-contrast: .bg-viz-neutral.text-\\[oklch\\(0\\.18_0_0\\)\\].hover\\:brightness-110 > .normal-case.px-1\\.5.truncate",
+ ]
```

# Page snapshot

```yaml
- generic [ref=f4e2]:
  - generic [ref=f4e3]:
    - link "Skip to main content" [ref=f4e4] [cursor=pointer]:
      - /url: "#main"
    - 'region "Environment: Demo" [ref=f4e5]':
      - generic [ref=f4e6]: Demo
      - generic [ref=f4e10]: Sample data. Nothing here can charge a card, message a guest or reach a real channel.
      - generic [ref=f4e11]: Azure Atoll Collection (demo)
    - generic [ref=f4e12]:
      - complementary [ref=f4e13]:
        - generic [ref=f4e14]:
          - navigation "Workspaces" [ref=f4e15]:
            - generic [aria-hidden] [ref=f4e16]: P
            - list [ref=f4e17]:
              - listitem [ref=f4e18]:
                - link "Overview" [ref=f4e19] [cursor=pointer]:
                  - /url: /today
              - listitem [ref=f4e26]:
                - link "Front desk" [ref=f4e27] [cursor=pointer]:
                  - /url: /front-desk/arrivals
              - listitem [ref=f4e32]:
                - link "Reservations" [ref=f4e33] [cursor=pointer]:
                  - /url: /reservations/timeline
              - listitem [ref=f4e37]:
                - link "Housekeeping" [ref=f4e38] [cursor=pointer]:
                  - /url: /housekeeping
              - listitem [ref=f4e43]:
                - link "Settings" [ref=f4e44] [cursor=pointer]:
                  - /url: /settings/organization
          - navigation "Overview" [ref=f4e50]:
            - generic [ref=f4e51]:
              - heading "Overview" [level=2] [ref=f4e52]
              - list [ref=f4e53]:
                - listitem [ref=f4e54]:
                  - link "Today G D" [ref=f4e55] [cursor=pointer]:
                    - /url: /today
                    - generic [ref=f4e62]: Today
                    - generic [ref=f4e63]:
                      - generic [ref=f4e64]: G
                      - generic [ref=f4e65]: D
                - listitem [ref=f4e66]:
                  - link "My work G W" [ref=f4e67] [cursor=pointer]:
                    - /url: /my-work
                    - generic [ref=f4e71]: My work
                    - generic [ref=f4e72]:
                      - generic [ref=f4e73]: G
                      - generic [ref=f4e74]: W
                - listitem [ref=f4e75]:
                  - link "Learning centre G L" [ref=f4e76] [cursor=pointer]:
                    - /url: /learn
                    - generic [ref=f4e80]: Learning centre
                    - generic [ref=f4e81]:
                      - generic [ref=f4e82]: G
                      - generic [ref=f4e83]: L
      - generic [ref=f4e84]:
        - banner [ref=f4e85]:
          - 'button "Switch property: Azure Atoll Resort & Spa, Baa Atoll" [ref=f4e87]':
            - generic [ref=f4e92]:
              - generic [ref=f4e93]: Azure Atoll Resort & Spa, Baa Atoll
              - generic [ref=f4e94]: AZR · Business date 2026-11-07
          - button "Search guests, bookings, units, properties, people… / Ctrl K" [ref=f4e98]:
            - generic [ref=f4e102]: Search guests, bookings, units, properties, people…
            - generic [ref=f4e103]: /
            - generic [ref=f4e104]: Ctrl
            - generic [ref=f4e105]: K
          - button "Help for this screen" [ref=f4e106]
          - 'button "Account: Group Director" [ref=f4e111]'
        - status [ref=f4e116]
        - main [ref=f4e117]:
          - generic [ref=f4e118]:
            - generic [ref=f4e120]:
              - generic [ref=f4e121]: Azure Atoll Resort & Spa, Baa Atoll · Business date 2026-11-07
              - generic [ref=f4e122]:
                - heading "Today" [level=1] [ref=f4e123]
                - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings. · last synced now" [ref=f4e124]':
                  - generic [ref=f4e127]: Simulated
                  - generic [ref=f4e128]: · last synced now
                - button "Help for this screen" [ref=f4e129]
              - paragraph [ref=f4e134]: The shape of the day at Azure Atoll Resort & Spa, Baa Atoll. Every number opens the records behind it.
            - generic [ref=f4e135]:
              - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e136]':
                - generic [ref=f4e139]: Simulated
              - generic [ref=f4e140]: This workspace shows SIMULATED sample data while the reservations + operations + payments module is being built. Actions here change only the simulation.
            - region "Today" [ref=f4e141]:
              - generic [ref=f4e142]:
                - generic [ref=f4e143]:
                  - heading "Occupancy tonight" [level=3] [ref=f4e148]
                  - button "About Occupancy tonight" [ref=f4e149]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e153]':
                    - generic [ref=f4e156]: Simulated
                - 'button "Occupancy tonight: 82%, 98 of 119 units. Open the records behind Occupancy tonight" [ref=f4e157]':
                  - generic [ref=f4e158]:
                    - generic [ref=f4e159]: 82%
                    - generic [ref=f4e160]:
                      - generic [ref=f4e164]: down
                      - text: −7 pts
                      - generic [ref=f4e165]: vs same night last week
                  - generic [ref=f4e168]:
                    - generic [ref=f4e169]: 98 of 119 units
                    - generic [ref=f4e170]: 1 OUT OF ORDER
                    - generic [ref=f4e171]: vs same night last week
              - generic [ref=f4e172]:
                - generic [ref=f4e173]:
                  - heading "Arrivals" [level=3] [ref=f4e178]
                  - button "About Arrivals" [ref=f4e179]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e183]':
                    - generic [ref=f4e186]: Simulated
                - 'button "Arrivals: 17, 10 of 17 ready. Open the records behind Arrivals" [ref=f4e187]':
                  - generic [ref=f4e188]:
                    - generic [ref=f4e189]: "17"
                    - generic [ref=f4e190]:
                      - generic [ref=f4e194]: up
                      - text: "+4"
                      - generic [ref=f4e195]: vs same night last week
                  - generic [ref=f4e198]:
                    - generic [ref=f4e199]: 10 of 17 ready
                    - generic [ref=f4e200]: vs same night last week
              - generic [ref=f4e201]:
                - generic [ref=f4e202]:
                  - heading "Departures" [level=3] [ref=f4e207]
                  - button "About Departures" [ref=f4e208]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e212]':
                    - generic [ref=f4e215]: Simulated
                - generic [ref=f4e216]:
                  - generic [ref=f4e217]: "15"
                  - generic [ref=f4e221]: 10 of 15 checked out
              - generic [ref=f4e223]:
                - generic [ref=f4e224]:
                  - heading "In house" [level=3] [ref=f4e228]
                  - button "About In house" [ref=f4e229]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e233]':
                    - generic [ref=f4e236]: Simulated
                - 'button "In house: 99. Open the records behind In house" [ref=f4e237]':
                  - generic [ref=f4e238]: "99"
                  - generic [ref=f4e240]: 210 GUESTS
              - generic [ref=f4e242]:
                - generic [ref=f4e243]:
                  - heading "Open exceptions" [level=3] [ref=f4e247]
                  - button "About Open exceptions" [ref=f4e248]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e252]':
                    - generic [ref=f4e255]: Simulated
                - 'button "Open exceptions: 9. Open the records behind Open exceptions" [ref=f4e256]':
                  - generic [ref=f4e257]:
                    - generic [ref=f4e258]: "9"
                    - generic [ref=f4e259]:
                      - generic [ref=f4e263]: down
                      - text: −2
                      - generic [ref=f4e264]: vs yesterday
                  - generic [ref=f4e265]:
                    - generic [ref=f4e266]: 5 URGENT
                    - generic [ref=f4e267]: vs yesterday
              - generic [ref=f4e268]:
                - generic [ref=f4e269]:
                  - heading "Payments pending verification" [level=3] [ref=f4e274]
                  - button "About Payments pending verification" [ref=f4e275]
                  - 'button "Data source: Simulated. Sample data produced by a simulator. Not real guests, money or bookings." [ref=f4e279]':
                    - generic [ref=f4e282]: Simulated
                - 'button "Payments pending verification: 2. Open the records behind Payments pending verification" [ref=f4e283]':
                  - generic [ref=f4e284]: "2"
                  - generic [ref=f4e286]: $2,287.16 AWAITING CONFIRMATION
            - generic [ref=f4e288]:
              - heading "Where today’s arrivals stand" [level=2] [ref=f4e290]
              - generic [ref=f4e291]:
                - paragraph [ref=f4e292]: Which arrivals still need something before check-in?
                - figure "Where today’s arrivals stand" [ref=f4e293]:
                  - list [ref=f4e294]:
                    - listitem [ref=f4e295]:
                      - 'button "Checked in: 2 of 17 arrivals (12%)" [ref=f4e296]':
                        - generic [aria-hidden] [ref=f4e297]: 12%
                    - listitem [ref=f4e299]:
                      - 'button "Ready: 4 of 17 arrivals (24%)" [ref=f4e300]':
                        - generic [aria-hidden] [ref=f4e301]: 24%
                    - listitem [ref=f4e303]:
                      - 'button "Ready, needs attention: 4 of 17 arrivals (24%)" [ref=f4e304]':
                        - generic [aria-hidden] [ref=f4e305]: 24%
                    - listitem [ref=f4e307]:
                      - 'button "Blocked: 7 of 17 arrivals (41%)" [ref=f4e308]':
                        - generic [aria-hidden] [ref=f4e309]: 41%
                  - generic [ref=f4e311]:
                    - generic [ref=f4e312]: "Legend:"
                    - list [ref=f4e313]:
                      - listitem [ref=f4e314]: Checked in
                      - listitem [ref=f4e319]: Ready
                      - listitem [ref=f4e325]: Ready, needs attention
                      - listitem [ref=f4e330]: Blocked
            - generic [ref=f4e335]:
              - generic [ref=f4e336]:
                - heading "Occupancy for the next 14 nights by unit type" [level=2] [ref=f4e337]
                - button "Show as table" [ref=f4e338]
              - generic [ref=f4e340]:
                - paragraph [ref=f4e341]: Where is the pressure in the next two weeks?
                - list "Occupancy for the next 14 nights by unit type" [ref=f4e342]:
                  - listitem [ref=f4e343]:
                    - generic [ref=f4e344]:
                      - generic [ref=f4e345]:
                        - heading "Beach Villa" [level=4] [ref=f4e346]
                        - generic [ref=f4e347]: Nov 7 · 75%
                      - group "Beach Villa" [ref=f4e348]:
                        - generic [ref=f4e349]: Nov 7 75%, Nov 8 87%, Nov 9 92%, Nov 10 95%, Nov 11 89%, Nov 12 97%, Nov 13 80%, Nov 14 83%, Nov 15 80%, Nov 16 78%, Nov 17 83%, Nov 18 80%, Nov 19 80%, Nov 20 88%
                      - generic [aria-hidden] [ref=f4e378]:
                        - generic [ref=f4e379]: "07"
                        - generic [ref=f4e380]: "20"
                  - listitem [ref=f4e381]:
                    - generic [ref=f4e382]:
                      - generic [ref=f4e383]:
                        - heading "Beach Villa with Pool" [level=4] [ref=f4e384]
                        - generic [ref=f4e385]: Nov 7 · 85%
                      - group "Beach Villa with Pool" [ref=f4e386]:
                        - generic [ref=f4e387]: Nov 7 85%, Nov 8 90%, Nov 9 95%, Nov 10 90%, Nov 11 85%, Nov 12 70%, Nov 13 80%, Nov 14 90%, Nov 15 95%, Nov 16 95%, Nov 17 95%, Nov 18 90%, Nov 19 90%, Nov 20 90%
                      - generic [aria-hidden] [ref=f4e416]:
                        - generic [ref=f4e417]: "07"
                        - generic [ref=f4e418]: "20"
                  - listitem [ref=f4e419]:
                    - generic [ref=f4e420]:
                      - generic [ref=f4e421]:
                        - heading "Water Villa" [level=4] [ref=f4e422]
                        - generic [ref=f4e423]: Nov 7 · 90%
                      - group "Water Villa" [ref=f4e424]:
                        - generic [ref=f4e425]: Nov 7 90%, Nov 8 82%, Nov 9 82%, Nov 10 77%, Nov 11 83%, Nov 12 80%, Nov 13 80%, Nov 14 83%, Nov 15 83%, Nov 16 93%, Nov 17 90%, Nov 18 93%, Nov 19 88%, Nov 20 88%
                      - generic [aria-hidden] [ref=f4e454]:
                        - generic [ref=f4e455]: "07"
                        - generic [ref=f4e456]: "20"
                  - listitem [ref=f4e457]:
                    - generic [ref=f4e458]:
                      - generic [ref=f4e459]:
                        - heading "Sunset Water Villa with Pool" [level=4] [ref=f4e460]
                        - generic [ref=f4e461]: Nov 7 · 75%
                      - group "Sunset Water Villa with Pool" [ref=f4e462]:
                        - generic [ref=f4e463]: Nov 7 75%, Nov 8 81%, Nov 9 88%, Nov 10 88%, Nov 11 100%, Nov 12 100%, Nov 13 100%, Nov 14 94%, Nov 15 94%, Nov 16 88%, Nov 17 81%, Nov 18 75%, Nov 19 75%, Nov 20 75%
                      - generic [aria-hidden] [ref=f4e492]:
                        - generic [ref=f4e493]: "07"
                        - generic [ref=f4e494]: "20"
                  - listitem [ref=f4e495]:
                    - generic [ref=f4e496]:
                      - generic [ref=f4e497]:
                        - heading "Two-Bedroom Beach Residence" [level=4] [ref=f4e498]
                        - generic [ref=f4e499]: Nov 7 · 100%
                      - group "Two-Bedroom Beach Residence" [ref=f4e500]:
                        - generic [ref=f4e501]: Nov 7 100%, Nov 8 100%, Nov 9 100%, Nov 10 100%, Nov 11 100%, Nov 12 50%, Nov 13 25%, Nov 14 50%, Nov 15 75%, Nov 16 75%, Nov 17 75%, Nov 18 75%, Nov 19 75%, Nov 20 75%
                      - generic [aria-hidden] [ref=f4e530]:
                        - generic [ref=f4e531]: "07"
                        - generic [ref=f4e532]: "20"
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  60  |     await expect(page).toHaveURL(/\/front-desk\/arrivals/);
  61  | 
  62  |     await page.keyboard.press('/');
  63  |     await page.keyboard.type('AZH');
  64  |     await expect(
  65  |       page.getByRole('option', { name: /Azure Lagoon Hotel, Hulhumalé.*Property/ }).first(),
  66  |     ).toBeVisible();
  67  |     await page
  68  |       .getByRole('option', { name: /Azure Lagoon Hotel, Hulhumalé.*Property/ })
  69  |       .first()
  70  |       .click();
  71  |     const drawer = page.locator('[data-record-drawer]');
  72  |     await expect(drawer.getByRole('heading', { name: 'Azure Lagoon Hotel, Hulhumalé' })).toBeVisible();
  73  |     await expect(drawer.locator('[data-history-action="platform.property.create"]')).toBeVisible(); // GET /v1/records/property/:id/history
  74  |     await page.keyboard.press('Escape');
  75  |     await expect(drawer).toHaveCount(0);
  76  |     await expect(page).toHaveURL(/\/front-desk\/arrivals/);
  77  |   });
  78  | 
  79  |   test('arrivals board shows readiness and the single blocker; a record opens over the board', async ({
  80  |     page,
  81  |     demo,
  82  |   }) => {
  83  |     await startSignedIn(page, demo);
  84  |     await page.goto('/front-desk/arrivals');
  85  |     const grid = page.getByRole('grid', { name: /arrivals for/ });
  86  |     await expect(grid).toBeVisible();
  87  |     await expect(page.getByRole('button', { name: /Data source: Simulated/ }).first()).toBeVisible();
  88  |     const blocked = grid.locator('[role=row][data-row-id]').filter({ hasText: 'failed inspection' }).first();
  89  |     await expect(blocked).toBeVisible();
  90  |     await blocked.click();
  91  |     const drawer = page.locator('[data-record-drawer]');
  92  |     await expect(drawer.locator('[data-issue-severity="blocking"]').first()).toContainText(
  93  |       'failed inspection',
  94  |     );
  95  |     await expect(drawer.getByRole('button', { name: 'Check in' })).toHaveAttribute('aria-disabled', 'true');
  96  |     // Keyboard: Esc returns to the board with its state intact.
  97  |     await page.keyboard.press('Escape');
  98  |     await expect(grid).toBeVisible();
  99  |   });
  100 | 
  101 |   test('409 version conflict: shows yours vs theirs and re-applies on the latest version', async ({
  102 |     page,
  103 |     demo,
  104 |     request,
  105 |   }) => {
  106 |     await startSignedIn(page, demo);
  107 |     const { body: list } = await apiGet<{ items: Property[] }>(request, demo, '/properties');
  108 |     const target = list.items.find((p) => p.code === 'AZA') as Property;
  109 |     await page.goto(`/settings/properties/${target.id}`);
  110 |     await expect(page.getByRole('heading', { name: target.name })).toBeVisible();
  111 |     // Values differ on every run so the test is repeatable against the same dev database.
  112 |     const mine = target.checkInTime === '13:00' ? '13:30' : '13:00';
  113 |     const theirsTime = target.checkInTime === '15:00' ? '15:30' : '15:00';
  114 |     const theirsName = `${target.name.replace(/ \(edited [0-9]+\)$/, '')} (edited ${Date.now() % 100000})`;
  115 |     // I change the check-in time…
  116 |     await page.getByLabel('Check-in time').fill(mine);
  117 |     // …while a colleague saves a different check-in time and a new name first.
  118 |     const { body: current, etag } = await apiGet<Property>(request, demo, `/properties/${target.id}`);
  119 |     const theirs = await request.patch(`/v1/properties/${target.id}`, {
  120 |       headers: { authorization: `Bearer ${demo.token}`, 'if-match': etag ?? `W/"${current.version}"` },
  121 |       data: { checkInTime: theirsTime, name: theirsName },
  122 |     });
  123 |     expect(theirs.ok(), await theirs.text()).toBeTruthy();
  124 |     await page.getByRole('button', { name: 'Save changes' }).click();
  125 |     const dialog = page.getByRole('dialog', { name: 'Someone else changed this property' });
  126 |     await expect(dialog).toBeVisible();
  127 |     await expect(dialog.locator('[data-conflict="both"]')).toContainText(mine);
  128 |     await expect(dialog.locator('[data-conflict="both"]')).toContainText(theirsTime);
  129 |     await expect(dialog.locator('[data-conflict="theirs"]')).toContainText(theirsName);
  130 |     await dialog.getByRole('button', { name: 'Re-apply my changes' }).click();
  131 |     await expect(page.getByText('Your changes were re-applied on top of the latest version.')).toBeVisible();
  132 |     const { body: after } = await apiGet<Property>(request, demo, `/properties/${target.id}`);
  133 |     expect(after.checkInTime).toBe(mine);
  134 |     expect(after.name).toBe(theirsName); // their change survived: no lost update
  135 |     expect(after.version).toBe(current.version + 2);
  136 |   });
  137 | 
  138 |   test('key screens have no serious accessibility violations (axe, incl. colour contrast) in light and dark', async ({
  139 |     page,
  140 |     demo,
  141 |   }) => {
  142 |     for (const theme of ['light', 'dark'] as const) {
  143 |       await startSignedIn(page, demo, { theme });
  144 |       for (const path of ['/today', '/front-desk/arrivals', '/housekeeping', '/settings/users']) {
  145 |         await page.goto(path);
  146 |         await page.locator('main h1').first().waitFor();
  147 |         await page.waitForTimeout(400);
  148 |         const results = await new AxeBuilder({ page })
  149 |           .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
  150 |           .analyze();
  151 |         const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  152 |         expect(
  153 |           serious.map(
  154 |             (v) =>
  155 |               `${theme} ${path} ${v.id}: ${v.nodes
  156 |                 .slice(0, 3)
  157 |                 .map((n) => n.target.join(' '))
  158 |                 .join(' | ')}`,
  159 |           ),
> 160 |         ).toEqual([]);
      |           ^ Error: expect(received).toEqual(expected) // deep equality
  161 |       }
  162 |     }
  163 |   });
  164 | });
  165 | 
```