import type { ConsumerGame, ConsumerGameProjections } from '@workspace/api-client-react';

// Synthetic contract-shaped examples; no account, provider observation or credentials.
const kickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const capturedAt = new Date(kickoff.getTime() - 24 * 60 * 60 * 1000).toISOString();
const spreadQuote = { sportsbook: 'Fixture Book', selection: 'BAL', point: -3.5, price: -110, capturedAt };
const base: ConsumerGame = {
  gameId: 'fixture-baltimore-buffalo', season: kickoff.getUTCFullYear(), week: 4,
  kickoffTime: kickoff.toISOString(), gameStatus: 'Scheduled', gameState: 'scheduled', venue: null,
  matchup: {
    away: { name: 'Baltimore Ravens', abbreviation: 'BAL', logoUrl: null },
    home: { name: 'Buffalo Bills', abbreviation: 'BUF', logoUrl: null },
  },
  finalScore: null,
  market: {
    spread: spreadQuote, moneyline: null, total: null,
    evidence: { available: true, capturedAt: spreadQuote.capturedAt, message: null },
  },
  initialMarkets: { capturedAt: null, moneyline: null, spread: null, total: null },
  availability: { market: null },
};

export const savedGamesFixture: ConsumerGame[] = [
  base,
  {
    ...base, gameId: 'fixture-detroit-green-bay', week: 3, kickoffTime: '2026-09-20T18:00:00Z',
    gameStatus: 'Final', gameState: 'final', finalScore: { away: 24, home: 20 },
    matchup: {
      away: { name: 'Detroit Lions', abbreviation: 'DET', logoUrl: null },
      home: { name: 'Green Bay Packers', abbreviation: 'GB', logoUrl: null },
    },
    market: { spread: null, moneyline: null, total: null, evidence: { available: false, capturedAt: null, message: 'No current quote' } },
    availability: { market: 'Current comparison unavailable' },
  },
];

/** QB-adjusted model projection for the upcoming fixture game only; the final game has none. */
export function savedGamesProjectionsFixture(season: number): ConsumerGameProjections {
  const qb = (name: string) => ({ name, value: 0.05, listed: true, newStarter: false });
  return {
    status: 'available', season, modelVersion: 'fixture', generatedAt: capturedAt, evaluation: {},
    games: savedGamesFixture.filter(game => game.season === season && game.gameState === 'scheduled').map(game => ({
      gameId: game.gameId, nflverseGameId: `fixture_${game.gameId}`, homeTeam: game.matchup.home.abbreviation,
      awayTeam: game.matchup.away.abbreviation, kickoff: game.kickoffTime, projectedMargin: -4.4, projectedTotal: 47.2,
      homeWinProbability: 0.41, homeQb: qb('Josh Allen'), awayQb: qb('Lamar Jackson'),
      factors: { qbEdge: -0.02, teamEdge: -0.04, passEdge: -0.03, rushEdge: -0.05, restDiff: 0, neutralSite: false },
      projectedAt: capturedAt,
    })),
    record: { wins: 0, losses: 0, pushes: 0 }, favoriteRecord: { wins: 0, losses: 0, pushes: 0 },
    lineValue: { games: 0, leans: 0, threshold: 1.5, movedToward: 0, movedAway: 0, unchanged: 0, averageMove: null,
      atsOpen: { wins: 0, losses: 0, pushes: 0 }, atsClose: { wins: 0, losses: 0, pushes: 0 } },
    weeks: [],
  };
}
