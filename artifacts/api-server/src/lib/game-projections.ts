import type { GameProjectionRow } from "@workspace/db";
import { addResult, emptyRecordLine, type RecordLine } from "./pick-grading";

export type ProjectionRun = { generatedAt: Date; games: GameProjectionRow[] };
export type ProjectionEntry = GameProjectionRow & { generatedAt: Date };

/** Latest projection per game made before its kickoff (or the latest, before kickoff). */
export function projectionsBeforeKickoff(runs: ProjectionRun[]): Map<string, ProjectionEntry> {
  const ordered = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  const byGame = new Map<string, ProjectionEntry>();
  for (const run of ordered) {
    for (const game of run.games) {
      const kickoff = game.kickoff ? new Date(game.kickoff) : null;
      if (kickoff && !Number.isNaN(kickoff.getTime()) && run.generatedAt >= kickoff) continue;
      byGame.set(game.gameId, { ...game, generatedAt: run.generatedAt });
    }
  }
  return byGame;
}

/** Straight-up winner record: the projected winner vs the final score. */
export function winnerRecord(
  projections: Iterable<ProjectionEntry>,
  finals: Map<string, { home: number; away: number; week: number }>,
) {
  const total = emptyRecordLine();
  const weeks = new Map<number, RecordLine>();
  for (const projection of projections) {
    const final = finals.get(projection.gameId);
    if (!final || projection.projectedMargin === 0) continue;
    const actual = final.home - final.away;
    const result = actual === 0 ? "push" as const : (actual > 0) === (projection.projectedMargin > 0) ? "win" as const : "loss" as const;
    addResult(total, result);
    const week = weeks.get(final.week) ?? emptyRecordLine();
    addResult(week, result);
    weeks.set(final.week, week);
  }
  return { total, weeks };
}

/** Straight-up record of the betting favorite (from the line sent with each projection). */
export function favoriteRecord(
  projections: Iterable<ProjectionEntry>,
  finals: Map<string, { home: number; away: number; week: number }>,
) {
  const total = emptyRecordLine();
  for (const projection of projections) {
    const final = finals.get(projection.gameId);
    const line = projection.marketMargin;
    if (!final || typeof line !== "number" || !Number.isFinite(line) || line === 0) continue;
    const actual = final.home - final.away;
    addResult(total, actual === 0 ? "push" : (actual > 0) === (line > 0) ? "win" : "loss");
  }
  return total;
}

/** One saved spread quote, as the home team's line (negative when home is favored). */
export type SpreadQuote = { sportsbook: string; capturedAt: Date; homeLine: number };

export type LineValueGame = {
  gameId: string;
  /** Gridline's expected home margin when the opener was captured. */
  gridlineMargin: number;
  openLine: number;
  closeLine: number;
  sportsbook: string;
  /** Side Gridline leaned against the opener, or null when within the threshold. */
  lean: "home" | "away" | null;
  /** Points the line moved toward Gridline's side between open and close (negative = away). */
  movedToward: number | null;
  atsOpen: "win" | "loss" | "push" | null;
  atsClose: "win" | "loss" | "push" | null;
};

export const LEAN_THRESHOLD = 0.5;

function coverResult(lean: "home" | "away", homeLine: number, final: { home: number; away: number }) {
  const cover = final.home - final.away + homeLine;
  if (cover === 0) return "push" as const;
  return (cover > 0) === (lean === "home") ? "win" as const : "loss" as const;
}

/**
 * Closing line value: did the line move toward Gridline between the first and
 * last capture before kickoff? Uses one book per game (DraftKings, else
 * FanDuel) so open and close are comparable, and the Gridline line that was
 * published by the time the opener was captured (else the first one before
 * kickoff). A line that closes on Gridline's side of the opener is evidence of
 * real information; it needs far fewer games to show than a win-loss record.
 */
export function lineValueGames(
  runs: ProjectionRun[],
  quotesByGame: Map<string, SpreadQuote[]>,
  finals: Map<string, { home: number; away: number; week: number }>,
): LineValueGame[] {
  const ordered = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  const games: LineValueGame[] = [];
  for (const [gameId, quotes] of quotesByGame) {
    const projections = ordered.flatMap((run) => run.games
      .filter((game) => game.gameId === gameId)
      .map((game) => ({ ...game, generatedAt: run.generatedAt })));
    if (!projections.length) continue;
    const kickoffText = projections[0].kickoff;
    const kickoff = kickoffText ? new Date(kickoffText) : null;
    if (!kickoff || Number.isNaN(kickoff.getTime())) continue;
    for (const sportsbook of ["DraftKings", "FanDuel"]) {
      const book = quotes
        .filter((quote) => quote.sportsbook === sportsbook && quote.capturedAt < kickoff && Number.isFinite(quote.homeLine))
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
      if (book.length < 2) continue;
      const open = book[0];
      const close = book.at(-1)!;
      const pregame = projections.filter((item) => item.generatedAt < kickoff);
      const atOpen = pregame.filter((item) => item.generatedAt <= open.capturedAt).at(-1)
        ?? pregame.find((item) => item.generatedAt < close.capturedAt);
      if (!atOpen) break;
      const edge = atOpen.projectedMargin + open.homeLine;
      const lean = Math.abs(edge) < LEAN_THRESHOLD ? null : edge > 0 ? "home" as const : "away" as const;
      const final = finals.get(gameId);
      // A home line moving from -3 to -4 moves toward home by one point.
      const homeMove = open.homeLine - close.homeLine;
      games.push({
        gameId, gridlineMargin: atOpen.projectedMargin, openLine: open.homeLine, closeLine: close.homeLine, sportsbook, lean,
        movedToward: lean === null ? null : lean === "home" ? homeMove : -homeMove,
        atsOpen: lean && final ? coverResult(lean, open.homeLine, final) : null,
        atsClose: lean && final ? coverResult(lean, close.homeLine, final) : null,
      });
      break;
    }
  }
  return games;
}

export function lineValueSummary(games: LineValueGame[]) {
  const leans = games.filter((game) => game.lean !== null);
  const moves = leans.map((game) => game.movedToward!);
  const atsOpen = emptyRecordLine();
  const atsClose = emptyRecordLine();
  for (const game of leans) {
    if (game.atsOpen) addResult(atsOpen, game.atsOpen);
    if (game.atsClose) addResult(atsClose, game.atsClose);
  }
  return {
    games: games.length,
    leans: leans.length,
    threshold: LEAN_THRESHOLD,
    movedToward: moves.filter((move) => move > 0).length,
    movedAway: moves.filter((move) => move < 0).length,
    unchanged: moves.filter((move) => move === 0).length,
    averageMove: moves.length ? Math.round((moves.reduce((sum, move) => sum + move, 0) / moves.length) * 100) / 100 : null,
    atsOpen,
    atsClose,
  };
}
