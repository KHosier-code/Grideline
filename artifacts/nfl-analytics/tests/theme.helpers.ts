import { expect, type Locator, type Page } from '@playwright/test';

// WCAG 2.x contrast for normal text. Read the painted surface, not just the
// element's own background (badges and labels often use transparent fills).
export async function expectTextContrast(
  target: Locator,
  { theme, label, min = 4.5, property = 'color' }: {
    theme: 'light' | 'dark';
    label: string;
    min?: number;
    property?: 'color' | 'fill';
  },
) {
  await expect(target, `${theme}: ${label} must be visible`).toBeVisible();
  const result = await target.evaluate((element, property) => {
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA => {
      const match = value.match(/^rgba?\((.*)\)$/);
      if (!match) throw new Error(`Cannot measure color: ${value}`);
      const parts = match[1].replace('/', ' ').split(/[,\s]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) throw new Error(`Cannot measure color: ${value}`);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const over = (front: RGBA, back: RGBA): RGBA => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        ...[0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha),
        alpha,
      ] as RGBA;
    };
    let background: RGBA = [0, 0, 0, 0];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' && background[3] < 1) {
        throw new Error(`Cannot measure gradient/image behind ${node.tagName.toLowerCase()}.${node.className}`);
      }
      background = over(background, parse(style.backgroundColor));
      if (background[3] >= 1) break;
    }
    if (background[3] < 1) throw new Error('No opaque background found');
    const foreground = parse(getComputedStyle(element)[property]);
    const painted = over(foreground, background);
    const luminance = (color: RGBA) => {
      const channels = color.slice(0, 3).map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(painted);
    const b = luminance(background);
    return {
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      foreground: getComputedStyle(element)[property],
      background: background.map(Math.round).join(', '),
    };
  }, property);
  expect(
    result.ratio,
    `${theme}: ${label} (${result.foreground} on rgba(${result.background})) contrast ${result.ratio.toFixed(2)}:1; expected >= ${min}:1`,
  ).toBeGreaterThanOrEqual(min);
}

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