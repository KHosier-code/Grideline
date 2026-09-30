import type { ConsumerGame } from '@workspace/api-client-react';

/**
 * Turns a game's saved projection and sportsbook lines into Gridline's picks.
 * Same rules as the server's record (artifacts/api-server/src/lib/pick-grading.ts):
 *   margin = projected home score - projected away score
 *   the spread quote is the HOME team's line (negative = home favored)
 *   a projection exactly on the line is not a pick
 */
/**
 * Over/under picks are off: the current totals model projects nearly the same
 * total (about 44-46 points) for every game, so "picks" would only restate
 * whether the line is above or below 45. Our projected total is still shown.
 * Turn this back on once a totals model beats the market in testing.
 */
export const TOTAL_PICKS_ENABLED = false;

export type Side = 'home' | 'away';
export type Strength = 'strong' | 'lean' | 'small';

export type GamePicks = {
  game: ConsumerGame;
  projection: { home: number; away: number; margin: number; total: number; homeWin: number } | null;
  winner: { side: Side; probability: number } | null;
  spread: { homeLine: number; side: Side; line: number; edge: number; strength: Strength } | null;
  total: { line: number; side: 'Over' | 'Under'; edge: number; strength: Strength } | null;
  moneyline: { side: Side; price: number | null; impliedProbability: number | null; edge: number | null } | null;
  bestEdge: number;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function edgeStrength(edge: number): Strength {
  return edge >= 3 ? 'strong' : edge >= 1.5 ? 'lean' : 'small';
}

export function impliedProbability(american: number) {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

export function analyzeGame(game: ConsumerGame): GamePicks {
  const p = game.prediction;
  const projection = p && finite(p.projectedHomeScore) && finite(p.projectedAwayScore) && finite(p.projectedMargin)
    && finite(p.projectedTotal) && finite(p.homeWinProbability)
    ? { home: p.projectedHomeScore, away: p.projectedAwayScore, margin: p.projectedMargin, total: p.projectedTotal, homeWin: p.homeWinProbability }
    : null;

  let winner: GamePicks['winner'] = null;
  if (projection && projection.margin !== 0) {
    const side: Side = projection.margin > 0 ? 'home' : 'away';
    winner = { side, probability: side === 'home' ? projection.homeWin : 1 - projection.homeWin };
  }

  let spread: GamePicks['spread'] = null;
  const homeLine = game.market?.spread?.point;
  if (projection && finite(homeLine)) {
    const cover = projection.margin + homeLine;
    if (cover !== 0) {
      const side: Side = cover > 0 ? 'home' : 'away';
      spread = { homeLine, side, line: side === 'home' ? homeLine : -homeLine, edge: Math.abs(cover), strength: edgeStrength(Math.abs(cover)) };
    }
  }

  let total: GamePicks['total'] = null;
  const totalLine = game.market?.total?.point;
  if (TOTAL_PICKS_ENABLED && projection && finite(totalLine)) {
    const difference = projection.total - totalLine;
    if (difference !== 0) {
      total = { line: totalLine, side: difference > 0 ? 'Over' : 'Under', edge: Math.abs(difference), strength: edgeStrength(Math.abs(difference)) };
    }
  }

  let moneyline: GamePicks['moneyline'] = null;
  if (winner) {
    const quote = winner.side === 'home' ? game.market?.moneyline : game.market?.awayMoneyline;
    const price = finite(quote?.price) && (quote!.price <= -100 || quote!.price >= 100) ? quote!.price : null;
    const implied = price === null ? null : impliedProbability(price);
    moneyline = { side: winner.side, price, impliedProbability: implied, edge: implied === null ? null : winner.probability - implied };
  }

  return { game, projection, winner, spread, total, moneyline, bestEdge: Math.max(spread?.edge ?? 0, total?.edge ?? 0) };
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

export type EdgePick = { picks: GamePicks; kind: 'spread' | 'total'; edge: number };

/** The biggest disagreements with the market among games that haven't kicked off. */
export function biggestEdges(all: GamePicks[], now: number, count = 3): EdgePick[] {
  return all
    .filter(item => item.game.kickoffTime && Date.parse(item.game.kickoffTime) > now && !item.game.finalScore)
    .flatMap(item => [
      ...(item.spread ? [{ picks: item, kind: 'spread' as const, edge: item.spread.edge }] : []),
      ...(item.total ? [{ picks: item, kind: 'total' as const, edge: item.total.edge }] : []),
    ])
    .sort((a, b) => b.edge - a.edge)
    .slice(0, count);
}

export function signed(value: number) {
  const text = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1);
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : 'PK';
}

export function formatPrice(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
