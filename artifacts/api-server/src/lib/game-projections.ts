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
