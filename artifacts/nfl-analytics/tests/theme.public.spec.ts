import { test, expect } from '@playwright/test';
import { expectBootstrapTheme, expectKeyboardRing, expectNoHorizontalOverflow, expectTheme } from './theme.helpers';

test('desktop starts dark before React, keeps both choices on reload and public navigation', async ({ page }) => {
  await expectBootstrapTheme(page, '/', 'dark');
  const toggle = page.locator('.consumer-account .theme-toggle');
  await expect(toggle).toBeVisible();
  await expectTheme(page, 'dark');
  await expectKeyboardRing(page, '.consumer-account .theme-toggle');
  await page.keyboard.press('Enter');
  await expectTheme(page, 'light');
  await expectBootstrapTheme(page, '/', 'light');
  await expectTheme(page, 'light');
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Games', exact: true }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expectTheme(page, 'light');
  await toggle.click();
  await expectTheme(page, 'dark');
  await expectBootstrapTheme(page, '/games', 'dark');
  await expectTheme(page, 'dark');
});

test('mobile menu and visible theme control remain keyboard-accessible without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const menu = page.locator('.consumer-account .consumer-menu-toggle');
  const toggle = page.locator('.consumer-account .theme-toggle');
  await expect(menu).toBeVisible();
  await expect(toggle).toBeVisible();
  await expectKeyboardRing(page, '.consumer-account .consumer-menu-toggle');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await mobileNav.getByRole('link', { name: 'Games', exact: true }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole('heading', { name: 'Gridline market board' })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expectNoHorizontalOverflow(page);
  await expectKeyboardRing(page, '.consumer-account .theme-toggle');
  await page.keyboard.press('Enter');
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'light');
  await expect(page.getByRole('heading', { name: 'Gridline market board' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const motion = await toggle.evaluate(element => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration, scroll: getComputedStyle(document.documentElement).scrollBehavior };
  });
  expect(motion.duration.split(',').every(value => parseFloat(value) <= 0.001)).toBe(true);
  expect(motion.scroll).toBe('auto');
});

test('signed-out Home and authentication agree whether a weekly pick is available', async ({ page }) => {
  const cases = [
    { width: 1280, theme: 'dark', pick: { gameId: 'fixture', teamName: 'Fixture Team', season: 2026, week: 3, probability: 0.7, observedAt: '2026-09-25T12:00:00Z' }, reason: null },
    { width: 390, theme: 'light', pick: null, reason: 'Initial-line pick evidence is unavailable.' },
  ] as const;
  for (const scenario of cases) {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await page.route('**/api/consumer/dashboard*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'available', games: [], initialWeeklyPick: { pick: scenario.pick, reason: scenario.reason } }),
    }));
    await page.goto('/');
    if (scenario.theme === 'light') {
      await page.locator('.consumer-account .theme-toggle').click();
    }
    await expectTheme(page, scenario.theme);
    await expect(page.getByRole('heading', { name: 'Pick of the week' })).toBeVisible();
    if (scenario.pick) await expect(page.getByTestId('weekly-pick-team')).toHaveText('Fixture Team');
    else await expect(page.getByText(scenario.reason!, { exact: true })).toBeVisible();

    if (scenario.width < 600) {
      await page.locator('.consumer-account .consumer-menu-toggle').click();
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Sign in' }).click();
    } else {
      await page.locator('.consumer-account').getByRole('link', { name: 'Sign in' }).click();
    }
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('Picks appear only when eligible evidence is available; sometimes there may be no pick.')).toBeVisible();
    await expect(page.locator('img[src$="gridline-auth-field.svg"]')).toHaveAttribute('alt', '');
    await expect(page.getByRole('link', { name: 'Return home' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTheme(page, scenario.theme);

    await page.goto('/sign-up');
    await expect(page.getByText('Picks appear only when eligible evidence is available; sometimes there may be no pick.')).toBeVisible();
    await expect(page.locator('img[src$="gridline-auth-field.svg"]')).toHaveAttribute('aria-hidden', 'true');
    await expectNoHorizontalOverflow(page);
    await page.getByRole('link', { name: 'Return home' }).click();
    await expect(page).toHaveURL(/\/$/);
    if (scenario.pick) await expect(page.getByTestId('weekly-pick-team')).toHaveText('Fixture Team');
    else await expect(page.getByText(scenario.reason!, { exact: true })).toBeVisible();
    await page.unroute('**/api/consumer/dashboard*');
  }
});
