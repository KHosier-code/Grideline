import { test, expect } from '@playwright/test';
import { expectBootstrapTheme, expectKeyboardRing, expectNoHorizontalOverflow, expectTextContrast, expectTheme } from './theme.helpers';

test('public cards, status text and chart labels meet normal-text contrast at both widths', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto('/');
      await page.evaluate(value => localStorage.setItem('gridline-theme', value), theme);
      await page.reload();
      await expectTheme(page, theme);
      const context = `${width}px`;
      await expectTextContrast(page.locator('.visitor-pick h1'), { theme, label: `${context} Home card heading` });
      await expectTextContrast(page.locator('.visitor-pick > p:not(.consumer-eyebrow)'), { theme, label: `${context} Home pick status` });
      await expectTextContrast(page.locator('.visitor-pick .consumer-eyebrow'), { theme, label: `${context} Home card label` });
      await expectTextContrast(page.locator('.visitor-pick-history'), { theme, label: `${context} Home history link` });

      await page.goto('/games');
      await expect(page.getByRole('heading', { name: 'Gridline market board' })).toBeVisible();
      await expectTextContrast(page.locator('.terminal-header .terminal-desc'), { theme, label: `${context} market board card description` });

      await page.goto('/teams');
      await expect(page.locator('.ct-panel').first()).toBeVisible();
      await expectTextContrast(page.locator('.ct-panel-heading .ct-tag').first(), { theme, label: `${context} chart coverage status` });
      // The chart can have no verified points. Still check its actual axis color
      // token against the chart surface; never make the check depend on live data.
      const chart = page.locator('.ct-panel').first();
      await chart.evaluate(panel => {
        const surface = document.createElement('span');
        surface.textContent = 'Chart axis sample';
        surface.style.color = 'hsl(var(--chart-axis))';
        panel.append(surface);
      });
      await expectTextContrast(chart.getByText('Chart axis sample'), { theme, label: `${context} chart axis label` });
      await chart.getByText('Chart axis sample').evaluate(node => node.remove());
    }
  }
});

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
test('consumer palette and route hierarchy remain readable across themes and widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light'] as const) {
    await page.goto('/');
    if (theme === 'light') await page.locator('.consumer-account .theme-toggle').click();
    await expectTheme(page, theme);
    for (const [route, title] of [
      ['/', /Pick of the week/i],
      ['/teams', /The league, in context/i],
      ['/defense-vs-position', /Defense vs/i],
      ['/my-picks', /My picks/i],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expectTheme(page, theme);
      const selected = page.getByRole('navigation', { name: 'Primary navigation' }).locator('a[aria-current="page"]');
      await expect(selected).toHaveCount(1);
      const colors = await selected.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, accent: getComputedStyle(document.querySelector('.consumer-shell')!).getPropertyValue('--accent').trim() };
      });
      expect(colors.accent).toBe(theme === 'dark' ? '21 100% 70%' : '21 88% 36%');
      expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`gridline-${theme}-${route === '/' ? 'home' : route.slice(1)}-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 850 });
    }
  }
});

test('signed-in Saved Games component states keep real cards and controls legible without a live account', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(value => localStorage.setItem('gridline-theme', value), theme);
      for (const state of ['populated', 'empty', 'loading', 'error'] as const) {
        await page.goto(`/tests/saved-games.html?state=${state}`);
        await expectTheme(page, theme);
        await expect(page.getByRole('heading', { level: 1, name: 'My picks.' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Browse games' })).toHaveAttribute('href', '/games');
        if (state === 'populated') {
          const list = page.getByTestId('list-saved-games');
          await expect(list).toBeVisible();
          await expect(list.locator('.consumer-game-card')).toHaveCount(2);
          const first = page.getByTestId('card-saved-game-fixture-baltimore-buffalo');
          await expect(first.getByText('Baltimore Ravens')).toBeVisible();
          await expect(first.getByText('Buffalo Bills')).toBeVisible();
          await expect(first.getByText('Projection', { exact: true })).toBeVisible();
          await expect(first.getByText('Market spread', { exact: true })).toBeVisible();
          await expect(first.getByText('Fixture Book')).toBeVisible();
          await expect(first.getByRole('button', { name: 'Remove saved game' })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByTestId('card-saved-game-fixture-detroit-green-bay').getByText('Final')).toBeVisible();
          await expect(first.locator('.consumer-game-card-link')).toHaveAttribute('href', '/games/fixture-baltimore-buffalo');
        } else if (state === 'empty') {
          await expect(page.getByTestId('status-saved-games-empty')).toBeVisible();
          await expect(page.getByTestId('link-explore-empty-saved-games')).toHaveAttribute('href', '/games');
        } else if (state === 'loading') {
          await expect(page.getByRole('status', { name: 'Loading saved games' })).toBeVisible();
          await expect(page.locator('.sv-body')).toHaveAttribute('aria-busy', 'true');
        } else {
          await expect(page.getByTestId('status-saved-games-error')).toBeVisible();
          await expect(page.getByTestId('button-retry-saved-games')).toBeVisible();
        }
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`gridline-${theme}-saved-games-${state}-${width}.png`), fullPage: true });
        if (state === 'populated') {
          const control = page.getByTestId('card-saved-game-fixture-baltimore-buffalo').getByRole('button', { name: 'Remove saved game' });
          await control.click();
          await expect(page.getByTestId('card-saved-game-fixture-baltimore-buffalo').getByRole('button', { name: 'Save game' })).toHaveAttribute('aria-pressed', 'false');
        }
        if (state === 'error') {
          await page.getByTestId('button-retry-saved-games').click();
          await expect(page.getByTestId('list-saved-games')).toBeVisible();
        }
      }
    }
  }
});
