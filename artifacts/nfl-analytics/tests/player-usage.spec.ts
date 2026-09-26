import { test, expect, type Page } from '@playwright/test';

const metric = (value: number | null, available = value !== null) => ({
  value, available, reason: available ? null : 'Not recorded',
});
const player = (id: string, name: string, position: 'QB' | 'WR', volume: number | null, yards: number | null) => {
  const volumeKey = position === 'QB' ? 'attempts' : 'targets';
  const yardsKey = position === 'QB' ? 'passingYards' : 'receivingYards';
  return {
    playerId: id, playerName: name, teamId: 'BUF', position, trend: 'flat',
    aggregate: { [volumeKey]: metric(volume), [yardsKey]: metric(yards), totalTd: metric(0) },
    games: [{
      gameId: `fixture-${id}`, season: 2026, week: 1, seasonType: 'REG',
      metrics: { [volumeKey]: metric(volume), [yardsKey]: metric(yards) },
    }],
    metricAvailability: { [volumeKey]: volume !== null },
    sourceCoverage: { requestedGames: 1, includedGames: 1, partialReasons: [] },
  };
};
const players = [
  player('able', 'Aaron Able', 'QB', 30, 240),
  player('blank', 'Blake Blank', 'QB', null, null), // unavailable is not a verified zero
  player('zero-qb', 'Cody Zero', 'QB', 0, 0),
  player('dash', 'Dana Dash', 'WR', 9, 80),
  player('zero-wr', 'Eli Zero', 'WR', 0, 0),
];
const response = {
  status: 'partial', season: 2026, players,
  availableTeams: [{ teamId: 'BUF', abbreviation: 'BUF' }],
  filters: { team: null, position: null, game: null, window: 'last5' },
  metricAvailability: {}, sourceCoverage: { requestedGames: 1, includedGames: 1, partialReasons: ['Some stats not recorded'] },
};

async function names(page: Page, mobile: boolean) {
  return mobile
    ? page.getByTestId('list-usage-players').locator('li > div:first-child > div:first-child > strong:first-child').allTextContents()
    : page.getByTestId('table-usage-players').locator('tbody tr td:first-child strong').allTextContents();
}

