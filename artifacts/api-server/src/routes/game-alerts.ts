import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  db, gameAlertsTable, gamesTable, sportsbookOddsTable,
  type GameAlertEvidence,
} from "@workspace/db";
import { GetConsumerGameAlertsResponse, EnableConsumerGameAlertsResponse } from "@workspace/api-zod";
import { getLatestValidPredictionSnapshots } from "../lib/live-predictions";
import { getCurrentGamePersonnel } from "../lib/current-personnel";
import type { InterpretedTeamDepth } from "../lib/current-personnel-derivation";
import { advanceGameAlertEvidence, detectGameAlerts, sameGameAlertEvidence } from "../lib/game-alert-detection";

function gameIdFrom(value: string | string[] | undefined) {
  const gameId = Array.isArray(value) ? value[0] : value;
  return gameId && gameId.length <= 128 ? gameId : null;
}

export function verifiedQbAlertIdentity(team: Pick<InterpretedTeamDepth, "freshness" | "qbStarter"> | null): string | null {
  return team?.freshness === "current" && team.qbStarter.status === "available"
    ? team.qbStarter.player?.playerId ?? null : null;
}

async function persistedEvidence(game: typeof gamesTable.$inferSelect, cutoff: Date): Promise<GameAlertEvidence> {
  const [snapshots, personnel, quotes] = await Promise.all([
    getLatestValidPredictionSnapshots([game.gameId], { preKickoffOnly: true, authoritativeGameKickoff: true, cutoffAt: cutoff }),
    getCurrentGamePersonnel(game.gameId, cutoff),
    db.select({
      sportsbook: sportsbookOddsTable.sportsbook, market: sportsbookOddsTable.market,
      selection: sportsbookOddsTable.selection, point: sportsbookOddsTable.point,
      price: sportsbookOddsTable.price,
    }).from(sportsbookOddsTable).where(and(
      eq(sportsbookOddsTable.gameId, game.gameId),
      inArray(sportsbookOddsTable.sportsbook, ["DraftKings", "FanDuel"]),
      inArray(sportsbookOddsTable.market, ["spread", "total", "moneyline"]),
      lte(sportsbookOddsTable.capturedAt, cutoff),
    )).orderBy(desc(sportsbookOddsTable.capturedAt), desc(sportsbookOddsTable.id)).limit(300),
  ]);
  const snapshot = snapshots.get(game.gameId);
  const roles: Record<string, string> = {};
  for (const side of ["home", "away"] as const) {
    const team = personnel?.teams[side];
    if (!team || team.freshness !== "current") continue;
    // An unverified or conflicted starter is absent evidence, not a changed starter.
    const qbId = verifiedQbAlertIdentity(team);
    if (qbId) roles[`${side}:qb`] = qbId;
    for (const player of team.injuryReport) {
      if (player.playerName && player.gameStatus) roles[`${side}:injury:${player.playerName}`] = player.gameStatus;
    }
  }
  const market: NonNullable<GameAlertEvidence["market"]> = {};
  for (const quote of quotes) {
    const key = `${quote.sportsbook}:${quote.market}:${quote.selection}`;
    if (!market[key]) market[key] = { point: quote.point, price: quote.price };
  }
  return {
    projection: snapshot && snapshot.projectedMargin !== null && snapshot.projectedTotal !== null && snapshot.homeWinProbability !== null
      ? { margin: snapshot.projectedMargin, total: snapshot.projectedTotal, homeWinProbability: snapshot.homeWinProbability } : null,
    personnel: Object.keys(roles).length ? roles : null,
    market: Object.keys(market).length ? market : null,
  };
}

type AlertDependencies = {
  userId?: (req: Request) => string | null;
  readEvidence?: typeof persistedEvidence;
  now?: () => Date;
};

