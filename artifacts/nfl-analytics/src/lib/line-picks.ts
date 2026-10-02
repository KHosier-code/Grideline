import type { GameView, Side } from './pick-sheet';

/**
 * Spread and over/under picks for Pool Picks. Each is Gridline's lean against
 * the sportsbook number: the side our projection likes, ranked by how far our
 * number is from the book's. In walk-forward tests every-game spread leans hit
 * about 51-53% against the close, so the gap is shown as a lean, not a lock.
 * The one rule that held up was a gap of 4+ points (see research/algo-sweep),
 * so those games get their own label.
 */
export type LineMarket = 'spread' | 'total';
export type TotalSide = 'over' | 'under';
export type LineResult = 'win' | 'loss' | 'push' | null;

export const BIG_GAP = 4;

export type SpreadPick = {
  market: 'spread';
  view: GameView;
  side: Side;
  /** The picked team's line, e.g. -3.5 or +7. */
  line: number;
  /** Points our projection is past the book's number, always > 0. */
  edge: number;
  result: LineResult;
};

export type TotalPick = {
  market: 'total';
  view: GameView;
  side: TotalSide;
  line: number;
  edge: number;
  result: LineResult;
};

export type LinePick = SpreadPick | TotalPick;

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Home margin + home spread: positive means home covered. */
export function spreadResult(homeMargin: number, homeLine: number, side: Side): LineResult {
  const cover = homeMargin + homeLine;
  if (cover === 0) return 'push';
  return (cover > 0) === (side === 'home') ? 'win' : 'loss';
}

export function totalResult(points: number, line: number, side: TotalSide): LineResult {
  if (points === line) return 'push';
  return (points > line) === (side === 'over') ? 'win' : 'loss';
}

export function spreadPick(view: GameView): SpreadPick | null {
  const homeLine = view.vegas.homeLine;
  if (!view.projection || homeLine === null) return null;
  const gap = view.projection.margin + homeLine;
  if (Math.abs(gap) < 0.05) return null;
  const side: Side = gap > 0 ? 'home' : 'away';
  const final = view.game.finalScore;
  return {
    market: 'spread', view, side,
    line: side === 'home' ? homeLine : -homeLine,
    edge: round1(Math.abs(gap)),
    result: final ? spreadResult(final.home - final.away, homeLine, side) : null,
  };
}

export function totalPick(view: GameView): TotalPick | null {
  const line = view.vegas.total;
  if (!view.projection || line === null) return null;
  const gap = view.projection.total - line;
  if (Math.abs(gap) < 0.05) return null;
  const side: TotalSide = gap > 0 ? 'over' : 'under';
  const final = view.game.finalScore;
  return {
    market: 'total', view, side, line,
    edge: round1(Math.abs(gap)),
    result: final ? totalResult(final.home + final.away, line, side) : null,
  };
}

/** Biggest gap first; confidence points count down from the number of games. */
export function rankLinePicks<T extends LinePick>(picks: T[]) {
  const ranked = [...picks].sort((a, b) => b.edge - a.edge || a.view.game.gameId.localeCompare(b.view.game.gameId));
  return ranked.map((pick, index) => ({ pick, points: ranked.length - index }));
}

export function linePickRecord(picks: LinePick[]) {
  const record = { wins: 0, losses: 0, pushes: 0 };
  for (const pick of picks) {
    if (pick.result === 'win') record.wins += 1;
    else if (pick.result === 'loss') record.losses += 1;
    else if (pick.result === 'push') record.pushes += 1;
  }
  return record;
}

const signed = (value: number) => {
  const rounded = Math.round(value * 2) / 2;
  if (rounded === 0) return 'PK';
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? '+' : '-'}${text}`;
};

/** "BUF -3.5" or "Over 47.5". */
export function linePickLabel(pick: LinePick) {
  if (pick.market === 'total') return `${pick.side === 'over' ? 'Over' : 'Under'} ${pick.line}`;
  return `${pick.view.game.matchup[pick.side].abbreviation} ${signed(pick.line)}`;
}
