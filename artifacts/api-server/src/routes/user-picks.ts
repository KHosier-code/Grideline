import { getAuth } from "@clerk/express";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, userPicksTable } from "@workspace/db";
import { ListMyPicksResponse, RemoveMyPickParams, SaveMyPickBody, SaveMyPickParams, SaveMyPickResponse } from "@workspace/api-zod";
import { consumerGames } from "./consumer";
import {
  gradeUserPick, pickUnits, quoteForPick, userPickRecord, validSide,
  type UserPickMarket, type UserPickSide,
} from "../lib/user-picks";

const router: IRouter = Router();
const MAX_PICKS = 1_000;

type Game = Awaited<ReturnType<typeof consumerGames>>[number];
type Row = typeof userPicksTable.$inferSelect;

function pickUser(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!userId) res.status(401).json({ error: "Sign in to make picks." });
  return userId;
}

/** Picks lock at kickoff, or as soon as the game is under way. */
function started(game: Game, now = Date.now()) {
  const kickoff = game.kickoffTime ? Date.parse(String(game.kickoffTime)) : NaN;
  return !(game.gameState === "scheduled" || game.gameState === "pregame") || !Number.isFinite(kickoff) || kickoff <= now;
}

function present(row: Row, game: Game) {
  const market = row.market as UserPickMarket;
  const side = row.side as UserPickSide;
  const final = game.finalScore ?? null;
  const result = gradeUserPick({ market, side, line: row.line }, final);
  return {
    gameId: row.gameId, season: game.season, week: game.week,
    kickoffTime: game.kickoffTime ? new Date(game.kickoffTime).toISOString() : null,
    home: game.matchup.home, away: game.matchup.away,
    market, side, line: row.line, price: row.price, sportsbook: row.sportsbook,
    result, units: pickUnits(result, market, row.price), finalScore: final,
    locked: started(game), updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/consumer/my-picks", async (req, res): Promise<void> => {
  const userId = pickUser(req, res);
  if (!userId) return;
  try {
    const rows = await db.select().from(userPicksTable)
      .where(eq(userPicksTable.userId, userId)).orderBy(desc(userPicksTable.createdAt));
    const ids = [...new Set(rows.map((row) => row.gameId))];
    const games = ids.length ? await consumerGames({ gameIds: ids }) : [];
    const byId = new Map(games.map((game) => [game.gameId, game]));
    const picks = rows.flatMap((row) => {
      const game = byId.get(row.gameId);
      return game ? [present(row, game)] : [];
    }).sort((a, b) => (Date.parse(b.kickoffTime ?? "") || 0) - (Date.parse(a.kickoffTime ?? "") || 0)
      || a.gameId.localeCompare(b.gameId) || a.market.localeCompare(b.market));
    res.set("Cache-Control", "private, no-store");
    res.json(ListMyPicksResponse.parse({ picks, record: userPickRecord(picks) }));
  } catch (error) {
    req.log.error({ error }, "My picks read failed");
    res.status(503).json({ error: "Your picks are temporarily unavailable.", code: "consumer_data_unavailable" });
  }
});

router.put("/consumer/my-picks/:gameId/:market", async (req, res): Promise<void> => {
  const userId = pickUser(req, res);
  if (!userId) return;
  const params = SaveMyPickParams.safeParse(req.params);
  const body = SaveMyPickBody.safeParse(req.body);
  if (!params.success || !body.success || params.data.gameId.length > 256
    || !validSide(params.data.market, body.data.side)) {
    res.status(400).json({ error: "Choose a valid game, market and side.", code: "invalid_request" });
    return;
  }
  const { gameId, market } = params.data;
  const side = body.data.side as UserPickSide;
  try {
    const [game] = await consumerGames({ gameId });
    if (!game) {
      res.status(404).json({ error: "This game is not available.", code: "game_not_found" });
      return;
    }
    if (started(game)) {
      res.status(409).json({ error: "This game has started, so picks are locked.", code: "pick_locked" });
      return;
    }
    const quote = quoteForPick(game.market, market, side);
    if (!quote) {
      res.status(409).json({ error: "The sportsbook line for this pick isn't posted yet.", code: "line_unavailable" });
      return;
    }
    const tooMany = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`picks:${userId}`}))`);
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(userPicksTable).where(eq(userPicksTable.userId, userId));
      const [existing] = await tx.select({ gameId: userPicksTable.gameId }).from(userPicksTable).where(and(
        eq(userPicksTable.userId, userId), eq(userPicksTable.gameId, gameId), eq(userPicksTable.market, market)));
      if (!existing && total >= MAX_PICKS) return true;
      const values = { side, line: quote.line, price: quote.price, sportsbook: quote.sportsbook, updatedAt: new Date() };
      await tx.insert(userPicksTable).values({ userId, gameId, market, ...values })
        .onConflictDoUpdate({ target: [userPicksTable.userId, userPicksTable.gameId, userPicksTable.market], set: values });
      return false;
    });
    if (tooMany) {
      res.status(409).json({ error: `You can keep up to ${MAX_PICKS} picks.`, code: "pick_limit" });
      return;
    }
    const [row] = await db.select().from(userPicksTable).where(and(
      eq(userPicksTable.userId, userId), eq(userPicksTable.gameId, gameId), eq(userPicksTable.market, market)));
    res.set("Cache-Control", "private, no-store");
    res.json(SaveMyPickResponse.parse(present(row, game)));
  } catch (error) {
    req.log.error({ error }, "Saving a pick failed");
    res.status(503).json({ error: "Your pick wasn't saved. Try again in a moment.", code: "consumer_data_unavailable" });
  }
});

router.delete("/consumer/my-picks/:gameId/:market", async (req, res): Promise<void> => {
  const userId = pickUser(req, res);
  if (!userId) return;
  const params = RemoveMyPickParams.safeParse(req.params);
  if (!params.success || params.data.gameId.length > 256) {
    res.status(400).json({ error: "Choose a valid game and market.", code: "invalid_request" });
    return;
  }
  const { gameId, market } = params.data;
  try {
    const [game] = await consumerGames({ gameId });
    if (game && started(game)) {
      res.status(409).json({ error: "This game has started, so picks are locked.", code: "pick_locked" });
      return;
    }
    await db.delete(userPicksTable).where(and(
      eq(userPicksTable.userId, userId), eq(userPicksTable.gameId, gameId), eq(userPicksTable.market, market)));
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ error }, "Removing a pick failed");
    res.status(503).json({ error: "Your pick wasn't removed. Try again in a moment.", code: "consumer_data_unavailable" });
  }
});

export default router;
