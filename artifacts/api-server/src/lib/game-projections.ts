import type { GameProjectionRow } from "@workspace/db";
import { addResult, emptyRecordLine, type RecordLine } from "./pick-grading";

/**
 * `receivedAt` is when the site stored the run (server clock). `generatedAt` is
 * the time the workflow says it ran, so it can't be trusted on its own.
 */
export type ProjectionRun = { generatedAt: Date; receivedAt?: Date; games: GameProjectionRow[] };
export type ProjectionEntry = GameProjectionRow & { generatedAt: Date; lockedAt: Date };

/**
 * When a run was locked in: the later of when it says it was made and when the
 * site received it. A run only counts for games that kick off after this, so a
 * projection can't be sent (or backdated) after a game starts and still be graded.
 */
export function lockedAt(run: { generatedAt: Date; receivedAt?: Date | null }) {
  return run.receivedAt && run.receivedAt > run.generatedAt ? run.receivedAt : run.generatedAt;
}

const kickoffDate = (kickoff: string | null | undefined) => {
  const date = kickoff ? new Date(kickoff) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Latest projection per game locked in before its kickoff. */
export function projectionsBeforeKickoff(runs: ProjectionRun[]): Map<string, ProjectionEntry> {
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const byGame = new Map<string, ProjectionEntry>();
  for (const run of ordered) {
    const locked = lockedAt(run);
    for (const game of run.games) {
      const kickoff = kickoffDate(game.kickoff);
      if (kickoff && locked >= kickoff) continue;
      byGame.set(game.gameId, { ...game, generatedAt: run.generatedAt, lockedAt: locked });
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
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const games: LineValueGame[] = [];
  for (const [gameId, quotes] of quotesByGame) {
    const projections = ordered.flatMap((run) => run.games
      .filter((game) => game.gameId === gameId)
      .map((game) => ({ ...game, generatedAt: lockedAt(run) })));
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

/**
 * The opener-gap signal from research/algo-sweep: when Gridline's line is 4+
 * points off the opening spread, its side covered 58.8% at the opener over
 * 2021-2026 (53.7% at the close). Shown as a watch list, not picks, until the
 * live record backs it up.
 */
export const WATCH_GAP = 4;

export type WatchGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  sportsbook: string;
  /** Gridline's expected home margin in its first projection locked before kickoff. */
  gridlineMargin: number;
  lockedAt: Date;
  openLine: number;
  openedAt: Date;
  /** The book's line when that projection went up: the bettable number when we flagged it. */
  publishedLine: number;
  /** Latest line before kickoff (the closing line once the game has started). */
  currentLine: number;
  currentAt: Date;
  started: boolean;
  /** Gridline's margin minus the opener's (positive = Gridline likes home more). */
  gap: number;
  side: "home" | "away";
  /** Points the line has moved toward Gridline's side since the opener. */
  movedToward: number;
  atsOpen: "win" | "loss" | "push" | null;
  atsPublished: "win" | "loss" | "push" | null;
  atsClose: "win" | "loss" | "push" | null;
};

const bookQuotes = (quotes: SpreadQuote[], sportsbook: string, before: Date) => quotes
  .filter((quote) => quote.sportsbook === sportsbook && quote.capturedAt < before && Number.isFinite(quote.homeLine))
  .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

/** Games where Gridline's first pregame line is WATCH_GAP+ points off the opener (DraftKings, else FanDuel). */
export function openerWatch(
  runs: ProjectionRun[],
  quotesByGame: Map<string, SpreadQuote[]>,
  finals: Map<string, { home: number; away: number; week: number }>,
  now: Date,
): WatchGame[] {
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const firstProjection = new Map<string, { game: GameProjectionRow; lockedAt: Date }>();
  for (const run of ordered) {
    const locked = lockedAt(run);
    for (const game of run.games) {
      const kickoff = kickoffDate(game.kickoff);
      if (!kickoff || locked >= kickoff || firstProjection.has(game.gameId)) continue;
      firstProjection.set(game.gameId, { game, lockedAt: locked });
    }
  }
  const watch: WatchGame[] = [];
  for (const [gameId, { game, lockedAt: locked }] of firstProjection) {
    const kickoff = kickoffDate(game.kickoff)!;
    const quotes = quotesByGame.get(gameId) ?? [];
    for (const sportsbook of ["DraftKings", "FanDuel"]) {
      const book = bookQuotes(quotes, sportsbook, kickoff);
      if (!book.length) continue;
      const open = book[0];
      const gap = game.projectedMargin + open.homeLine;
      if (Math.abs(gap) < WATCH_GAP) break;
      const side = gap > 0 ? "home" as const : "away" as const;
      const published = book.filter((quote) => quote.capturedAt <= locked).at(-1) ?? open;
      const current = book.at(-1)!;
      const final = finals.get(gameId);
      const homeMove = open.homeLine - current.homeLine;
      watch.push({
        gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoff: kickoff.toISOString(),
        sportsbook, gridlineMargin: game.projectedMargin, lockedAt: locked,
        openLine: open.homeLine, openedAt: open.capturedAt, publishedLine: published.homeLine,
        currentLine: current.homeLine, currentAt: current.capturedAt, started: now >= kickoff,
        gap: Math.round(gap * 10) / 10, side, movedToward: side === "home" ? homeMove : -homeMove,
        atsOpen: final ? coverResult(side, open.homeLine, final) : null,
        atsPublished: final ? coverResult(side, published.homeLine, final) : null,
        atsClose: final ? coverResult(side, current.homeLine, final) : null,
      });
      break;
    }
  }
  return watch.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime() || Math.abs(b.gap) - Math.abs(a.gap));
}

export function openerWatchSummary(games: WatchGame[]) {
  const line = () => emptyRecordLine();
  const atsOpen = line(); const atsPublished = line(); const atsClose = line();
  for (const game of games) {
    if (game.atsOpen) addResult(atsOpen, game.atsOpen);
    if (game.atsPublished) addResult(atsPublished, game.atsPublished);
    if (game.atsClose) addResult(atsClose, game.atsClose);
  }
  const moved = games.filter((game) => game.started);
  return {
    threshold: WATCH_GAP,
    flagged: games.length,
    graded: games.filter((game) => game.atsOpen !== null).length,
    movedToward: moved.filter((game) => game.movedToward > 0).length,
    movedAway: moved.filter((game) => game.movedToward < 0).length,
    atsOpen, atsPublished, atsClose,
  };
}

export type WatchAlert = {
  kind: "flagged" | "moved-toward" | "moved-away";
  gameId: string;
  at: Date;
  /** Plain-language line for a notification, e.g. "Gridline has KC by 7.5; the opener is KC -3 at DraftKings." */
  message: string;
};

const homeLineText = (homeLine: number, home: string, away: string) => lineText(-homeLine, home, away);

function lineText(margin: number, home: string, away: string) {
  const rounded = Math.round(Math.abs(margin) * 2) / 2;
  if (rounded === 0) return "pick'em";
  return `${margin > 0 ? home : away} -${rounded}`;
}

/**
 * Alerts for watch-list games since `since`: a game newly flagged (its opener
 * or our projection arrived), or its line moving a point or more since the
 * previous capture. Feeds the Sunday-night notification and the RSS feed.
 */
export function watchAlerts(watch: WatchGame[], quotesByGame: Map<string, SpreadQuote[]>, since: Date): WatchAlert[] {
  const alerts: WatchAlert[] = [];
  for (const game of watch) {
    if (game.started) continue;
    const { homeTeam: home, awayTeam: away } = game;
    const flaggedAt = game.openedAt > game.lockedAt ? game.openedAt : game.lockedAt;
    const ours = lineText(game.gridlineMargin, home, away);
    if (flaggedAt >= since) {
      alerts.push({ kind: "flagged", gameId: game.gameId, at: flaggedAt,
        message: `${away} at ${home}: Gridline has ${ours}, the opener is ${homeLineText(game.openLine, home, away)} at ${game.sportsbook} (${Math.abs(game.gap).toFixed(1)} pts apart). Now ${homeLineText(game.currentLine, home, away)}.` });
    }
    const book = bookQuotes(quotesByGame.get(game.gameId) ?? [], game.sportsbook, new Date(game.kickoff));
    const latest = book.at(-1);
    const previous = book.at(-2);
    if (!latest || !previous || latest.capturedAt < since || latest.capturedAt <= flaggedAt) continue;
    const homeMove = previous.homeLine - latest.homeLine;
    const toward = game.side === "home" ? homeMove : -homeMove;
    if (Math.abs(toward) < 1) continue;
    alerts.push({ kind: toward > 0 ? "moved-toward" : "moved-away", gameId: game.gameId, at: latest.capturedAt,
      message: `${away} at ${home}: the line moved ${toward > 0 ? "toward" : "away from"} Gridline (${ours}), from ${homeLineText(previous.homeLine, home, away)} to ${homeLineText(latest.homeLine, home, away)} at ${game.sportsbook}.` });
  }
  return alerts.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Locked spread picks: one per game, at a number a reader could have bet.
 *
 * Sunday and Monday games lock Saturday at 16:00 UTC (noon ET in daylight
 * time), after Friday's final injury report, Saturday morning's line capture
 * and the Saturday model run. Earlier games (Thursday, Friday, Saturday) lock
 * six hours before kickoff. At the lock we take our latest projection and the
 * best DraftKings or FanDuel spread for each side; a gap of LOCK_PLAY points
 * or more is a play, LOCK_LEAN or more a lean, anything smaller no pick.
 * Graded at the locked number, plus closing line value: whether the line
 * moved toward our side by kickoff.
 */
export const LOCK_LEAN = 1.5;
export const LOCK_PLAY = 4;
const LOCK_SATURDAY_UTC_HOUR = 16;
const EARLY_LOCK_HOURS = 6;
const PICK_BOOKS = ["DraftKings", "FanDuel"];
/** Locked picks began with 2026 week 5's Sunday games; earlier games were never locked, so they don't count. */
export const LOCKS_START = new Date("2026-10-10T00:00:00Z");
/**
 * Spread picks went 1-7 in week 5, and the 2021-2025 walk-forward test shows
 * our gap to the closing line doesn't predict covers (about 52-53%, under the
 * 52.4% break-even). Paused from week 6 until a rule passes a backtest at
 * bettable prices; week 5's locked picks stay on the record.
 */
export const LOCKS_PAUSED_FROM = new Date("2026-10-13T12:00:00Z");

export type SpreadLock = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  /** When the pick locks (or locked). */
  locksAt: Date;
  /** True once locksAt has passed: the pick is final. Before that it's the current lean. */
  locked: boolean;
  tier: "play" | "lean" | null;
  side: "home" | "away" | null;
  /** The picked team's spread, e.g. 7 for "+7" or -3.5. */
  line: number | null;
  sportsbook: string | null;
  /** Our expected home margin used for the pick. */
  gridlineMargin: number;
  /** Points our number is past the book's on the picked side. */
  gap: number;
  /** The picked team's closing spread at the same book, once the game starts. */
  closeLine: number | null;
  /** Points of closing line value: positive when the line moved our way. */
  clv: number | null;
  result: "win" | "loss" | "push" | null;
};

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });

/** The lock time for a game kicking off at `kickoff`. */
export function lockTime(kickoff: Date) {
  const parts = Object.fromEntries(ET_DATE.formatToParts(kickoff).map((part) => [part.type, part.value]));
  const early = new Date(kickoff.getTime() - EARLY_LOCK_HOURS * 3_600_000);
  const back = parts.weekday === "Sun" ? 1 : parts.weekday === "Mon" ? 2 : null;
  if (back === null) return early;
  // Saturday of the same Eastern-time weekend, at the lock hour in UTC.
  const saturday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back, LOCK_SATURDAY_UTC_HOUR));
  return saturday < early ? saturday : early;
}

