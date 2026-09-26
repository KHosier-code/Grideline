import { test, expect } from '@playwright/test';
import { expectBootstrapTheme, expectKeyboardRing, expectNoHorizontalOverflow, expectTheme } from './theme.helpers';

test.use({ storageState: process.env.GRIDLINE_ADMIN_STORAGE_STATE! });

test('authorized Admin shell preserves theme across routes and reloads', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('gridline-theme-check-started')) {
      localStorage.removeItem('gridline-theme');
      sessionStorage.setItem('gridline-theme-check-started', '1');
    }
  });
  await expectBootstrapTheme(page, '/admin', 'dark');
  // The real authorization gate must render the Admin shell; never mock isAdmin or roles.
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.getByText('Administrator access required')).toHaveCount(0);
  const toggle = page.locator('.sidebar-theme-toggle');
  await expectKeyboardRing(page, '.sidebar-theme-toggle');
  await page.keyboard.press('Enter');
  await expectTheme(page, 'light');
  await expectBootstrapTheme(page, '/admin', 'light');
  await expect(sidebar).toBeVisible();
  await expectTheme(page, 'light');
  await sidebar.getByRole('link', { name: 'Data health' }).click();
  await expect(page).toHaveURL(/\/admin\/data-health$/);
  await expectTheme(page, 'light');
  await toggle.click();
  await expectTheme(page, 'dark');
  await expectBootstrapTheme(page, '/admin/data-health', 'dark');
  await expect(sidebar).toBeVisible();
  await expectTheme(page, 'dark');
});

test('authorized Admin mobile navigation keeps focus, theme, and width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('gridline-theme-check-started')) {
      localStorage.removeItem('gridline-theme');
      sessionStorage.setItem('gridline-theme-check-started', '1');
    }
  });
  await page.goto('/admin');
  await expectTheme(page, 'dark');
  await expect(page.locator('.sidebar')).toBeAttached();
  await expect(page.getByText('Administrator access required')).toHaveCount(0);
  await expectKeyboardRing(page, '[data-testid="button-open-navigation"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/);
  await expectNoHorizontalOverflow(page);
  await page.locator('.sidebar').getByRole('link', { name: 'Data health' }).click();
  await expect(page).toHaveURL(/\/admin\/data-health$/);
  await expectNoHorizontalOverflow(page);
  const toggle = page.locator('.mobile-topbar .theme-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'light');
  await expect(page.locator('.sidebar')).toBeAttached();
  await expectNoHorizontalOverflow(page);
  await expect(toggle.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).resolves.toBeLessThanOrEqual(0.001);
});