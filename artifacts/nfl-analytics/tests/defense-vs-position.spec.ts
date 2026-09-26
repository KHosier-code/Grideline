import { test, expect } from '@playwright/test';

const metric = (total: number, missing = false) => ({
  label: 'Receiving yards', unit: 'yards', total: missing ? null : total,
  perGame: missing ? null : total / 2, coveredGames: missing ? 0 : 2,
  completedGames: 2, coveredWeeks: missing ? [] : [1, 2],
  missingWeeks: missing ? [1, 2] : [],
  missingGames: missing ? ['week-1', 'week-2'] : [],
  reason: missing ? 'Weekly player stats were imported after this cutoff; no pregame source revision is retained' : null,
});
const response = (missing = false) => ({
  season: 2026, seasonType: 'REG', window: 'last2Weeks', cutoff: '2026-09-26T20:00:00Z',
  selectedWeeks: [1, 2], windowReason: null, source: 'Fixture history',
  sourceUpdatedAt: null, ingestedAt: '2026-09-26T15:01:51Z',
  note: 'Observed history, not a forecast.', unsupported: {},
  defenses: ['PIT', 'CIN'].map((abbreviation, index) => ({
    teamId: abbreviation, abbreviation,
    positions: { WR: { receivingYards: metric(index ? 277 : 184, missing) } },
  })),
});

test('league displays the complete-week denominator and missing evidence', async ({ page }) => {
  await page.route('**/api/consumer/defense-vs-position?*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response()) }));
  await page.goto('/defense-vs-position');
  await expect(page.getByTestId('text-defense-selected-weeks')).toContainText('1, 2');
  await expect(page.getByTestId('row-defense-PIT')).toContainText('92');
  await expect(page.getByTestId('row-defense-CIN')).toContainText('277');
  await page.route('**/api/consumer/defense-vs-position?*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response(true)) }));
  await page.reload();
  await expect(page.getByTestId('text-defense-unavailable')).toContainText('imported after this cutoff');
  await expect(page.getByTestId('row-defense-PIT')).toContainText('Missing games: week-1, week-2');
});

test('Game Detail defaults to complete weeks and shows both defenses', async ({ page }) => {
  const game = {
    gameId: 'dvp-fixture', season: 2026, week: 3,
    kickoffTime: '2026-09-27T17:00:00Z', gameStatus: 'Scheduled', gameState: 'pregame',
    venue: null,
    matchup: { away: { teamId: 'CIN', abbreviation: 'CIN', name: 'Cincinnati Bengals' },
      home: { teamId: 'PIT', abbreviation: 'PIT', name: 'Pittsburgh Steelers' } },
    finalScore: null, weather: null, prediction: null, market: {}, keyPlayers: [],
    marketBoard: { comparisons: [] },
    recommendation: { status: 'partial', reason: 'No eligible evidence',
      markets: { spread: false, total: false, moneyline: false } },
    dataConfidence: { label: 'Limited', score: 0, reason: 'Synthetic test' },
    confidence: { markets: [] }, availability: { prediction: 'No eligible saved prediction', market: null },
    movement: { available: false, streams: [], message: 'No observations',
      completeness: { status: 'complete', returnedObservations: 0, totalObservations: 0 } },
    context: { teams: [], message: 'No confirmed depth', projectedMatchups: [],
      modelPersonnelLimitation: { active: false, recommendationSuppressed: false, reason: null } },
    matchupBoard: { status: 'unavailable', sourceCutoff: '2026-09-27T17:00:00Z',
      assessments: [], summary: [], sources: [],
      completeness: { supportedCategories: 0, totalCategories: 0 } },
    sourceHealth: { status: 'unavailable',
      sources: Object.fromEntries(['schedule', 'injuries', 'odds', 'players'].map(name =>
        [name, { status: 'unavailable', lastAttemptAt: null, lastSuccessAt: null,
          sourceTimestamp: null, lastAttemptStatus: null, message: null, staleAfterMinutes: 60 }])) },
    analysis: { drivers: [], availability: { weather: 'Weather unavailable' } },
  };
  await page.route('**/api/consumer/games/dvp-fixture', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(game) }));
  await page.route('**/api/consumer/defense-vs-position?*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response()) }));
  await page.goto('/games/dvp-fixture');
  const disclosure = page.getByTestId('disclosure-personnel');
  await disclosure.locator('summary').first().click();
  await expect(page.getByTestId('section-defense-vs-position')).toBeVisible();
  await expect(page.getByTestId('button-game-window-last2Weeks')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('card-defense-PIT-WR')).toContainText('184 total yards');
  await expect(page.getByTestId('card-defense-CIN-WR')).toContainText('277 total yards');
});