// Versioned, synthetic browser workload. Never use this as operational API evidence.
export const fixtureVersion = 'weekly-home-v1';
const season = 2099;
const week = 3;
const kickoff = '2099-09-20T17:00:00.000Z';
// Earlier than the runner's real clock, so cutoff-safe comparison can render
// without overriding browser time (and thereby distorting performance timing).
const cutoff = '2020-09-18T12:00:00.000Z';
const health = {
  status: 'available',
  sources: Object.fromEntries(['schedule', 'injuries', 'odds', 'players'].map(name =>
    [name, { status: 'available', lastAttemptAt: cutoff, lastSuccessAt: cutoff,
      sourceTimestamp: cutoff, lastAttemptStatus: 'success', message: null, staleAfterMinutes: 60 }])),
};
const pairs = [['BUF', 'MIA'], ['DAL', 'PHI'], ['KC', 'LV'], ['GB', 'CHI'], ['SF', 'SEA'], ['BAL', 'PIT']];
const games = pairs.map(([away, home], index) => ({
  gameId: `perf-home-${index + 1}`, season, week,
  kickoffTime: new Date(Date.parse(kickoff) + index * 3600_000).toISOString(),
  gameStatus: 'Scheduled', gameState: 'pregame', venue: null,
  matchup: {
    away: { teamId: away, abbreviation: away, name: `${away} Away` },
    home: { teamId: home, abbreviation: home, name: `${home} Home` },
  },
  finalScore: null, market: {}, initialMarkets: { capturedAt: null, moneyline: null, spread: null, total: null },
  availability: { market: null },
}));
const coverage = [1, 2].map(weekNumber => ({
  week: weekNumber, scheduledGames: 16, expectedGames: 16, missingMatchups: [],
  fixtureVerified: true, finalGames: 16, statGames: 16, allFinal: true,
}));
const teams = ['BUF', 'MIA'].map((code, index) => ({
  teamId: code, abbreviation: code, name: `${code} ${index ? 'Home' : 'Away'}`,
  logoUrl: null, offenseEpa: 0.1, defenseEpa: 0, offenseSamples: 120,
  defenseSamples: 120, selectedGames: 2,
  observations: [1, 2].map(weekNumber => ({
    gameId: `perf-final-${code}-${weekNumber}`, week: weekNumber,
    kickoffTime: `2099-09-${String(weekNumber + 1).padStart(2, '0')}T17:00:00.000Z`,
    opponent: index ? 'BUF' : 'MIA', offenseEpa: index ? 0.08 + weekNumber * 0.01 : 0.1 + weekNumber * 0.01,
    defenseEpa: 0, offenseSuccessRate: 0.5, defenseSuccessRate: 0.5,
  })),
}));
const detail = {
  ...games[0],
  matchupBoard: {
    status: 'partial', sourceCutoff: cutoff, sources: ['Synthetic final games'],
    summary: [], completeness: { supportedCategories: 1, totalCategories: 4 },
    assessments: [{
      category: 'passing', edge: 'away', edgeLabel: 'Away', title: 'Passing', confidence: 'medium',
      coverage: '2 final games', explanation: 'Synthetic observed sample', limitations: [],
      metrics: [{ label: 'Blended pass EPA / dropback', homeValue: 0.08, awayValue: 0.12, unit: 'epa' }],
    }],
  },
};

export const fixtureExpected = Object.freeze({ heading: `${season} · Week ${week}`, cards: games.length, gameId: games[0].gameId });

// Return null for unexpected requests so the caller can fail closed rather than
// silently accessing the development API or measuring an error state.
export function homePerformanceResponse(url) {
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/api/consumer/dashboard' && !searchParams.size)
    return { status: 'available', games, note: 'Synthetic performance fixture', sourceHealth: health };
  if (pathname === `/api/consumer/games/${games[0].gameId}` && !searchParams.size) return detail;
  if (pathname === '/api/consumer/team-analytics'
    && searchParams.get('season') === String(season) && searchParams.get('window') === 'season'
    && searchParams.get('throughWeek') === '2'
    && [...searchParams.keys()].every(key => ['season', 'window', 'throughWeek', 'teams'].includes(key))) {
    const selected = searchParams.get('teams');
    if (selected !== null && selected !== 'BUF,MIA') return null;
    return { season, throughWeek: 2, window: 'season', source: 'Synthetic final games',
      coverage: { weeks: coverage, partialReasons: [] }, teams: selected ? teams : [] };
  }
  return null;
}