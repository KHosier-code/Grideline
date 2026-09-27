import { test, expect, type Page, type Route } from '@playwright/test';

const defaultSeason = new Date().getMonth() < 8 ? new Date().getFullYear() - 1 : new Date().getFullYear();
const emptySeason = 2023;
const staleSeason = 2022;

type Week = {
  week: number; scheduledGames: number; expectedGames: number; missingMatchups: string[];
  fixtureVerified: boolean; finalGames: number; statGames: number; allFinal: boolean;
};
const covered = (week: number): Week => ({
  week, scheduledGames: 2, expectedGames: 2, missingMatchups: [], fixtureVerified: true,
  finalGames: 2, statGames: 2, allFinal: true,
});

function fixture(season: number, throughWeek: number, window: string, codes: string | null, phase: number, gapWeek: number | null = null) {
  const weeks = season === defaultSeason ? [
    covered(1), covered(2),
    phase === 1
      ? { ...covered(3), finalGames: 1, statGames: 0, allFinal: false }
      : phase === 2
        ? { ...covered(3), statGames: 1 }
        : covered(3),
  ] : [];
  if (season === defaultSeason && gapWeek !== null) {
    weeks[gapWeek - 1] = {
      ...covered(gapWeek), expectedGames: 3, missingMatchups: ['DDD at CCC (missing-game)'],
      allFinal: false,
    };
  }
  const availableWeek = gapWeek !== null ? gapWeek - 1 : phase === 3 ? 3 : 2;
  const active = season === defaultSeason && throughWeek <= availableWeek;
  const selected = codes ? codes.split(',') : ['AAA', 'BBB'];
  const teams = active ? selected.map((code, index) => ({
    teamId: code, abbreviation: code, name: `${code} Fixture Club`, logoUrl: null,
    offenseEpa: (index ? -1 : 1) * throughWeek / 10,
    defenseEpa: (index ? 1 : -1) * throughWeek / 20,
    offenseSamples: throughWeek, defenseSamples: throughWeek, selectedGames: throughWeek,
    observations: Array.from({ length: throughWeek }, (_, i) => ({
      gameId: `${code}-${season}-${i + 1}`, week: i + 1,
      kickoffTime: `${season}-09-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
      opponent: index ? 'AAA' : 'BBB',
      offenseEpa: (index ? -1 : 1) * (i + 1) / 10,
      defenseEpa: (index ? 1 : -1) * (i + 1) / 20,
      offenseSuccessRate: 0.4, defenseSuccessRate: 0.5,
    })),
  })) : [];
  return {
    season, throughWeek, window, source: `Fixture ${season} W${throughWeek}`,
    coverage: {
      weeks: weeks.filter(item => item.week <= throughWeek),
      partialReasons: weeks.filter(item => item.week <= throughWeek && (!item.allFinal || item.statGames < item.finalGames))
        .map(item => item.missingMatchups.length
          ? `Week ${item.week} is missing 1 provider schedule matchup(s): ${item.missingMatchups.join(', ')}.`
          : `Week ${item.week} has incomplete evidence.`),
    },
    teams,
  };
}

async function aligned(page: Page, week: number) {
  await expect(page.getByTestId('select-teams-week')).toHaveValue(String(week));
  await expect(page.getByTestId('text-teams-source')).toContainText(`Fixture ${defaultSeason} W${week}`);
  await expect(page.getByTestId('text-plotted-teams')).toHaveText('2 / 2 teams plotted');
  await expect(page.getByTestId('button-scatter-team-AAA')).toHaveAttribute('aria-label', new RegExp(`offense \\+${(week / 10).toFixed(3)} EPA per play`));
  await expect(page.getByTestId('row-team-AAA')).toContainText(`+${(week / 10).toFixed(3)}`);
  await expect(page.getByTestId('text-covered-weeks')).toHaveText(`${week} weeks with coverage records`);
  await expect(page.locator('.ct-trend-chart')).toHaveAttribute('aria-label', /AAA Fixture Club/);
  await expect(page.getByTestId('status-coverage-week-1')).toContainText('2 / 2 games');
  await expect(page.getByTestId(`status-coverage-week-${week + 1}`)).toHaveCount(0);
  await page.getByTestId('button-show-observations').click();
  const observations = page.locator('section[aria-labelledby="ct-trend-title"] tbody tr');
  await expect(observations).toHaveCount(week * 2);
  await expect(observations.filter({ has: page.locator('td:nth-child(2)', { hasText: String(week) }) })).toHaveCount(2);
  await page.getByTestId('button-show-observations').click();
}

test('Team Evidence keeps cutoff, plots, trends, ledger and coverage aligned across out-of-order responses', async ({ page }) => {
  let phase = 1;
  const pending: { route: Route; season: number; week: number; codes: string | null; window: string }[] = [];
  let holdWeekOne = false;
  let holdDiscovery = false;
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/api/consumer/team-analytics?**', async route => {
    const url = new URL(route.request().url());
    const season = Number(url.searchParams.get('season'));
    const week = Number(url.searchParams.get('throughWeek'));
    const codes = url.searchParams.get('teams');
    const window = url.searchParams.get('window') ?? 'season';
    if ((holdWeekOne && season === defaultSeason && week === 1) ||
        (holdDiscovery && season === staleSeason && week === 18)) {
      pending.push({ route, season, week, codes, window });
      return;
    }
    await route.fulfill({ json: fixture(season, week, window, codes, phase) });
  });
  await page.goto('/tests/team-evidence.html');
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));
  await aligned(page, 2);
  await expect(page.getByTestId('status-teams-coverage')).toContainText('Week 3 has paired team statistics for 0 of 1 final games');
  await expect(page.getByTestId('select-teams-week').locator('option')).toHaveCount(2);

  phase = 2;
  await page.reload();
  await aligned(page, 2);
  await expect(page.getByTestId('status-teams-coverage')).toContainText('Week 3 has paired team statistics for 1 of 2 final games');

  phase = 3;
  await page.reload();
  await aligned(page, 3);
  await expect(page.getByTestId('status-teams-coverage')).toHaveCount(0);
  await expect(page.getByTestId('select-teams-week').locator('option')).toHaveCount(3);

  holdWeekOne = true;
  await page.getByTestId('select-teams-week').selectOption('1');
  await expect.poll(() => pending.filter(item => item.week === 1).length).toBeGreaterThan(0);
  await expect(page.getByTestId('text-plotted-teams')).toHaveText('0 / 0 teams plotted');
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(0);
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await page.getByTestId('select-teams-week').selectOption('3');
  holdWeekOne = false;
  for (const item of pending.splice(0)) {
    await item.route.fulfill({ json: fixture(item.season, item.week, item.window, item.codes, phase) }).catch(() => {});
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await aligned(page, 3);

  // A manual cutoff is distinct from the default and survives an unrelated window change.
  await page.getByTestId('select-teams-week').selectOption('2');
  await aligned(page, 2);
  await page.getByTestId('select-teams-window').selectOption('last3');
  await expect(page.getByTestId('select-teams-week')).toHaveValue('2');
  await expect(page.getByTestId('text-teams-source')).toContainText(`Fixture ${defaultSeason} W2`);
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(1);

  holdDiscovery = true;
  await page.getByTestId('select-teams-season').selectOption(String(staleSeason));
  await expect.poll(() => pending.filter(item => item.season === staleSeason).length).toBe(1);
  await expect(page.getByTestId('select-teams-week')).toBeDisabled();
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(0);
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await page.getByTestId('select-teams-season').selectOption(String(defaultSeason));
  holdDiscovery = false;
  for (const item of pending.splice(0)) {
    await item.route.fulfill({ json: fixture(item.season, item.week, item.window, item.codes, phase) }).catch(() => {});
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await aligned(page, 3); // season change clears the manual cutoff
  await expect(page.getByTestId('select-teams-window')).toHaveValue('last3');

  await page.getByTestId('select-teams-season').selectOption(String(emptySeason));
  await expect(page.getByTestId('select-teams-week')).toBeDisabled();
  await expect(page.getByTestId('select-teams-week')).toHaveValue('0');
  await expect(page.getByTestId('status-teams-unavailable')).toContainText('no fully final, statistically covered week');
  await expect(page.getByTestId('text-plotted-teams')).toHaveText('0 / 0 teams plotted');
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(0);
  await expect(page.getByTestId('text-covered-weeks')).toHaveText('0 weeks with coverage records');
  await expect(page.getByTestId('text-teams-source')).toContainText('Not available');
  expect(failures).toEqual([]);
});

test('Team Evidence retries failed discovery, chart and trend requests for the current season and cutoff', async ({ page }) => {
  const failed = new Set<'discovery' | 'chart' | 'trend'>();
  const attempts = { discovery: 0, chart: 0, trend: 0 };
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/api/consumer/team-analytics?**', async route => {
    const url = new URL(route.request().url());
    const season = Number(url.searchParams.get('season'));
    const week = Number(url.searchParams.get('throughWeek'));
    const codes = url.searchParams.get('teams');
    const window = url.searchParams.get('window') ?? 'season';
    const kind = season === defaultSeason && week === 18 && codes === null ? 'discovery'
      : season === defaultSeason && week === 1 && codes === null && window === 'season' ? 'chart'
      : season === defaultSeason && week === 1 && codes !== null && window === 'last3' ? 'trend'
      : null;
    if (kind) {
      attempts[kind]++;
      if (!failed.has(kind)) {
        failed.add(kind);
        await route.fulfill({ status: 503, json: { error: `Fixture ${kind} failure` } });
        return;
      }
    }
    await route.fulfill({ json: fixture(season, week, window, codes, 3) });
  });

  await page.goto('/tests/team-evidence.html');
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));
  await expect(page.getByTestId('select-teams-week')).toBeDisabled();
  await expect(page.getByTestId('text-teams-source')).toContainText('Not available');
  await expect(page.getByRole('alert').filter({ hasText: 'Team evidence is unavailable' })).toBeVisible();
  await expect(page.getByTestId('button-retry-teams')).toBeVisible();
  await page.getByTestId('button-retry-teams').click();
  await aligned(page, 3);
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));

  await page.getByTestId('select-teams-week').selectOption('1');
  await expect(page.getByRole('alert').filter({ hasText: 'Team evidence is unavailable' })).toBeVisible();
  await expect(page.getByTestId('button-retry-teams')).toBeVisible();
  await expect(page.getByTestId('text-teams-source')).toContainText('Not available');
  await expect(page.getByTestId('text-plotted-teams')).toHaveText('0 / 0 teams plotted');
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(0);
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await page.getByTestId('button-retry-teams').click();
  await aligned(page, 1);
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));

  await page.getByTestId('select-teams-window').selectOption('last3');
  await expect(page.getByRole('alert').filter({ hasText: 'Game history is unavailable' })).toBeVisible();
  await expect(page.getByTestId('button-retry-trends')).toBeVisible();
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));
  await expect(page.getByTestId('select-teams-week')).toHaveValue('1');
  await expect(page.getByTestId('text-teams-source')).toContainText(`Fixture ${defaultSeason} W1`);
  await expect(page.getByTestId('row-team-AAA')).toContainText('+0.100');
  await page.getByTestId('button-retry-trends').click();
  await aligned(page, 1);
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));
  await expect(page.getByTestId('select-teams-window')).toHaveValue('last3');
  expect(attempts).toEqual({ discovery: 2, chart: 2, trend: 2 });
  expect(failures).toEqual([]);
});

test('missing provider matchups keep Team Evidence at the last contiguous week, including no week one', async ({ page }) => {
  let gapWeek = 2;
  const requests: number[] = [];
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/api/consumer/team-analytics?**', async route => {
    const url = new URL(route.request().url());
    const season = Number(url.searchParams.get('season'));
    const week = Number(url.searchParams.get('throughWeek'));
    requests.push(week);
    await route.fulfill({ json: fixture(season, week, url.searchParams.get('window') ?? 'season',
      url.searchParams.get('teams'), 3, gapWeek) });
  });
  await page.goto('/tests/team-evidence.html');
  await expect(page.getByTestId('select-teams-season')).toHaveValue(String(defaultSeason));
  await aligned(page, 1);
  await expect(page.getByTestId('status-teams-coverage')).toContainText('Week 2 is missing 1 provider matchup(s): DDD at CCC (missing-game). Charts cannot advance.');
  await expect(page.getByTestId('select-teams-week').locator('option')).toHaveCount(1);
  await expect(page.getByTestId('status-coverage-week-2')).toHaveCount(0);
  expect(requests.every(week => week === 18 || week === 1)).toBe(true);

  gapWeek = 1;
  requests.length = 0;
  await page.reload();
  await expect(page.getByTestId('select-teams-week')).toBeDisabled();
  await expect(page.getByTestId('select-teams-week')).toHaveValue('0');
  await expect(page.getByTestId('status-teams-coverage')).toContainText('Week 1 is missing 1 provider matchup(s): DDD at CCC (missing-game). Charts cannot advance.');
  await expect(page.getByTestId('status-teams-unavailable')).toContainText('no fully final, statistically covered week');
  await expect(page.getByTestId('text-plotted-teams')).toHaveText('0 / 0 teams plotted');
  await expect(page.getByTestId('row-team-AAA')).toHaveCount(0);
  await expect(page.locator('.ct-trend-chart')).toHaveCount(0);
  await expect(page.getByTestId('text-teams-source')).toContainText('Not available');
  expect(requests).toEqual([18]);
  expect(failures).toEqual([]);
});