export function spreadLocks(
  runs: ProjectionRun[],
  quotesByGame: Map<string, SpreadQuote[]>,
  finals: Map<string, { home: number; away: number; week: number }>,
  now: Date,
): SpreadLock[] {
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const games = new Map<string, GameProjectionRow>();
  for (const run of ordered) for (const game of run.games) games.set(game.gameId, game);
  const locks: SpreadLock[] = [];
  for (const [gameId, latestGame] of games) {
    const kickoff = kickoffDate(latestGame.kickoff);
    if (!kickoff || kickoff < LOCKS_START || kickoff >= LOCKS_PAUSED_FROM) continue;
    const locksAt = lockTime(kickoff);
    const locked = now >= locksAt;
    const asOf = locked ? locksAt : now;
    // The newest projection the site had received by the lock (or by now, before it).
    let projection: GameProjectionRow | null = null;
    for (const run of ordered) {
      if (lockedAt(run) > asOf || lockedAt(run) >= kickoff) break;
      projection = run.games.find((game) => game.gameId === gameId) ?? projection;
    }
    if (!projection) continue;
    const quotes = quotesByGame.get(gameId) ?? [];
    const atLock = PICK_BOOKS.flatMap((sportsbook) => {
      const quote = bookQuotes(quotes, sportsbook, kickoff).filter((item) => item.capturedAt <= asOf).at(-1);
      return quote ? [quote] : [];
    });
    const base = {
      gameId, homeTeam: projection.homeTeam, awayTeam: projection.awayTeam, kickoff: kickoff.toISOString(),
      locksAt, locked, gridlineMargin: projection.projectedMargin,
    };
    const none = { ...base, tier: null, side: null, line: null, sportsbook: null, gap: 0, closeLine: null, clv: null, result: null };
    if (!atLock.length) { locks.push(none); continue; }
    // Best number for each side: the home team wants the highest home line, the away team the lowest.
    const bestHome = atLock.reduce((best, quote) => (quote.homeLine > best.homeLine ? quote : best));
    const bestAway = atLock.reduce((best, quote) => (quote.homeLine < best.homeLine ? quote : best));
    const homeGap = projection.projectedMargin + bestHome.homeLine;
    const awayGap = -(projection.projectedMargin + bestAway.homeLine);
    const side = homeGap >= awayGap ? "home" as const : "away" as const;
    const gap = Math.round(Math.max(homeGap, awayGap) * 10) / 10;
    if (gap < LOCK_LEAN) { locks.push({ ...none, gap }); continue; }
    const quote = side === "home" ? bestHome : bestAway;
    const close = bookQuotes(quotes, quote.sportsbook, kickoff).at(-1)!;
    const started = now >= kickoff;
    const final = finals.get(gameId);
    const sideLine = (homeLine: number) => (side === "home" ? homeLine : -homeLine);
    locks.push({
      ...base, tier: gap >= LOCK_PLAY ? "play" : "lean", side, line: sideLine(quote.homeLine), sportsbook: quote.sportsbook, gap,
      closeLine: started ? sideLine(close.homeLine) : null,
      // Taking +7 when it closes +6 (or -3 when it closes -4) is a point of value.
      clv: started ? sideLine(quote.homeLine) - sideLine(close.homeLine) : null,
      result: locked && final ? coverResult(side, quote.homeLine, final) : null,
    });
  }
  return locks.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

export function spreadLockSummary(locks: SpreadLock[]) {
  const plays = emptyRecordLine();
  const leans = emptyRecordLine();
  let beatClose = 0; let lostClose = 0; let sameClose = 0;
  for (const lock of locks) {
    if (!lock.locked || !lock.tier) continue;
    if (lock.result) addResult(lock.tier === "play" ? plays : leans, lock.result);
    if (lock.clv === null) continue;
    if (lock.clv > 0) beatClose += 1; else if (lock.clv < 0) lostClose += 1; else sameClose += 1;
  }
  return {
    leanThreshold: LOCK_LEAN, playThreshold: LOCK_PLAY, plays, leans, beatClose, lostClose, sameClose,
    pausedFrom: LOCKS_PAUSED_FROM.toISOString(),
  };
}

/**
 * Early-line picks (testing). The one spread signal that held up in research
 * (research/algo-sweep): our number 4+ points off the line early in the week.
 * Each game's pick comes from our first projection posted on or after the
 * Monday 12:00 UTC (8 AM ET) before kickoff, against the DraftKings or
 * FanDuel spread captured closest to that post (within EARLY_QUOTE_WINDOW),
 * so it's a number a reader could bet. Graded there, with closing line value.
 * Stop rule, set before any results: if the first EARLY_STOP_AFTER graded
 * picks win under EARLY_STOP_RATE, no new picks are made.
 */
export const EARLY_GAP = 4;
export const EARLY_START = new Date("2026-10-19T12:00:00Z");
export const EARLY_STOP_AFTER = 30;
export const EARLY_STOP_RATE = 0.5;
const EARLY_QUOTE_BEFORE_MS = 3 * 3_600_000;
const EARLY_QUOTE_AFTER_MS = 6 * 3_600_000;
/** Days back from the kickoff's Eastern date to the Monday that opens its NFL week. */
const DAYS_TO_WEEK_MONDAY: Record<string, number> = { Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6, Mon: 7 };

/** 12:00 UTC on the Monday that starts the game's week (the Monday after the previous week's Sunday games). */
export function earlyWindowOpens(kickoff: Date) {
  const parts = Object.fromEntries(ET_DATE.formatToParts(kickoff).map((part) => [part.type, part.value]));
  const back = DAYS_TO_WEEK_MONDAY[parts.weekday] ?? 7;
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - back, 12));
}

