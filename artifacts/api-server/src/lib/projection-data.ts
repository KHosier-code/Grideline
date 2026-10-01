import { and, asc, eq, inArray } from "drizzle-orm";
import { db, gameProjectionRunsTable, gamesTable, sportsbookOddsTable, teamsTable } from "@workspace/db";
import type { SpreadQuote } from "./game-projections";

const isFinal = (status: string | null) => /final|completed/i.test(status ?? "");
const squash = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a sportsbook selection ("Kansas City Chiefs") names this team. */
export function spreadSide(selection: string, team: { teamName: string; abbreviation: string } | undefined) {
  if (!team) return false;
  const value = squash(selection);
  return value === squash(team.teamName) || value === squash(team.abbreviation);
}

export type BookQuote = { point: number | null; price: number };
/** One sportsbook's latest lines for a game, from the home team's side for spreads. */
export type BookLines = {
  sportsbook: string;
  capturedAt: string;
  homeSpread: BookQuote | null;
  awaySpread: BookQuote | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  over: BookQuote | null;
  under: BookQuote | null;
};

type OddsRow = { gameId: string; sportsbook: string; market: string; selection: string; point: number | null; price: number; capturedAt: Date };
type Sides = { home?: { teamName: string; abbreviation: string }; away?: { teamName: string; abbreviation: string } };

/** Latest quote per book, market and side, laid out per book (DraftKings first). */
export function latestBookLines(rows: OddsRow[], sides: Sides): BookLines[] {
  const latest = new Map<string, OddsRow>();
  for (const row of rows) {
    const key = `${row.sportsbook}|${row.market}|${row.selection}`;
    const current = latest.get(key);
    if (!current || row.capturedAt >= current.capturedAt) latest.set(key, row);
  }
  const books = new Map<string, BookLines>();
  for (const row of latest.values()) {
    const book = books.get(row.sportsbook) ?? {
      sportsbook: row.sportsbook, capturedAt: row.capturedAt.toISOString(),
      homeSpread: null, awaySpread: null, homeMoneyline: null, awayMoneyline: null, over: null, under: null,
    };
    if (row.capturedAt.toISOString() > book.capturedAt) book.capturedAt = row.capturedAt.toISOString();
    const isHome = spreadSide(row.selection, sides.home);
    const isAway = spreadSide(row.selection, sides.away);
    const selection = squash(row.selection);
    if (row.market === "spread" && (isHome || isAway)) book[isHome ? "homeSpread" : "awaySpread"] = { point: row.point, price: row.price };
    else if (row.market === "moneyline" && (isHome || isAway)) book[isHome ? "homeMoneyline" : "awayMoneyline"] = row.price;
    else if (row.market === "total" && (selection.startsWith("over") || selection.startsWith("under"))) {
      book[selection.startsWith("over") ? "over" : "under"] = { point: row.point, price: row.price };
    }
    books.set(row.sportsbook, book);
  }
  const order = (name: string) => (name === "DraftKings" ? 0 : name === "FanDuel" ? 1 : 2);
  return [...books.values()].sort((a, b) => order(a.sportsbook) - order(b.sportsbook) || a.sportsbook.localeCompare(b.sportsbook));
}

/**
 * Everything the projection pages grade against for one season: the model
 * runs (with the server's receive time), final scores, every saved spread
 * quote as the home line, and each book's latest lines.
 */
export async function loadSeasonProjectionData(season: number) {
  const runs = await db.select().from(gameProjectionRunsTable)
    .where(eq(gameProjectionRunsTable.season, season)).orderBy(asc(gameProjectionRunsTable.generatedAt));
  const ids = new Set(runs.flatMap((run) => run.games.map((game) => game.gameId)));
  const finals = new Map<string, { home: number; away: number; week: number }>();
  const quotesByGame = new Map<string, SpreadQuote[]>();
  const booksByGame = new Map<string, BookLines[]>();
  if (ids.size) {
    const rows = await db.select().from(gamesTable).where(eq(gamesTable.season, season));
    for (const row of rows) {
      if (ids.has(row.gameId) && isFinal(row.gameStatus) && row.finalHomeScore !== null && row.finalAwayScore !== null) {
        finals.set(row.gameId, { home: row.finalHomeScore, away: row.finalAwayScore, week: row.week });
      }
    }
    const teams = new Map((await db.select().from(teamsTable)).map((team) => [team.teamId, team]));
    const sides = new Map<string, Sides>(rows.filter((row) => ids.has(row.gameId)).map((row) => [row.gameId, {
      home: teams.get(row.homeTeamId), away: teams.get(row.awayTeamId),
    }]));
    const odds = sides.size ? await db.select({
      gameId: sportsbookOddsTable.gameId, sportsbook: sportsbookOddsTable.sportsbook, market: sportsbookOddsTable.market,
      selection: sportsbookOddsTable.selection, point: sportsbookOddsTable.point, price: sportsbookOddsTable.price,
      capturedAt: sportsbookOddsTable.capturedAt,
    }).from(sportsbookOddsTable)
      .where(and(inArray(sportsbookOddsTable.market, ["spread", "moneyline", "total"]), inArray(sportsbookOddsTable.gameId, [...sides.keys()]))) : [];
    const oddsByGame = new Map<string, OddsRow[]>();
    for (const row of odds) {
      const side = sides.get(row.gameId);
      if (!side) continue;
      const list = oddsByGame.get(row.gameId) ?? [];
      list.push(row);
      oddsByGame.set(row.gameId, list);
      if (row.market !== "spread" || row.point === null) continue;
      const homeLine = spreadSide(row.selection, side.home) ? row.point : spreadSide(row.selection, side.away) ? -row.point : null;
      if (homeLine === null) continue;
      const quotes = quotesByGame.get(row.gameId) ?? [];
      quotes.push({ sportsbook: row.sportsbook, capturedAt: row.capturedAt, homeLine });
      quotesByGame.set(row.gameId, quotes);
    }
    for (const [gameId, list] of oddsByGame) booksByGame.set(gameId, latestBookLines(list, sides.get(gameId) ?? {}));
  }
  return { runs, finals, quotesByGame, booksByGame };
}
