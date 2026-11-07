import AxeBuilder from '@axe-core/playwright';
import { codeCandidates, totpForStep } from './demo-authenticator';
import {
  apiGet,
  DEMO_ORG,
  DIRECTOR,
  enterSignInCode,
  expect,
  FRONT_DESK,
  PASSWORD,
  startSignedIn,
  test,
} from './fixtures';

interface Property {
  id: string;
  code: string;
  name: string;
  checkInTime: string;
  version: number;
}

test.describe('back office smoke (real API on :4100)', () => {
  test('signs in with organization selection and shows the demo environment banner', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
    await page.getByLabel('Work email').fill(DIRECTOR);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose an organization' })).toBeVisible();
    await page.getByText(DEMO_ORG).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    // Demo users have two-step verification (ADR-0017 rule 16): the code from the authenticator app comes next.
    await enterSignInCode(page, DIRECTOR);
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole('region', { name: 'Environment: Demo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  });

  test('P0-1: after a session ends on a shared tab, the next person sees none of the previous data', async ({
    page,
    request,
  }) => {
    // The director signs in and opens the staff list.
    await page.goto('/sign-in');
    await page.getByLabel('Work email').fill(DIRECTOR);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText(DEMO_ORG).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await enterSignInCode(page, DIRECTOR);
    await expect(page).not.toHaveURL(/sign-in/);
    await page.goto('/settings/users');
    await expect(page.getByRole('grid', { name: 'Users & roles' })).toContainText('Front Desk Agent');
    // The server ends that session (idle timeout / revoked).
    const token = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('portico.session.v1') ?? '{}').token as string,
    );
    const revoked = await request.post('/v1/auth/logout', { headers: { authorization: `Bearer ${token}` } });
    expect(revoked.status()).toBe(204);
    // The next request gets a 401; the tab goes to sign-in and remembers where it was.
    await page.goto('/settings/users');
    await expect(page).toHaveURL(/\/sign-in/);
    // A front-desk agent signs in on the same tab.
    await page.getByLabel('Work email').fill(FRONT_DESK);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await enterSignInCode(page, FRONT_DESK);
    await expect(page.getByRole('button', { name: /Account: Front Desk Agent/ })).toBeVisible();
    await page.goto('/settings/users');
    // No cached staff list: the server refuses this user and the screen says so.
    await expect(page.getByRole('alert')).toContainText(/do not have permission|don.t have access/i);
    await expect(page.getByText('finance.manager@demo-azure-atoll.demo.portico.invalid')).toHaveCount(0);
  });

  test('sign-in code step: keyboard-first, a wrong code is explained at the field, the right one signs in', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Work email').fill(FRONT_DESK);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Enter your sign-in code' })).toBeVisible();
    const field = page.getByLabel('6-digit code');
    await expect(field).toBeFocused();
    await expect(page.getByRole('button', { name: 'Use a recovery code instead' })).toBeVisible();
    await expect(page.getByText(/demo authenticator secret/)).toBeVisible();
    // A code that no step around now produces: refused at the field, with the tries left, on the same step.
    const valid = new Set(codeCandidates(FRONT_DESK).map((c) => c.code));
    let wrong = totpForStep(0);
    while (valid.has(wrong)) wrong = String((Number(wrong) + 1) % 1_000_000).padStart(6, '0');
    await field.fill(wrong);
    await field.press('Enter');
    await expect(page.getByText(/That code is not right\. .*4 more tries/)).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/sign-in/);
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.impact} ${v.id}`)).toEqual([]);
    await enterSignInCode(page, FRONT_DESK);
    await expect(page.getByRole('button', { name: /Account: Front Desk Agent/ })).toBeVisible();
  });

  test('wrong password explains the problem and keeps the reference id', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Work email').fill(DIRECTOR);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Reference');
  });

  test('switches property from the top bar', async ({ page, demo }) => {
    await startSignedIn(page, demo);
    await page.goto('/front-desk/arrivals');
    const switcher = page.getByTestId('property-switcher');
    await expect(switcher).toContainText('Azure Atoll Resort');
    await switcher.click();
    await page.getByRole('menuitemradio', { name: /Azure Lagoon Hotel/ }).click();
    await expect(switcher).toContainText('Azure Lagoon Hotel');
    await expect(switcher).toContainText(/Business date \d{4}-\d{2}-\d{2}/);
  });

  test('command palette (Ctrl+K) navigates; global search (/) finds real records and opens the drawer', async ({
    page,
    demo,
  }) => {
    await startSignedIn(page, demo);
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('arrivals');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/front-desk\/arrivals/);

    await page.keyboard.press('/');
    await page.keyboard.type('AZH');
    await expect(
      page.getByRole('option', { name: /Azure Lagoon Hotel, Hulhumalé.*Property/ }).first(),
    ).toBeVisible();
    await page
      .getByRole('option', { name: /Azure Lagoon Hotel, Hulhumalé.*Property/ })
      .first()
      .click();
    const drawer = page.locator('[data-record-drawer]');
    await expect(drawer.getByRole('heading', { name: 'Azure Lagoon Hotel, Hulhumalé' })).toBeVisible();
    await expect(drawer.locator('[data-history-action="platform.property.create"]')).toBeVisible(); // GET /v1/records/property/:id/history
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/front-desk\/arrivals/);
  });

  test('arrivals board shows readiness and the single blocker; a record opens over the board', async ({
    page,
    demo,
  }) => {
    await startSignedIn(page, demo);
    await page.goto('/front-desk/arrivals');
    const grid = page.getByRole('grid', { name: /arrivals for/ });
    await expect(grid).toBeVisible();
    await expect(page.getByRole('button', { name: /^Simulated/ }).first()).toBeVisible();
    const blocked = grid.locator('[role=row][data-row-id]').filter({ hasText: 'failed inspection' }).first();
    await expect(blocked).toBeVisible();
    await blocked.click();
    const drawer = page.locator('[data-record-drawer]');
    await expect(drawer.locator('[data-issue-severity="blocking"]').first()).toContainText(
      'failed inspection',
    );
    await expect(drawer.getByRole('button', { name: 'Check in' })).toHaveAttribute('aria-disabled', 'true');
    // Keyboard: Esc returns to the board with its state intact.
    await page.keyboard.press('Escape');
    await expect(grid).toBeVisible();
  });

  test('409 version conflict: shows yours vs theirs and re-applies on the latest version', async ({
    page,
    demo,
    request,
  }) => {
    await startSignedIn(page, demo);
    const { body: list } = await apiGet<{ items: Property[] }>(request, demo, '/properties');
    const target = list.items.find((p) => p.code === 'AZA') as Property;
    await page.goto(`/settings/properties/${target.id}`);
    await expect(page.getByRole('heading', { name: target.name })).toBeVisible();
    // Values differ on every run so the test is repeatable against the same dev database.
    const mine = target.checkInTime === '13:00' ? '13:30' : '13:00';
    const theirsTime = target.checkInTime === '15:00' ? '15:30' : '15:00';
    const theirsName = `${target.name.replace(/ \(edited [0-9]+\)$/, '')} (edited ${Date.now() % 100000})`;
    // I change the check-in time…
    await page.getByLabel('Check-in time').fill(mine);
    // …while a colleague saves a different check-in time and a new name first.
    const { body: current, etag } = await apiGet<Property>(request, demo, `/properties/${target.id}`);
    const theirs = await request.patch(`/v1/properties/${target.id}`, {
      headers: { authorization: `Bearer ${demo.token}`, 'if-match': etag ?? `W/"${current.version}"` },
      data: { checkInTime: theirsTime, name: theirsName },
    });
    expect(theirs.ok(), await theirs.text()).toBeTruthy();
    await page.getByRole('button', { name: 'Save changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Someone else changed this property' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-conflict="both"]')).toContainText(mine);
    await expect(dialog.locator('[data-conflict="both"]')).toContainText(theirsTime);
    await expect(dialog.locator('[data-conflict="theirs"]')).toContainText(theirsName);
    await dialog.getByRole('button', { name: 'Re-apply my changes' }).click();
    await expect(page.getByText('Your changes were re-applied on top of the latest version.')).toBeVisible();
    const { body: after } = await apiGet<Property>(request, demo, `/properties/${target.id}`);
    expect(after.checkInTime).toBe(mine);
    expect(after.name).toBe(theirsName); // their change survived: no lost update
    expect(after.version).toBe(current.version + 2);
  });

  test('keyboard: Enter opens the record with focus inside; j shows the next arrival; Esc returns to the row (C4, FD-13)', async ({
    page,
    demo,
  }) => {
    await startSignedIn(page, demo);
    await page.goto('/front-desk/arrivals');
    const grid = page.getByRole('grid', { name: /arrivals for/ });
    await grid.locator('[data-cell="0:0"]').focus();
    await page.keyboard.press('Enter');
    const drawer = page.locator('[data-record-drawer]');
    await expect(drawer).toBeVisible();
    // Focus moved into the record (not left behind on the board).
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-record-drawer]'))))
      .toBe(true);
    const first = (await drawer.locator('h1, h2').first().textContent()) ?? '';
    // Split view: the board stays usable beside the panel; j shows the next arrival without closing.
    await page.keyboard.press('j');
    await expect(drawer.locator('h1, h2').first()).not.toHaveText(first);
    await expect(grid.locator('[role=row][aria-current="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role=grid]'))))
      .toBe(true);
  });

  test('Today tiles equal the lists they open; g d opens Departures, g i In house (NAV-07, C2)', async ({
    page,
    demo,
  }) => {
    await startSignedIn(page, demo);
    await page.goto('/today');
    const tile = page.locator('[data-kpi="Arrivals"]');
    const value = ((await tile.locator('[data-kpi-value]').textContent()) ?? '').trim();
    await tile.getByRole('button', { name: /^Arrivals:/ }).click();
    await expect(page).toHaveURL(/\/front-desk\/arrivals/);
    await expect(page.locator('[data-desk-filter="all"]')).toContainText(value);
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page).toHaveURL(/\/front-desk\/departures/);
    await expect(page.getByRole('heading', { name: 'Departures' })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(page).toHaveURL(/\/front-desk\/in-house/);
    // An in-house stay is never "Ready" (C3.2).
    await expect(page.getByRole('grid').getByText('Ready for check-in')).toHaveCount(0);
  });

  test('no horizontal page scroll at 1024 px (tablet) on the boards (NAV-05, HK-09)', async ({
    page,
    demo,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await startSignedIn(page, demo);
    for (const path of ['/today', '/front-desk/arrivals', '/housekeeping', '/my-work', '/settings/users']) {
      await page.goto(path);
      await page.locator('main h1').first().waitFor();
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });

  test('axe: no violations of any impact on every screen, with the record drawer and the palette open, light and dark', async ({
    page,
    demo,
  }) => {
    test.setTimeout(420_000);
    const check = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      return results.violations.map(
        (v) =>
          `${label} ${v.impact} ${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      );
    };
    const found: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      await startSignedIn(page, demo, { theme });
      for (const path of [
        '/today',
        '/my-work',
        '/front-desk/arrivals',
        '/front-desk/in-house',
        '/front-desk/departures',
        '/housekeeping',
        '/reservations/timeline',
        '/learn',
        '/settings/users',
      ]) {
        await page.goto(path);
        await page.locator('main h1').first().waitFor();
        await page.waitForTimeout(400);
        found.push(...(await check(`${theme} ${path}`)));
      }
      // Overlays: the record drawer over the arrivals board, then the command palette.
      await page.goto('/front-desk/arrivals');
      await page.locator('[role=row][data-row-id]').first().click();
      await page.locator('[data-record-drawer] h1, [data-record-drawer] h2').first().waitFor();
      await page.waitForTimeout(300);
      found.push(...(await check(`${theme} drawer`)));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      await page.keyboard.type('arr');
      await page.waitForTimeout(300);
      found.push(...(await check(`${theme} palette`)));
      await page.keyboard.press('Escape');
    }
    expect(found).toEqual([]);
  });
});
