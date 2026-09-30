/**
 * How Gridline turns a projection into picks, and how those picks are graded.
 *
 * Conventions (same as live-predictions.ts):
 *   margin = projected home score - projected away score
 *   spreadLine = the HOME team's spread (negative when home is favored)
 *   A projection exactly on the line is not a pick.
 */
export type PickSide = "home" | "away";
export type TotalSide = "over" | "under";
export type PickResult = "win" | "loss" | "push";

export type GameProjection = {
  margin: number | null;
  total: number | null;
  homeWinProbability: number | null;
  spreadLine: number | null;
  totalLine: number | null;
};

export type GamePicks = {
  winner: PickSide | null;
  spread: { side: PickSide; edge: number } | null;
  total: { side: TotalSide; edge: number } | null;
};

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

export function picksForProjection(projection: GameProjection): GamePicks {
  const { margin, total, homeWinProbability, spreadLine, totalLine } = projection;
  let winner: PickSide | null = null;
  if (finite(margin) && margin !== 0) winner = margin > 0 ? "home" : "away";
  else if (finite(homeWinProbability) && homeWinProbability !== 0.5) winner = homeWinProbability > 0.5 ? "home" : "away";

  let spread: GamePicks["spread"] = null;
  if (finite(margin) && finite(spreadLine)) {
    const cover = margin + spreadLine;
    if (cover !== 0) spread = { side: cover > 0 ? "home" : "away", edge: Math.abs(cover) };
  }

  let totalPick: GamePicks["total"] = null;
  if (finite(total) && finite(totalLine)) {
    const difference = total - totalLine;
    if (difference !== 0) totalPick = { side: difference > 0 ? "over" : "under", edge: Math.abs(difference) };
  }
  return { winner, spread, total: totalPick };
}

export function gradePicks(
  picks: GamePicks,
  projection: Pick<GameProjection, "spreadLine" | "totalLine">,
  finalHome: number,
  finalAway: number,
): { winner: PickResult | null; spread: PickResult | null; total: PickResult | null } {
  const actualMargin = finalHome - finalAway;
  const actualTotal = finalHome + finalAway;
  const sideResult = (side: PickSide, value: number): PickResult =>
    value === 0 ? "push" : (value > 0) === (side === "home") ? "win" : "loss";
  return {
    winner: picks.winner ? sideResult(picks.winner, actualMargin) : null,
    spread: picks.spread && finite(projection.spreadLine)
      ? sideResult(picks.spread.side, actualMargin + projection.spreadLine)
      : null,
    total: picks.total && finite(projection.totalLine)
      ? (() => {
          const value = actualTotal - projection.totalLine!;
          return value === 0 ? "push" : (value > 0) === (picks.total!.side === "over") ? "win" : "loss";
        })()
      : null,
  };
}

export type RecordLine = { wins: number; losses: number; pushes: number };
export const emptyRecordLine = (): RecordLine => ({ wins: 0, losses: 0, pushes: 0 });

export function addResult(line: RecordLine, result: PickResult | null) {
  if (result === "win") line.wins += 1;
  else if (result === "loss") line.losses += 1;
  else if (result === "push") line.pushes += 1;
}
