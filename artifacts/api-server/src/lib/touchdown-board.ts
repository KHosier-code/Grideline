import type { TouchdownPickRow } from "@workspace/db";
import { lockedAt } from "./game-projections";

/** `receivedAt` is the server's clock; a run counts from the later of the two (see lockedAt). */
export type TouchdownRun = { generatedAt: Date; receivedAt?: Date; picks: TouchdownPickRow[] };
export type BoardEntry = TouchdownPickRow & { generatedAt: Date; lockedAt: Date };

/**
 * One entry per player for a week. A player's entry comes from the latest run
 * made before their kickoff (so Thursday players keep the ranking published
 * before Thursday). Before kickoff, the latest run wins. A player whose game
 * started before every run that includes them is left out.
 */
export function boardForWeek(runs: TouchdownRun[], now: Date): BoardEntry[] {
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const byPlayer = new Map<string, BoardEntry>();
  for (const run of ordered) {
    const locked = lockedAt(run);
    for (const pick of run.picks) {
      const kickoff = pick.kickoff ? new Date(pick.kickoff) : null;
      const beforeKickoff = !kickoff || Number.isNaN(kickoff.getTime()) || locked < kickoff;
      if (!beforeKickoff) continue;
      byPlayer.set(pick.playerId, { ...pick, generatedAt: run.generatedAt, lockedAt: locked });
    }
  }
  const latestRun = ordered.at(-1);
  const latestIds = new Set(latestRun?.picks.map((pick) => pick.playerId) ?? []);
  // A player dropped from the latest run (for example ruled out) before their
  // game started should not stay on the board.
  return [...byPlayer.values()].filter((entry) => {
    const kickoff = entry.kickoff ? new Date(entry.kickoff) : null;
    const started = kickoff !== null && !Number.isNaN(kickoff.getTime()) && kickoff <= now;
    const coveredByLatest = latestRun !== undefined && kickoff !== null && lockedAt(latestRun) < kickoff;
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
  weeks: Array<{ week?: number; board: BoardEntry[]; results: Map<string, boolean>; price?: (entry: BoardEntry) => number | null }>,
) {
  let weeksGraded = 0;
  let topTenPicks = 0;
  let topTenHits = 0;
  let expectedHits = 0;
  const priced = { picks: 0, hits: 0, units: 0 };
  const byWeek: Array<{ week: number; picks: number; hits: number; expectedHits: number; pricedPicks: number; units: number }> = [];
  for (const { week, board, results, price } of weeks) {
    const top = board.slice(0, 10);
    if (top.length < 10 || top.some((entry) => !results.has(entry.playerId))) continue;
    const hits = top.filter((entry) => results.get(entry.playerId)).length;
    const expected = top.reduce((sum, entry) => sum + entry.probability, 0);
    // 1 unit on each top-10 pick that had a captured DraftKings/FanDuel price.
    let pricedPicks = 0;
    let units = 0;
    for (const entry of top) {
      const odds = price?.(entry);
      if (typeof odds !== "number" || !Number.isFinite(odds) || odds === 0) continue;
      pricedPicks += 1;
      units += results.get(entry.playerId) ? decimalOdds(odds) - 1 : -1;
      if (results.get(entry.playerId)) priced.hits += 1;
    }
    weeksGraded += 1;
    topTenPicks += top.length;
    topTenHits += hits;
    expectedHits += expected;
    priced.picks += pricedPicks;
    priced.units += units;
    if (week !== undefined) {
      byWeek.push({ week, picks: top.length, hits, expectedHits: Math.round(expected * 10) / 10, pricedPicks, units: Math.round(units * 100) / 100 });
    }
  }
  return {
    weeksGraded, topTenPicks, topTenHits,
    expectedHits: Math.round(expectedHits * 10) / 10,
    priced: { ...priced, units: Math.round(priced.units * 100) / 100 },
    weeks: byWeek.sort((a, b) => a.week - b.week),
  };
}

/** Picks this high on the weekly board can be flagged as value. In testing on 2021-2026 the top 5 scored 55% of the time. */
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

/**
 * Typical anytime-TD hold at DraftKings and FanDuel (the books post only the
 * Yes side). Same value as TD_PROP_HOLD in the site's lib/market.ts.
 */
export const TD_PROP_HOLD = 0.2;

/** The book's chance with its cut taken out, averaged over the books that priced the player. */
export function bookFairProbability(prices: number[]) {
  const usable = prices.filter((price) => Number.isFinite(price) && price !== 0 && Math.abs(price) >= 100);
  if (!usable.length) return null;
  const implied = usable.map((price) => (price < 0 ? -price / (-price + 100) : 100 / (price + 100)));
  return Math.min(0.99, implied.reduce((sum, value) => sum + value, 0) / implied.length / (1 + TD_PROP_HOLD));
}

/**
 * Our chances against the books' on every graded player both of us priced.
 * Lower Brier score and log loss are better. Until ours is lower over a full
 * season, a "value" flag means only that the price beats our own number.
 */
export function bookComparison(rows: Array<{ week: number; probability: number; bookProbability: number; scored: boolean }>) {
  const clip = (p: number) => Math.min(Math.max(p, 0.001), 0.999);
  const score = (pick: (row: (typeof rows)[number]) => number) => {
    if (!rows.length) return { brier: null, logLoss: null };
    let brier = 0; let logLoss = 0;
    for (const row of rows) {
      const p = clip(pick(row)); const y = row.scored ? 1 : 0;
      brier += (p - y) ** 2;
      logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
    }
    return { brier: Math.round((brier / rows.length) * 10000) / 10000, logLoss: Math.round((logLoss / rows.length) * 10000) / 10000 };
  };
  const model = score((row) => row.probability);
  const book = score((row) => row.bookProbability);
  return {
    players: rows.length,
    weeks: new Set(rows.map((row) => row.week)).size,
    scored: rows.filter((row) => row.scored).length,
    modelAverage: rows.length ? Math.round((rows.reduce((sum, row) => sum + row.probability, 0) / rows.length) * 1000) / 1000 : null,
    bookAverage: rows.length ? Math.round((rows.reduce((sum, row) => sum + row.bookProbability, 0) / rows.length) * 1000) / 1000 : null,
    modelBrier: model.brier, bookBrier: book.brier, modelLogLoss: model.logLoss, bookLogLoss: book.logLoss,
    hold: TD_PROP_HOLD,
  };
}
