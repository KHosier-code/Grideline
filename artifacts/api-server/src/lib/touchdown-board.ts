import type { TouchdownPickRow } from "@workspace/db";
import { lockedAt } from "./game-projections";
import type { PropEvent, TouchdownPropsReport } from "./td-props";

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

/** The featured tier on the TD page, graded on its own. In 2022-2026 testing the top 5 scored 58.5% vs 53.7% for the top 10. */
export const TOP_TIER = 5;

/** Top-10 record (and the top 5 within it) over weeks where every top-10 player has a graded result. */
export function topTenRecord(
  weeks: Array<{ week?: number; board: BoardEntry[]; results: Map<string, boolean>; price?: (entry: BoardEntry) => number | null }>,
) {
  let weeksGraded = 0;
  let topTenPicks = 0;
  let topTenHits = 0;
  let expectedHits = 0;
  const priced = { picks: 0, hits: 0, units: 0 };
  const topFive = { picks: 0, hits: 0, expectedHits: 0, priced: { picks: 0, hits: 0, units: 0 } };
  const byWeek: Array<{ week: number; picks: number; hits: number; expectedHits: number; pricedPicks: number; units: number; topFiveHits: number }> = [];
  for (const { week, board, results, price } of weeks) {
    const top = board.slice(0, 10);
    if (top.length < 10 || top.some((entry) => !results.has(entry.playerId))) continue;
    const hits = top.filter((entry) => results.get(entry.playerId)).length;
    const expected = top.reduce((sum, entry) => sum + entry.probability, 0);
    // 1 unit on each top-10 pick that had a captured DraftKings/FanDuel price.
    let pricedPicks = 0;
    let units = 0;
    top.forEach((entry, index) => {
      const odds = price?.(entry);
      if (typeof odds !== "number" || !Number.isFinite(odds) || odds === 0) return;
      const won = results.get(entry.playerId)!;
      const unit = won ? decimalOdds(odds) - 1 : -1;
      pricedPicks += 1;
      units += unit;
      if (won) priced.hits += 1;
      if (index < TOP_TIER) {
        topFive.priced.picks += 1;
        topFive.priced.units += unit;
        if (won) topFive.priced.hits += 1;
      }
    });
    const tier = top.slice(0, TOP_TIER);
    const tierHits = tier.filter((entry) => results.get(entry.playerId)).length;
    topFive.picks += tier.length;
    topFive.hits += tierHits;
    topFive.expectedHits += tier.reduce((sum, entry) => sum + entry.probability, 0);
    weeksGraded += 1;
    topTenPicks += top.length;
    topTenHits += hits;
    expectedHits += expected;
    priced.picks += pricedPicks;
    priced.units += units;
    if (week !== undefined) {
      byWeek.push({ week, picks: top.length, hits, expectedHits: Math.round(expected * 10) / 10, pricedPicks, units: Math.round(units * 100) / 100, topFiveHits: tierHits });
    }
  }
  return {
    weeksGraded, topTenPicks, topTenHits,
    expectedHits: Math.round(expectedHits * 10) / 10,
    priced: { ...priced, units: Math.round(priced.units * 100) / 100 },
    topFive: {
      picks: topFive.picks, hits: topFive.hits, expectedHits: Math.round(topFive.expectedHits * 10) / 10,
      priced: { ...topFive.priced, units: Math.round(topFive.priced.units * 100) / 100 },
    },
    weeks: byWeek.sort((a, b) => a.week - b.week),
  };
}

