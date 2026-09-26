import type { ConsumerGame, ConsumerMarketComparison } from '@workspace/api-client-react';
import { eligibleMarkets, marketBlocker } from './consumer-board.ts';

export function nextHomeSlate(games: ConsumerGame[], now: number) {
  const upcoming = games.filter(game => game.kickoffTime && Number.isFinite(Date.parse(game.kickoffTime))
    && Date.parse(game.kickoffTime) > now && ['pregame', 'scheduled'].includes(game.gameState))
    .sort((a, b) => Date.parse(a.kickoffTime!) - Date.parse(b.kickoffTime!) || a.gameId.localeCompare(b.gameId));
  const first = upcoming[0];
  if (!first) return null;
  return {
    season: first.season,
    week: first.week,
    games: upcoming.filter(game => game.season === first.season && game.week === first.week),
  };
}

export function weeklyHomePick(games: ConsumerGame[], now: number): { teamName: string } | null {
  const slate = nextHomeSlate(games, now);
  if (!slate) return null;
  const eligible = slate.games.flatMap((game) => {
    const prediction = game.prediction;
    const savedAt = prediction?.predictionTimestamp ? Date.parse(prediction.predictionTimestamp) : NaN;
    const kickoff = Date.parse(game.kickoffTime!);
    const home = prediction?.homeWinProbability;
    const away = prediction?.awayWinProbability;
    if (game.finalScore || prediction?.officialFinalPrediction !== true
      || !Number.isFinite(savedAt) || savedAt >= kickoff || savedAt > now
      || typeof home !== 'number' || typeof away !== 'number'
      || !Number.isFinite(home) || !Number.isFinite(away)
      || home < 0 || home > 1 || away < 0 || away > 1
      || Math.abs(home + away - 1) > 0.001 || home === away) return [];
    const teamName = home > away ? game.matchup.home?.name : game.matchup.away?.name;
    if (typeof teamName !== 'string' || !teamName.trim()) return [];
    return [{ teamName: teamName.trim(), probability: Math.max(home, away), kickoff, gameId: game.gameId }];
  });
  eligible.sort((a, b) => b.probability - a.probability || a.kickoff - b.kickoff || a.gameId.localeCompare(b.gameId));
  return eligible[0] ? { teamName: eligible[0].teamName } : null;
}

export function homeProjection(game: ConsumerGame) {
  if (!game.prediction) return { label: 'No eligible saved projection', detail: game.availability.prediction ?? 'No eligible saved prediction is available.' };
  return {
    label: game.prediction.officialFinalPrediction
      ? 'Verified official pregame prediction · frozen before kickoff'
      : 'Saved model outlook · not an official frozen prediction',
    detail: game.prediction.predictionTimestamp
      ? `Saved ${new Date(game.prediction.predictionTimestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Saved time unavailable',
  };
}

export function homeSpread(game: ConsumerGame, now: number): { comparison: ConsumerMarketComparison | null; reason: string } {
  const spread = game.marketBoard.comparisons.find(item => item.market === 'spread');
  if (!spread) return { comparison: null, reason: 'Spread comparison unavailable' };
  if (spread.state === 'absent' && !spread.selectedQuote) return {
    comparison: null,
    reason: game.recommendation.status === 'stale' ? 'No saved odds for this game · feeds stale' : 'No saved odds for this game',
  };
  if (!eligibleMarkets(game, now).includes(spread)) return { comparison: null, reason: marketBlocker(game, spread, now) ?? 'Spread comparison unavailable' };
  if (!game.prediction || spread.modelValue === null || spread.marketValue === null || spread.difference === null
    || spread.differenceUnit !== 'points' || !spread.selectedQuote || spread.selectedQuote.point === null
    || !spread.selectedQuote.capturedAt || !Number.isFinite(Date.parse(spread.selectedQuote.capturedAt))
    || ![spread.modelValue, spread.marketValue, spread.difference, spread.selectedQuote.point, spread.selectedQuote.price].every(Number.isFinite)
    || Math.abs(spread.difference - (spread.modelValue + spread.marketValue)) > 0.001
    || Math.abs(spread.marketValue - spread.selectedQuote.point) > 0.001
    || spread.selectedQuote.selection !== game.matchup.home.abbreviation) {
    return { comparison: null, reason: 'Incomplete or inconsistent spread evidence' };
  }
  return { comparison: spread, reason: '' };
}