export function createGameAlertsRouter(deps: AlertDependencies = {}): IRouter {
const router: IRouter = Router();
const userIdFor = (req: Request) => deps.userId ? deps.userId(req) : getAuth(req).userId;
const evidenceFor = deps.readEvidence ?? persistedEvidence;
const nowFor = deps.now ?? (() => new Date());
const cutoffFor = (game: typeof gamesTable.$inferSelect, now: Date) =>
  new Date(Math.min(now.getTime(), (game.kickoffTime?.getTime() ?? now.getTime()) - 1));

router.get("/consumer/games/:gameId/alerts", async (req, res): Promise<void> => {
  const userId = userIdFor(req);
  if (!userId) { res.status(401).json({ error: "Sign in to view matchup alerts." }); return; }
  const gameId = gameIdFrom(req.params.gameId);
  if (!gameId) { res.status(400).json({ error: "Invalid game ID." }); return; }
  try {
    const [subscription] = await db.select().from(gameAlertsTable)
      .where(and(eq(gameAlertsTable.userId, userId), eq(gameAlertsTable.gameId, gameId))).limit(1);
    if (!subscription) {
      res.set("Cache-Control", "private, no-store");
      res.json(GetConsumerGameAlertsResponse.parse({ enabled: false, events: [] }));
      return;
    }
    const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
    const now = nowFor();
    // Reconcile even after kickoff, but only using evidence recorded before kickoff.
    const current = game?.kickoffTime
      ? await evidenceFor(game, cutoffFor(game, now)) : null;
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(gameAlertsTable)
        .where(and(eq(gameAlertsTable.userId, userId), eq(gameAlertsTable.gameId, gameId)))
        .for("update").limit(1);
      if (!locked) return { enabled: false, events: [] };
      if (!current) return { enabled: true, events: locked.events };
      const events = detectGameAlerts(locked.baseline, current, now.toISOString());
      const baseline = advanceGameAlertEvidence(locked.baseline, current, events);
      if (events.length || !sameGameAlertEvidence(baseline, locked.baseline)) {
        const all = [...events, ...locked.events].slice(0, 20);
        await tx.update(gameAlertsTable).set({ baseline, events: all })
          .where(and(eq(gameAlertsTable.userId, userId), eq(gameAlertsTable.gameId, gameId)));
        return { enabled: true, events: all };
      }
      return { enabled: true, events: locked.events };
    });
    res.set("Cache-Control", "private, no-store");
    res.json(GetConsumerGameAlertsResponse.parse(result));
  } catch (error) {
    req.log.error({ error }, "Matchup alerts read failed");
    res.status(503).json({ error: "Matchup alerts are temporarily unavailable." });
  }
});

router.put("/consumer/games/:gameId/alerts", async (req, res): Promise<void> => {
  const userId = userIdFor(req);
  if (!userId) { res.status(401).json({ error: "Sign in to enable matchup alerts." }); return; }
  const gameId = gameIdFrom(req.params.gameId);
  if (!gameId) { res.status(400).json({ error: "Invalid game ID." }); return; }
  try {
    const [existing] = await db.select().from(gameAlertsTable)
      .where(and(eq(gameAlertsTable.userId, userId), eq(gameAlertsTable.gameId, gameId))).limit(1);
    if (existing) {
      res.set("Cache-Control", "private, no-store");
      res.json(EnableConsumerGameAlertsResponse.parse({ enabled: true, events: existing.events }));
      return;
    }
    const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, gameId)).limit(1);
    if (!game) { res.status(404).json({ error: "Game not found." }); return; }
    const now = nowFor();
    if (!game.kickoffTime || game.kickoffTime <= now) {
      res.status(400).json({ error: "Alerts are available for upcoming games only." }); return;
    }
    const baseline = await evidenceFor(game, cutoffFor(game, now));
    const [row] = await db.insert(gameAlertsTable).values({ userId, gameId, baseline })
      .onConflictDoNothing().returning();
    res.set("Cache-Control", "private, no-store");
    res.json(EnableConsumerGameAlertsResponse.parse({ enabled: true, events: row?.events ?? [] }));
  } catch (error) {
    req.log.error({ error }, "Matchup alerts enable failed");
    res.status(503).json({ error: "Matchup alerts are temporarily unavailable." });
  }
});

router.delete("/consumer/games/:gameId/alerts", async (req, res): Promise<void> => {
  const userId = userIdFor(req);
  if (!userId) { res.status(401).json({ error: "Sign in to disable matchup alerts." }); return; }
  const gameId = gameIdFrom(req.params.gameId);
  if (!gameId) { res.status(400).json({ error: "Invalid game ID." }); return; }
  try {
    await db.delete(gameAlertsTable).where(and(eq(gameAlertsTable.userId, userId), eq(gameAlertsTable.gameId, gameId)));
    res.set("Cache-Control", "private, no-store");
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ error }, "Matchup alerts disable failed");
    res.status(503).json({ error: "Matchup alerts are temporarily unavailable." });
  }
});

return router;
}

export default createGameAlertsRouter();