/** Total return per 1 staked (stake included) at American odds. */
export function decimalOdds(american: number) {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/** Expected profit per 1 staked when the bet wins with this probability at this price. */
export function expectedValue(probability: number, american: number) {
  return probability * decimalOdds(american) - 1;
}

/**
 * Value 5: the five players, among games not yet started, whose best book
 * price beats our probability by the most. Plus money only (+150 or longer),
 * and at least 5 cents of expected profit per dollar so a rounding-sized
 * edge never makes the list. Untested against past prices: graded live.
 */
export const VALUE_FIVE = { size: 5, minPrice: 150, minEdge: 0.05 } as const;

export function isValueCandidate(probability: number, bookPrice: number | null | undefined) {
  return typeof bookPrice === "number" && Number.isFinite(bookPrice) && bookPrice >= VALUE_FIVE.minPrice
    && expectedValue(probability, bookPrice) >= VALUE_FIVE.minEdge;
}

export type ValuePick = { entry: BoardEntry; price: number; expectedValue: number; selectedAt: Date };

function startsAt(entry: { kickoff: string | null }) {
  const kickoff = entry.kickoff ? new Date(entry.kickoff) : null;
  return kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null;
}

/** The list a bettor could act on at `at`: players whose games start at or after it. */
function valueListAt(board: BoardEntry[], at: Date, price: (entry: BoardEntry) => number | null) {
  return board.flatMap((entry) => {
    const kickoff = startsAt(entry);
    const odds = price(entry);
    if (!kickoff || kickoff < at || !isValueCandidate(entry.probability, odds)) return [];
    return [{ entry, price: odds!, expectedValue: expectedValue(entry.probability, odds!), selectedAt: at }];
  }).sort((a, b) => b.expectedValue - a.expectedValue || b.entry.probability - a.entry.probability).slice(0, VALUE_FIVE.size);
}

/**
 * A week's Value 5 picks. Each player's membership is fixed at his own
 * kickoff from the runs and prices that existed before it, so a pick that
 * lost can never drop off the list later and nothing is chosen with
 * hindsight. Games still to come use the current board and prices.
 * `priceAt(entry, before)` gives the best price captured before that time.
 */
export function valueFive(runs: TouchdownRun[], now: Date, priceAt: (entry: BoardEntry, before: Date) => number | null) {
  const picks = new Map<string, ValuePick>();
  const kickoffs = [...new Set(runs.flatMap((run) => run.picks.map((pick) => startsAt(pick)?.getTime() ?? NaN))
    .filter((time) => Number.isFinite(time) && time <= now.getTime()))].sort((a, b) => a - b);
  for (const time of kickoffs) {
    const at = new Date(time);
    const before = runs.filter((run) => lockedAt(run) < at);
    if (!before.length) continue;
    for (const pick of valueListAt(boardForWeek(before, at), at, (entry) => priceAt(entry, at))) {
      if (startsAt(pick.entry)!.getTime() === time) picks.set(pick.entry.playerId, pick);
    }
  }
  const upcoming = new Date(now.getTime() + 1);
  for (const pick of valueListAt(boardForWeek(runs, now), upcoming, (entry) => priceAt(entry, now))) {
    picks.set(pick.entry.playerId, pick);
  }
  return picks;
}

/**
 * Season record of Value 5 picks, 1 unit on each at the price it was chosen
 * at. Only graded picks count, so a week still being played adds what has finished.
 */
export function valueRecord(weeks: Array<{ week: number; picks: Map<string, ValuePick>; results: Map<string, boolean> }>) {
  let picks = 0;
  let hits = 0;
  let units = 0;
  const byWeek: Array<{ week: number; picks: number; hits: number; units: number }> = [];
  for (const { week, picks: chosen, results } of weeks) {
    const line = { week, picks: 0, hits: 0, units: 0 };
    for (const pick of chosen.values()) {
      if (!results.has(pick.entry.playerId)) continue;
      const scored = results.get(pick.entry.playerId)!;
      line.picks += 1;
      line.hits += scored ? 1 : 0;
      line.units += scored ? decimalOdds(pick.price) - 1 : -1;
    }
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

/**
 * One week's captures as a single report: each game keeps its newest capture.
 * Thursday's capture covers only Thursday night and Saturday's covers Sunday
 * and Monday, so taking only the latest capture would drop Thursday's prices.
 * With `before`, only captures made before that time count.
 */
export function mergePropReports(reports: TouchdownPropsReport[], before?: Date): TouchdownPropsReport | null {
  const usable = reports.filter((report) => !before || new Date(report.capturedAt) < before)
    .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  if (!usable.length) return null;
  const events = new Map<string, PropEvent>();
  for (const report of usable) {
    for (const event of report.events) if (!events.has(event.eventId)) events.set(event.eventId, event);
  }
  return { capturedAt: usable[0].capturedAt, creditsRemaining: usable[0].creditsRemaining, events: [...events.values()] };
}
