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
