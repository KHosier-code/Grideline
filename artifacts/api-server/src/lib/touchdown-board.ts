import type { TouchdownPickRow } from "@workspace/db";

export type TouchdownRun = { generatedAt: Date; picks: TouchdownPickRow[] };
export type BoardEntry = TouchdownPickRow & { generatedAt: Date };

/**
 * One entry per player for a week. A player's entry comes from the latest run
 * made before their kickoff (so Thursday players keep the ranking published
 * before Thursday). Before kickoff, the latest run wins. A player whose game
 * started before every run that includes them is left out.
 */
export function boardForWeek(runs: TouchdownRun[], now: Date): BoardEntry[] {
  const ordered = [...runs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
  const byPlayer = new Map<string, BoardEntry>();
  for (const run of ordered) {
    for (const pick of run.picks) {
      const kickoff = pick.kickoff ? new Date(pick.kickoff) : null;
      const beforeKickoff = !kickoff || Number.isNaN(kickoff.getTime()) || run.generatedAt < kickoff;
      if (!beforeKickoff) continue;
      byPlayer.set(pick.playerId, { ...pick, generatedAt: run.generatedAt });
    }
  }
  const latestRun = ordered.at(-1);
  const latestIds = new Set(latestRun?.picks.map((pick) => pick.playerId) ?? []);
  // A player dropped from the latest run (for example ruled out) before their
  // game started should not stay on the board.
  return [...byPlayer.values()].filter((entry) => {
    const kickoff = entry.kickoff ? new Date(entry.kickoff) : null;
    const started = kickoff !== null && !Number.isNaN(kickoff.getTime()) && kickoff <= now;
    const coveredByLatest = latestRun !== undefined && kickoff !== null && latestRun.generatedAt < kickoff;
    return started || !coveredByLatest || latestIds.has(entry.playerId);
  }).sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name));
}

/** American odds that match a probability (no bookmaker margin). */
export function fairAmericanOdds(probability: number) {
  const p = Math.min(Math.max(probability, 0.001), 0.999);
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/** Top-10 record over weeks where every top-10 player has a graded result. */
export function topTenRecord(
  weeks: Array<{ week?: number; board: BoardEntry[]; results: Map<string, boolean> }>,
) {
  let weeksGraded = 0;
  let topTenPicks = 0;
  let topTenHits = 0;
  const byWeek: Array<{ week: number; picks: number; hits: number }> = [];
  for (const { week, board, results } of weeks) {
    const top = board.slice(0, 10);
    if (top.length < 10 || top.some((entry) => !results.has(entry.playerId))) continue;
    const hits = top.filter((entry) => results.get(entry.playerId)).length;
    weeksGraded += 1;
    topTenPicks += top.length;
    topTenHits += hits;
    if (week !== undefined) byWeek.push({ week, picks: top.length, hits });
  }
  return { weeksGraded, topTenPicks, topTenHits, weeks: byWeek.sort((a, b) => a.week - b.week) };
}
