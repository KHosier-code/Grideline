import { test, expect } from '@playwright/test';

const kickoff = new Date(Date.now() + 14 * 86400_000).toISOString();
const game = {
  gameId: 'position-ui-fixture', season: 2026, week: 3, kickoffTime: kickoff,
  gameStatus: 'Scheduled', gameState: 'pregame', venue: null,
  matchup: {
    away: { teamId: 'cin', abbreviation: 'CIN', name: 'Cincinnati Bengals', logoUrl: null },
    home: { teamId: 'pit', abbreviation: 'PIT', name: 'Pittsburgh Steelers', logoUrl: null },
  },
  finalScore: null, weather: null, prediction: null, market: {},
  marketBoard: { comparisons: [] },
  recommendation: { status: 'partial', reason: 'No eligible evidence',
    markets: { spread: false, total: false, moneyline: false } },
  dataConfidence: { label: 'Limited', score: 0, reason: 'Synthetic test' },
  confidence: { markets: [] },
  availability: { prediction: 'No eligible saved prediction', market: null },
  movement: { available: false, streams: [], message: 'No observations',
    completeness: { status: 'complete', returnedObservations: 0, totalObservations: 0 } },
  context: { teams: [], message: 'No confirmed depth', projectedMatchups: [],
    modelPersonnelLimitation: { active: false, recommendationSuppressed: false, reason: null } },
  keyPlayers: [],
  matchupBoard: { status: 'unavailable', sourceCutoff: new Date().toISOString(),
    assessments: [], summary: [], sources: [],
    completeness: { supportedCategories: 0, totalCategories: 0 } },
  sourceHealth: { status: 'unavailable',
    sources: Object.fromEntries(['schedule', 'injuries', 'odds', 'players'].map(name =>
      [name, { status: 'unavailable', lastAttemptAt: null, lastSuccessAt: null,
        sourceTimestamp: null, lastAttemptStatus: null, message: null, staleAfterMinutes: 60 }])) },
  analysis: { drivers: [], availability: { weather: 'Weather unavailable' } },
};
const observed = (total: number, games: number) => ({
  total, perGame: total / games, coveredGames: games, requestedGames: 3,
  coveredWeeks: [1, 2], missingWeeks: [3], reason: null,
});
const defense = (total: number) => ({
  label: 'Receiving yards', unit: 'yards', total, perGame: total / 2,
  coveredGames: 2, completedGames: 3, coveredWeeks: [1, 2],
  missingWeeks: [3], missingGames: ['missing'], reason: 'Partial defensive coverage',
});
const candidate = {
  selectionKey: 'te-one:CIN', playerId: 'te-one', playerName: 'Fixture Tight End',
  team: 'CIN', opponent: 'PIT', position: 'TE', appearances: 2,
};
const comparison = (position: string, player: string | null) => ({
  status: player ? 'selected' : 'empty', season: 2026, week: 3, gameId: game.gameId,
  cutoff: kickoff, asOf: new Date().toISOString(), window: 'last5', position,
  candidates: position === 'TE' ? [candidate] : [],
  selected: player ? candidate : null,
  metrics: player ? {
    receivingYards: { label: 'Receiving yards', player: observed(78, 2), defense: defense(200) },
    targets: { label: 'Targets', player: observed(10, 2),
      defense: { ...defense(21), label: 'Targets', unit: 'count' } },
  } : {},
  score: { version: 'position-context-descriptive-v1', kind: 'descriptive_index',
    value: null, direction: 'Not predictive',
    ingredients: { roleMetric: 'targets', rolePerAppearance: 5, yardMetric: 'receivingYards',
      yardsPerAppearance: 39, opponentPositionYardsPerGame: 100,
      defenseAdjustment: null, playerAppearances: 2, defenseGames: 2 },
    reason: 'Needs three covered games.' },
  projections: { receivingYards: { value: null, kind: 'expected_count', modelVersion: null,
    cutoffAt: null, quality: null, recentAverage: 39, leaguePositionBaseline: null,
    reason: 'No qualified model.' }, scoringTdProbability: {
      value: null, kind: 'probability', modelVersion: null, cutoffAt: null, quality: null,
      recentAverage: null, leaguePositionBaseline: null, reason: 'TD gate closed.',
    } },
  source: 'Fixture weekly stats', sourceUpdatedAt: null, ingestedAt: null,
  note: 'An observed player is not confirmed active.',
});

for (const width of [390, 1280]) {
  test(`player comparison preserves loading, partial, empty, unavailable and unit states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    let releaseFirstResponse = () => {};
    const firstResponse = new Promise<void>(resolve => { releaseFirstResponse = resolve; });
    await page.route('**/api/consumer/games/position-ui-fixture', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(game) }));
    await page.route('**/api/consumer/player-position-matchup?*', async route => {
      const url = new URL(route.request().url());
      const position = url.searchParams.get('position') ?? 'TE';
      if (position === 'WR') return route.abort();
      if (position === 'TE' && !url.searchParams.has('player')) await firstResponse;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(comparison(position, url.searchParams.get('player'))) });
    });
    await page.goto('/games/position-ui-fixture');
    await page.getByTestId('disclosure-personnel').locator('summary').first().click();
    const section = page.getByTestId('player-position-matchup');
    await expect(section).toBeVisible();
    await expect(section.getByRole('status')).toContainText('Loading player and defensive history');
    releaseFirstResponse();
    await expect(section.getByText('Choose a player to see the comparison.', { exact: false })).toBeVisible();
    await section.getByTestId('select-matchup-player').selectOption(candidate.selectionKey);
    await expect(section.getByText('Missing weeks: 3').first()).toBeVisible();
    await expect(section.getByTestId('matchup-score')).toContainText('unavailable');
    await expect(section.getByTestId('matchup-projections')).toContainText('Unavailable');
    await expect(section.getByRole('cell', { name: /^39 / })).toBeVisible();
    await section.getByTestId('button-matchup-total').click();
    await expect(section.getByRole('cell', { name: /^78 / })).toBeVisible();
    await section.getByTestId('select-matchup-position').selectOption('QB');
    await expect(section.getByText('No verified prior QB appearances')).toBeVisible();
    await section.getByTestId('select-matchup-position').selectOption('WR');
    await expect(section.getByRole('alert')).toContainText('Matchup data unavailable');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}