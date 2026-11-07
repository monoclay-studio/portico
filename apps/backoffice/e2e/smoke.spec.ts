import AxeBuilder from '@axe-core/playwright';
import { apiGet, DEMO_ORG, DIRECTOR, expect, FRONT_DESK, PASSWORD, startSignedIn, test } from './fixtures';

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
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole('region', { name: 'Environment: Demo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  });

  test('P0-1: after a session ends on a shared tab, the next person sees none of the previous data', async ({ page, request }) => {
    // The director signs in and opens the staff list.
    await page.goto('/sign-in');
    await page.getByLabel('Work email').fill(DIRECTOR);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText(DEMO_ORG).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.goto('/settings/users');
    await expect(page.getByRole('grid', { name: 'Users & roles' })).toContainText('Front Desk Agent');
    // The server ends that session (idle timeout / revoked).
    const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('portico.session.v1') ?? '{}').token as string);
    const revoked = await request.post('/v1/auth/logout', { headers: { authorization: `Bearer ${token}` } });
    expect(revoked.status()).toBe(204);
    // The next request gets a 401; the tab goes to sign-in and remembers where it was.
    await page.getByRole('tab', { name: /Roles/ }).click();
    await page.getByRole('button', { name: 'Refresh' }).first().click().catch(() => {});
    await page.goto('/settings/users');
    await expect(page).toHaveURL(/\/sign-in/);
    // A front-desk agent signs in on the same tab.
    await page.getByLabel('Work email').fill(FRONT_DESK);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: /Account: Front Desk Agent/ })).toBeVisible();
    await page.goto('/settings/users');
    // No cached staff list: the server refuses this user and the screen says so.
    await expect(page.getByRole('alert')).toContainText(/do not have permission|don.t have access/i);
    await expect(page.getByText('finance.manager@demo-azure-atoll.demo.portico.invalid')).toHaveCount(0);
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
    await expect(page.getByText(/Azure Lagoon Hotel, Hulhumalé · Business date/)).toBeVisible();
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
    await expect(page.getByRole('button', { name: /Data source: Simulated/ }).first()).toBeVisible();
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

  test('key screens have no serious accessibility violations (axe, incl. colour contrast) in light and dark', async ({
    page,
    demo,
  }) => {
    for (const theme of ['light', 'dark'] as const) {
      await startSignedIn(page, demo, { theme });
      for (const path of ['/today', '/front-desk/arrivals', '/housekeeping', '/settings/users']) {
        await page.goto(path);
        await page.locator('main h1').first().waitFor();
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(
          serious.map(
            (v) =>
              `${theme} ${path} ${v.id}: ${v.nodes
                .slice(0, 3)
                .map((n) => n.target.join(' '))
                .join(' | ')}`,
          ),
        ).toEqual([]);
      }
    }
  });
});
