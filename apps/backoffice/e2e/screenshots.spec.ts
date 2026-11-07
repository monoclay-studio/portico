import type { Page } from '@playwright/test';
import { apiGet, DIRECTOR, expect, PASSWORD, startSignedIn, test } from './fixtures';

/**
 * Repeatable screenshots (experience architecture §4: regenerate documentation captures whenever the UI
 * changes). deviceScaleFactor 2. Output: apps/backoffice/screenshots/*.png
 */
test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

const shot = (
  page: Page,
  name: string,
  opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {},
) => page.screenshot({ path: `screenshots/${name}.png`, animations: 'disabled', caret: 'hide', ...opts });

async function settle(page: Page) {
  await page.locator('main h1').first().waitFor();
  await page.waitForTimeout(600);
  await page.mouse.move(1, 899);
}

test('sign-in', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Work email').fill(DIRECTOR);
  await shot(page, 'sign-in');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an organization' })).toBeVisible();
  await shot(page, 'sign-in-choose-organization');
});

test('today dashboard light + dark', async ({ page, demo }) => {
  await page.setViewportSize({ width: 1440, height: 1240 });
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/today');
  await settle(page);
  await expect(page.locator('[data-kpi]').first()).toBeVisible();
  await shot(page, 'today-light');
  await startSignedIn(page, demo, { theme: 'dark' });
  await page.goto('/today');
  await settle(page);
  await shot(page, 'today-dark');
});

test('arrivals board, record drawer and change preview', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await expect(page.getByRole('grid', { name: /arrivals for/ })).toBeVisible();
  await shot(page, 'arrivals-board');
  await page
    .getByRole('grid')
    .locator('[role=row][data-row-id]')
    .filter({ hasText: 'failed inspection' })
    .first()
    .click();
  const drawer = page.locator('[data-record-drawer]');
  await expect(drawer.locator('[data-issue-severity="blocking"]').first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'record-drawer-stay');
  // Breadcrumb: open the unit from the related records.
  await drawer.locator('[data-entity-link^="unit:"]').first().click();
  await expect(drawer.getByRole('navigation', { name: 'Record trail' })).toContainText('Villa');
  await page.waitForTimeout(400);
  await shot(page, 'record-drawer-trail');
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: /Extend stay/ }).click();
  const preview = page.getByRole('dialog').filter({ has: page.locator('[data-preview-section]') });
  await expect(preview.locator('[data-preview-section="balance"]')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'change-preview');
});

test('timeline', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/reservations/timeline');
  await settle(page);
  await expect(page.getByRole('grid', { name: 'Timeline' })).toBeVisible();
  await shot(page, 'timeline');
});

test('housekeeping board and my work', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/housekeeping');
  await settle(page);
  await shot(page, 'housekeeping-board');
  await page.goto('/my-work');
  await settle(page);
  await shot(page, 'my-work');
});

test('search and command palette', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await page.keyboard.press('/');
  await page.keyboard.type('azure');
  await expect(page.getByRole('option', { name: /Property/ }).first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'search-palette');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await shot(page, 'keyboard-shortcuts');
});

test('conflict dialog (real 409 from the API)', async ({ page, demo, request }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  const { body: list } = await apiGet<{ items: Array<{ id: string; code: string }> }>(
    request,
    demo,
    '/properties',
  );
  const target = list.items.find((p) => p.code === 'AZH') as { id: string };
  await page.goto(`/settings/properties/${target.id}`);
  await settle(page);
  await page.getByLabel('Check-out time').fill('11:00');
  const { body: current, etag } = await apiGet<{ checkOutTime: string; version: number }>(
    request,
    demo,
    `/properties/${target.id}`,
  );
  const r = await request.patch(`/v1/properties/${target.id}`, {
    headers: { authorization: `Bearer ${demo.token}`, 'if-match': etag ?? `W/"${current.version}"` },
    data: { checkOutTime: current.checkOutTime === '12:30' ? '12:00' : '12:30' },
  });
  expect(r.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Someone else changed this property' })).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'conflict-dialog');
  await page.getByRole('button', { name: 'Discard mine, keep saved version' }).click();
});

test('environment banners: demo and training', async ({ page, demo, training }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/settings/organization');
  await settle(page);
  await shot(page, 'environment-banner-demo');
  await startSignedIn(page, training, { theme: 'light' });
  await page.goto('/learn');
  await settle(page);
  await expect(page.getByRole('region', { name: 'Environment: Training' })).toBeVisible();
  await shot(page, 'environment-banner-training');
});

test('learning centre and help panel', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light' });
  await page.goto('/learn');
  await settle(page);
  await shot(page, 'learning-centre');
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await page.locator('main [data-help-key="frontDesk.arrivals"] button[data-help-key]').first().click();
  await expect(page.locator('[data-help-panel="frontDesk.arrivals"]')).toBeVisible();
  await shot(page, 'help-panel');
});

test('RTL (Arabic stub) and tablet layout', async ({ page, demo }) => {
  await startSignedIn(page, demo, { theme: 'light', locale: 'ar' });
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await shot(page, 'arrivals-rtl');
  await startSignedIn(page, demo, { theme: 'light' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await shot(page, 'arrivals-tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/front-desk/arrivals');
  await settle(page);
  await shot(page, 'arrivals-phone');
});

test('design system examples', async ({ page }) => {
  await page.goto('/design-system');
  await page.getByRole('heading', { name: /Design system/ }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'design-system');
});