async function tabToOrderingExplanation(page: Page) {
  const summary = page.getByTestId('disclosure-usage-relevance').locator('summary');
  await page.getByTestId('button-usage-reset').focus();
  for (let i = 0; i < 4 && !await summary.evaluate(element => element === document.activeElement); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(summary).toBeFocused();
  return summary;
}

for (const width of [1280, 390]) {
  test(`Player Usage ignores an older position response at ${width}px`, async ({ page }) => {
    const mobile = width < 1024;
    let notifyOlderRequested!: () => void;
    let releaseOlder!: () => void;
    let notifyOlderFinished!: () => void;
    const olderRequested = new Promise<void>(resolve => { notifyOlderRequested = resolve; });
    const olderReleased = new Promise<void>(resolve => { releaseOlder = resolve; });
    const olderFinished = new Promise<void>(resolve => { notifyOlderFinished = resolve; });

    await page.setViewportSize({ width, height: 850 });
    await page.route('**/api/consumer/player-usage-games*', route =>
      route.fulfill({ json: { season: 2026, games: [] } }));
    await page.route('**/api/consumer/player-usage?*', async route => {
      const position = new URL(route.request().url()).searchParams.get('position');
      if (position === 'QB') {
        notifyOlderRequested();
        await olderReleased;
      }
      await route.fulfill({ json: {
        ...response,
        players: position ? players.filter(p => p.position === position) : players,
      } });
      if (position === 'QB') notifyOlderFinished();
    });
    await page.route('**/api/analytics/usage-event', route => route.fulfill({ status: 204 }));

    try {
      await page.goto('/tests/player-usage.html');
      await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash', 'Aaron Able', 'Blake Blank']);
      const position = page.getByTestId('select-usage-position');
      await position.selectOption('QB');
      await olderRequested;
      await position.selectOption('WR');
      await expect(position).toHaveValue('WR');
      await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash']);
      await expect(page.getByTestId('text-usage-count')).toContainText('1 of 2 players');

      releaseOlder();
      await olderFinished;
      // Allow a browser render after the late response before inspecting the active list.
      await page.evaluate(() => new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash']);
      await expect(page.getByTestId('text-usage-count')).toContainText('1 of 2 players');
      await expect(position).toHaveValue('WR');
    } finally {
      releaseOlder();
    }
  });

  test(`Player Usage discovery, shared link and analytics at ${width}px`, async ({ page }) => {
    const mobile = width < 1024;
    const analytics: unknown[] = [];
    const usageRequests: URL[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/api/consumer/player-usage-games*', route =>
      route.fulfill({ json: { season: 2026, games: [] } }));
    await page.route('**/api/consumer/player-usage?*', route => {
      const url = new URL(route.request().url());
      usageRequests.push(url);
      const position = url.searchParams.get('position');
      return route.fulfill({ json: {
        ...response,
        players: position ? players.filter(p => p.position === position) : players,
      } });
    });
    await page.route('**/api/analytics/usage-event', route => {
      analytics.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    });

    await page.goto('/tests/player-usage.html');
    const search = page.getByTestId('input-usage-search');
    const zero = page.getByTestId('checkbox-usage-include-zero');
    const position = page.getByTestId('select-usage-position');
    const list = mobile ? page.getByTestId('list-usage-players') : page.getByTestId('table-usage-players');
    await expect(list).toBeVisible();
    await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash', 'Aaron Able', 'Blake Blank']);
    await expect(page.getByTestId('text-usage-count')).toContainText('3 of 5 players');
    const explanation = page.getByTestId('disclosure-usage-relevance').locator('p');
    const summary = await tabToOrderingExplanation(page);
    await expect(explanation).toBeHidden();
    const analyticsBeforeDisclosure = analytics.length;
    await page.keyboard.press('Enter');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText('observed volume per covered game');
    await page.keyboard.press('Space');
    await expect(explanation).toBeHidden();
    expect(analytics).toHaveLength(analyticsBeforeDisclosure);
    await search.fill('Cody');
    await expect(page.getByTestId('status-usage-filtered-empty')).toBeVisible();
    await expect(page.getByTestId('text-usage-count')).toHaveText('0 of 5 players visible');
    await zero.check();
    await expect.poll(() => names(page, mobile)).toEqual(['Cody Zero']);
    await expect(list).toContainText('0');
    await search.fill('');
    await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash', 'Aaron Able', 'Cody Zero', 'Eli Zero', 'Blake Blank']);
    await expect(page.getByTestId('text-usage-count')).toContainText('5 of 5 players');
    await expect(list.locator(mobile ? 'li' : 'tbody tr').filter({ hasText: 'Blake Blank' })).toContainText('—');

    if (mobile) {
      await page.getByTestId('select-usage-sort').selectOption('primaryVolume');
    } else {
      await page.getByTestId('button-usage-sort-primaryVolume').click();
    }
    await expect.poll(() => names(page, mobile)).toEqual(['Aaron Able', 'Dana Dash', 'Cody Zero', 'Eli Zero', 'Blake Blank']);
    await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('primaryVolume');
    await expect(page.getByTestId('button-usage-relevance')).toBeVisible();
    await tabToOrderingExplanation(page);
    await page.keyboard.press('Space');
    await expect(explanation).toBeVisible();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(explanation).toBeHidden();
    // The null-volume player remains last, including when the sort direction reverses.
    if (mobile) {
      await page.getByTestId('button-usage-sort-direction').click();
    } else {
      await page.getByTestId('button-usage-sort-primaryVolume').click();
    }
    await expect.poll(() => names(page, mobile)).toEqual(['Cody Zero', 'Eli Zero', 'Dana Dash', 'Aaron Able', 'Blake Blank']);
    await expect.poll(() => new URL(page.url()).searchParams.get('direction')).toBe('asc');

    await position.selectOption('QB');
    await expect.poll(() => names(page, mobile)).toEqual(['Aaron Able', 'Cody Zero', 'Blake Blank']);
    await expect(page.getByTestId('text-usage-relevance')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('sort')).toBe(false);
    await position.selectOption('');
    await search.fill('Zero');
    if (mobile) {
      await page.getByTestId('select-usage-sort').selectOption('name');
    } else {
      await page.getByTestId('button-usage-sort-name').click();
    }
    await expect.poll(() => names(page, mobile)).toEqual(['Eli Zero', 'Cody Zero']);
    const shared = page.url();
    expect(new URL(shared).searchParams.get('search')).toBe('Zero');
    expect(new URL(shared).searchParams.get('includeZero')).toBe('1');
    expect(new URL(shared).searchParams.get('sort')).toBe('name');

    await page.reload();
    await expect.poll(() => names(page, mobile)).toEqual(['Eli Zero', 'Cody Zero']);
    await expect(search).toHaveValue('Zero');
    await expect(zero).toBeChecked();
    await expect(position).toHaveValue('');
    if (mobile) await expect(page.getByTestId('select-usage-sort')).toHaveValue('name');
    else await expect(page.getByTestId('button-usage-sort-name').locator('..')).toHaveAttribute('aria-sort', 'descending');
    await page.getByTestId('button-usage-reset').click();
    await expect.poll(() => names(page, mobile)).toEqual(['Dana Dash', 'Aaron Able', 'Blake Blank']);
    await expect(search).toHaveValue('');
    await expect(zero).not.toBeChecked();
    await expect(position).toHaveValue('');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await page.getByTestId(mobile ? 'button-usage-mobile-detail-able:BUF' : 'button-usage-detail-able:BUF').click();
    await expect(page.getByTestId('dialog-usage-player')).toContainText('Aaron Able');

    await expect.poll(() => analytics.length).toBeGreaterThan(0);
    expect(analytics).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventName: 'usage_sort_changed', column: 'primaryVolume' }),
      expect.objectContaining({ eventName: 'usage_filters_reset' }),
      expect.objectContaining({ eventName: 'usage_row_toggled', action: 'expand' }),
    ]));
    for (const body of analytics) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(/Cody|Zero|Able|Blank|Dash|fixture-|playerId|playerName|gameId|search/i);
    }
    expect(usageRequests.length).toBeGreaterThan(0);
    for (const url of usageRequests) {
      for (const key of ['search', 'includeZero', 'sort', 'direction', 'player', 'playerId']) {
        expect(url.searchParams.has(key)).toBe(false);
      }
    }
    expect(errors).toEqual([]);
  });
}