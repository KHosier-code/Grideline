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
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Games' }).click();
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
  const menu = page.locator('.consumer-account button[aria-label="Open navigation"]');
  const toggle = page.locator('.consumer-account .theme-toggle');
  await expect(menu).toBeVisible();
  await expect(toggle).toBeVisible();
  await expectKeyboardRing(page, '.consumer-account button[aria-label="Open navigation"]');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await mobileNav.getByRole('link', { name: 'Games' }).click();
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