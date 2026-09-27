import type { ConsumerGame } from '@workspace/api-client-react';

// Synthetic contract-shaped examples; no account, provider observation or credentials.
const kickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const capturedAt = new Date(kickoff.getTime() - 24 * 60 * 60 * 1000).toISOString();
const spreadQuote = { sportsbook: 'Fixture Book', selection: 'BAL', point: -3.5, price: -110, capturedAt };
const comparison: ConsumerGame['marketBoard']['comparisons'][number] = {
  market: 'spread', label: 'Spread', state: 'available', modelValue: -4, marketValue: -3.5,
  difference: -0.5, differenceUnit: 'points', selectedQuote: spreadQuote,
  firstObserved: spreadQuote, current: spreadQuote, currentQuotes: [spreadQuote],
  modelTimestamp: capturedAt, marketTimestamp: capturedAt,
  observationAgeMinutes: 0, freshnessLabel: 'Fixture quote',
};
const base: ConsumerGame = {
  gameId: 'fixture-baltimore-buffalo', season: kickoff.getUTCFullYear(), week: 4,
  kickoffTime: kickoff.toISOString(), gameStatus: 'Scheduled', gameState: 'scheduled', venue: null,
  matchup: {
    away: { name: 'Baltimore Ravens', abbreviation: 'BAL', logoUrl: null },
    home: { name: 'Buffalo Bills', abbreviation: 'BUF', logoUrl: null },
  },
  finalScore: null,
  prediction: {
    modelLabel: 'Gridline Production Model', projectedHomeScore: 21.4, projectedAwayScore: 25.8,
    projectedMargin: -4.4, projectedTotal: 47.2, homeWinProbability: 0.41, awayWinProbability: 0.59,
  },
  market: {
    spread: spreadQuote, moneyline: null, total: null,
    evidence: { available: true, capturedAt: spreadQuote.capturedAt, message: null },
  },
  marketBoard: { status: 'partial', staleAfterMinutes: 60, selectionRule: 'Fixture selection', comparisons: [comparison] },
  recommendation: { status: 'partial', reason: null, markets: { spread: true, total: false, moneyline: false } },
  dataConfidence: { label: 'Moderate', score: 64, reason: 'Pregame evidence is partial' },
  confidence: { markets: [] },
  availability: { prediction: null, predictionReason: null, market: null },
};

export const savedGamesFixture: ConsumerGame[] = [
  base,
  {
    ...base, gameId: 'fixture-detroit-green-bay', week: 3, kickoffTime: '2026-09-20T18:00:00Z',
    gameStatus: 'Final', gameState: 'final', finalScore: { away: 24, home: 20 }, prediction: null,
    matchup: {
      away: { name: 'Detroit Lions', abbreviation: 'DET', logoUrl: null },
      home: { name: 'Green Bay Packers', abbreviation: 'GB', logoUrl: null },
    },
    market: { spread: null, moneyline: null, total: null, evidence: { available: false, capturedAt: null, message: 'No current quote' } },
    marketBoard: { status: 'absent', staleAfterMinutes: 60, selectionRule: 'Fixture selection', comparisons: [] },
    recommendation: { status: 'historical', reason: null, markets: { spread: false, total: false, moneyline: false } },
    dataConfidence: { label: 'Limited', score: null, reason: 'Historical game' },
    availability: { prediction: 'Eligible projection unavailable', predictionReason: 'missing_eligible_snapshot', market: 'Current comparison unavailable' },
  },
];