export type EarlyPick = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  /** When our projection went up (the pick time). */
  postedAt: Date;
  side: "home" | "away";
  /** The picked team's spread at posting, e.g. 7 for "+7". */
  line: number;
  sportsbook: string;
  quotedAt: Date;
  gridlineMargin: number;
  gap: number;
  /** Latest spread for the picked team at the same book (the close once started). */
  currentLine: number;
  /** Whether the latest line is still EARLY_GAP+ points off our posted number. */
  stillPick: boolean;
  started: boolean;
  clv: number | null;
  result: "win" | "loss" | "push" | null;
};

export function earlyLinePicks(
  runs: ProjectionRun[],
  quotesByGame: Map<string, SpreadQuote[]>,
  finals: Map<string, { home: number; away: number; week: number }>,
  now: Date,
): EarlyPick[] {
  const ordered = [...runs].sort((a, b) => lockedAt(a).getTime() - lockedAt(b).getTime());
  const first = new Map<string, { game: GameProjectionRow; postedAt: Date }>();
  for (const run of ordered) {
    const posted = lockedAt(run);
    for (const game of run.games) {
      const kickoff = kickoffDate(game.kickoff);
      if (!kickoff || kickoff < EARLY_START || first.has(game.gameId)) continue;
      if (posted < earlyWindowOpens(kickoff) || posted >= kickoff) continue;
      first.set(game.gameId, { game, postedAt: posted });
    }
  }
  const picks: EarlyPick[] = [];
  for (const [gameId, { game, postedAt }] of first) {
    const kickoff = kickoffDate(game.kickoff)!;
    const quotes = quotesByGame.get(gameId) ?? [];
    // Each book's quote closest to the post, within the window.
    const near = PICK_BOOKS.flatMap((sportsbook) => {
      const inWindow = bookQuotes(quotes, sportsbook, kickoff).filter((quote) => {
        const offset = quote.capturedAt.getTime() - postedAt.getTime();
        return offset >= -EARLY_QUOTE_BEFORE_MS && offset <= EARLY_QUOTE_AFTER_MS;
      });
      const best = inWindow.sort((a, b) => Math.abs(a.capturedAt.getTime() - postedAt.getTime()) - Math.abs(b.capturedAt.getTime() - postedAt.getTime()))[0];
      return best ? [best] : [];
    });
    if (!near.length) continue;
    const bestHome = near.reduce((best, quote) => (quote.homeLine > best.homeLine ? quote : best));
    const bestAway = near.reduce((best, quote) => (quote.homeLine < best.homeLine ? quote : best));
    const homeGap = game.projectedMargin + bestHome.homeLine;
    const awayGap = -(game.projectedMargin + bestAway.homeLine);
    const side = homeGap >= awayGap ? "home" as const : "away" as const;
    const gap = Math.round(Math.max(homeGap, awayGap) * 10) / 10;
    if (gap < EARLY_GAP) continue;
    const quote = side === "home" ? bestHome : bestAway;
    const sideLine = (homeLine: number) => (side === "home" ? homeLine : -homeLine);
    const latest = bookQuotes(quotes, quote.sportsbook, kickoff).at(-1) ?? quote;
    const started = now >= kickoff;
    const final = finals.get(gameId);
    const ourSideLine = side === "home" ? -game.projectedMargin : game.projectedMargin;
    picks.push({
      gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoff: kickoff.toISOString(), postedAt,
      side, line: sideLine(quote.homeLine), sportsbook: quote.sportsbook, quotedAt: quote.capturedAt,
      gridlineMargin: game.projectedMargin, gap,
      currentLine: sideLine(latest.homeLine),
      stillPick: !started && sideLine(latest.homeLine) - ourSideLine >= EARLY_GAP,
      started,
      clv: started ? sideLine(quote.homeLine) - sideLine(latest.homeLine) : null,
      result: final ? coverResult(side, quote.homeLine, final) : null,
    });
  }
  picks.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const stoppedAt = earlyStopTime(picks);
  return stoppedAt ? picks.filter((pick) => pick.postedAt <= stoppedAt) : picks;
}

