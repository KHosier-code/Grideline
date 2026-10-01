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

/** Picks this high on the weekly board can be flagged as value. In testing on 2023-2026 the top 5 scored 62% of the time. */
export const VALUE_TOP_N = 5;

/** Total return per 1 staked (stake included) at American odds. */
export function decimalOdds(american: number) {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/** Expected profit per 1 staked when the bet wins with this probability at this price. */
export function expectedValue(probability: number, american: number) {
  return probability * decimalOdds(american) - 1;
}

/** A top-5 pick whose best book price pays more than our probability says it should. */
export function isValuePick(rank: number, probability: number, bookPrice: number | null | undefined) {
  return rank <= VALUE_TOP_N && typeof bookPrice === "number" && Number.isFinite(bookPrice) && bookPrice !== 0
    && expectedValue(probability, bookPrice) > 0;
}

/**
 * Season record of value picks, 1 unit on each at the captured price. Only
 * graded picks count, so a week with games still to play adds what has finished.
 */
export function valueRecord(
  weeks: Array<{ week: number; board: BoardEntry[]; results: Map<string, boolean>; price: (entry: BoardEntry) => number | null }>,
) {
  let picks = 0;
  let hits = 0;
  let units = 0;
  const byWeek: Array<{ week: number; picks: number; hits: number; units: number }> = [];
  for (const { week, board, results, price } of weeks) {
    const line = { week, picks: 0, hits: 0, units: 0 };
    board.slice(0, VALUE_TOP_N).forEach((entry, index) => {
      const odds = price(entry);
      if (!isValuePick(index + 1, entry.probability, odds) || !results.has(entry.playerId)) return;
      const scored = results.get(entry.playerId)!;
      line.picks += 1;
      line.hits += scored ? 1 : 0;
      line.units += scored ? decimalOdds(odds!) - 1 : -1;
    });
    if (!line.picks) continue;
    picks += line.picks;
    hits += line.hits;
    units += line.units;
    byWeek.push({ ...line, units: Math.round(line.units * 100) / 100 });
  }
  return { picks, hits, units: Math.round(units * 100) / 100, weeks: byWeek.sort((a, b) => a.week - b.week) };
}
