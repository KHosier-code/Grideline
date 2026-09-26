import type { ConsumerGame, ConsumerMarketComparison } from '@workspace/api-client-react';

export type Slate = { season: number; week: number };
export function readSlate(search: string): Slate | null {
  const params = new URLSearchParams(search);
  const season = params.get('season');
  const week = params.get('week');
  if (!season || !week || !/^\d+$/.test(season) || !/^\d+$/.test(week)) return null;
  const values = { season: Number(season), week: Number(week) };
  return values.season >= 2020 && values.week >= 1 && values.week <= 22 ? values : null;
}

export function officialResult(game: Pick<ConsumerGame, 'gameState' | 'finalScore'>) {
  return game.gameState === 'final' ? game.finalScore : null;
}

export function eligibleMarkets(game: ConsumerGame, now: number) {
  const open = Boolean(game.kickoffTime && new Date(game.kickoffTime).getTime() > now
    && (game.gameState === 'scheduled' || game.gameState === 'pregame'));
  return game.marketBoard.comparisons.filter((comparison) =>
    open && ['healthy', 'partial'].includes(game.recommendation.status)
    && comparison.state === 'available' && game.recommendation.markets[comparison.market]);
}

export function marketBlocker(game: ConsumerGame, comparison: ConsumerMarketComparison, now: number) {
  if (eligibleMarkets(game, now).some((item) => item.market === comparison.market)) return null;
  if (!game.kickoffTime || new Date(game.kickoffTime).getTime() <= now
    || !['scheduled', 'pregame'].includes(game.gameState)) return 'Closed at kickoff';
  if (['stale', 'partial', 'unavailable'].includes(game.recommendation.status)
    && /Current recommendations are unavailable/.test(game.recommendation.reason ?? ''))
    return game.recommendation.reason;
  if (comparison.state === 'stale') return 'Market observation stale';
  if (comparison.state === 'absent') return 'No market observation';
  if (comparison.modelValue === null) return 'Saved model value unavailable';
  return 'Incomplete DK/FD price pairs';
}