/** Kickoff of the EARLY_STOP_AFTER-th graded pick if the picks up to it won under EARLY_STOP_RATE, else null. */
export function earlyStopTime(picks: EarlyPick[]) {
  let graded = 0; let wins = 0; let losses = 0;
  for (const pick of [...picks].sort((a, b) => a.kickoff.localeCompare(b.kickoff))) {
    if (!pick.result) continue;
    graded += 1;
    if (pick.result === "win") wins += 1; else if (pick.result === "loss") losses += 1;
    if (graded === EARLY_STOP_AFTER) {
      return wins + losses > 0 && wins / (wins + losses) < EARLY_STOP_RATE ? new Date(pick.kickoff) : null;
    }
  }
  return null;
}

export function earlyLineSummary(picks: EarlyPick[]) {
  const record = emptyRecordLine();
  let beatClose = 0; let lostClose = 0; let sameClose = 0;
  for (const pick of picks) {
    if (pick.result) addResult(record, pick.result);
    if (pick.clv === null) continue;
    if (pick.clv > 0) beatClose += 1; else if (pick.clv < 0) lostClose += 1; else sameClose += 1;
  }
  return {
    gap: EARLY_GAP, start: EARLY_START.toISOString(), stopAfter: EARLY_STOP_AFTER, stopRate: EARLY_STOP_RATE,
    stopped: earlyStopTime(picks) !== null,
    record, beatClose, lostClose, sameClose,
  };
}
