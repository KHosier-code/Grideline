import type { ConsumerGame, ConsumerGameProjection, ConsumerProjectionQb } from '@workspace/api-client-react';

/**
 * Game projections for the weekly page. These are projections, not picks:
 * in walk-forward tests against closing lines neither the old model nor the
 * QB-adjusted model beat the spread (about 50%), so the site shows our line
 * next to the sportsbook's and does not recommend a side.
 * See research/game-model/README.md.
 *
 * Conventions: margin = home score - away score; the sportsbook spread quote is
 * the HOME team's line (negative when home is favored).
 */
export type Side = 'home' | 'away';

export type GameView = {
  game: ConsumerGame;
  projection: {
    home: number;
    away: number;
    margin: number;
    total: number;
    homeWin: number;
    source: 'qb-model' | 'legacy';
    homeQb: ConsumerProjectionQb | null;
    awayQb: ConsumerProjectionQb | null;
  } | null;
  winner: { side: Side; probability: number } | null;
  vegas: { homeLine: number | null; total: number | null; favorite: Side | null };
  result: 'win' | 'loss' | 'push' | null;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function buildGameView(game: ConsumerGame, qbModel?: ConsumerGameProjection): GameView {
  let projection: GameView['projection'] = null;
  if (qbModel) {
    projection = {
      home: (qbModel.projectedTotal + qbModel.projectedMargin) / 2,
      away: (qbModel.projectedTotal - qbModel.projectedMargin) / 2,
      margin: qbModel.projectedMargin, total: qbModel.projectedTotal, homeWin: qbModel.homeWinProbability,
      source: 'qb-model', homeQb: qbModel.homeQb, awayQb: qbModel.awayQb,
    };
  } else {
    const p = game.prediction;
    if (p && finite(p.projectedHomeScore) && finite(p.projectedAwayScore) && finite(p.projectedMargin)
      && finite(p.projectedTotal) && finite(p.homeWinProbability)) {
      projection = { home: p.projectedHomeScore, away: p.projectedAwayScore, margin: p.projectedMargin, total: p.projectedTotal,
        homeWin: p.homeWinProbability, source: 'legacy', homeQb: null, awayQb: null };
    }
  }
  const winner = projection && projection.margin !== 0
    ? { side: (projection.margin > 0 ? 'home' : 'away') as Side, probability: projection.margin > 0 ? projection.homeWin : 1 - projection.homeWin }
    : null;
  const homeLine = finite(game.market?.spread?.point) ? game.market!.spread!.point! : null;
  const vegasTotal = finite(game.market?.total?.point) ? game.market!.total!.point! : null;
  const favorite: Side | null = homeLine === null || homeLine === 0 ? null : homeLine < 0 ? 'home' : 'away';
  let result: GameView['result'] = null;
  if (winner && game.finalScore) {
    const actual = game.finalScore.home - game.finalScore.away;
    result = actual === 0 ? 'push' : (actual > 0) === (winner.side === 'home') ? 'win' : 'loss';
  }
  return { game, projection, winner, vegas: { homeLine, total: vegasTotal, favorite }, result };
}

/** "BUF -7.5" style line for the team a margin favors (home-minus-away margin). */
export function lineText(margin: number, home: string, away: string) {
  const rounded = Math.round(Math.abs(margin) * 2) / 2;
  if (rounded === 0) return 'Pick’em';
  return `${margin > 0 ? home : away} -${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}`;
}

/** The sportsbook's home spread as the favorite's line, e.g. home +3 -> "AWY -3". */
export function vegasLineText(homeLine: number, home: string, away: string) {
  if (homeLine === 0) return 'Pick’em';
  return lineText(-homeLine, home, away);
}

/** The week to show: the one containing the next kickoff, else the latest week. */
export function currentWeek(games: ConsumerGame[], now: number) {
  const dated = games.filter(game => game.kickoffTime && Number.isFinite(Date.parse(game.kickoffTime)));
  if (!dated.length) return null;
  const upcoming = dated.filter(game => Date.parse(game.kickoffTime!) > now && !game.finalScore)
    .sort((a, b) => Date.parse(a.kickoffTime!) - Date.parse(b.kickoffTime!));
  const anchor = upcoming[0] ?? [...dated].sort((a, b) => b.season - a.season || b.week - a.week)[0];
  return {
    season: anchor.season,
    week: anchor.week,
    games: dated.filter(game => game.season === anchor.season && game.week === anchor.week)
      .sort((a, b) => Date.parse(a.kickoffTime!) - Date.parse(b.kickoffTime!) || a.gameId.localeCompare(b.gameId)),
  };
}

export function formatPrice(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
