import { expect, type Page } from '@playwright/test';

export async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gridline-theme'))).toBe(theme);
}

// Keep React's entry point waiting so the HTML bootstrap can be checked before hydration.
export async function expectBootstrapTheme(page: Page, url: string, theme: 'light' | 'dark') {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/main.tsx*', async route => {
    await held;
    await route.continue();
  });
  try {
    const navigation = page.goto(url);
    await page.waitForRequest(/\/src\/main\.tsx(?:\?|$)/);
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');
    release();
    await navigation;
  } finally {
    release();
    await page.unroute('**/src/main.tsx*');
  }
}

export async function expectKeyboardRing(page: Page, selector: string) {
  const target = page.locator(selector);
  // Start next to the target instead of walking every focusable control in a data-heavy page.
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  const ring = await target.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

export async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}