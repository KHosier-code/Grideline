import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, gameAlertsTable, gamesTable, type GameAlertEvidence } from "@workspace/db";
import { logger } from "../lib/logger";
import { createGameAlertsRouter, verifiedQbAlertIdentity } from "./game-alerts";

test("missing or conflicted QB evidence is not a verified identity", () => {
  const qb = (status: "available" | "conflict" | "unavailable", playerId: string | null) => ({
    freshness: "current" as const,
    qbStarter: { status, player: playerId ? { playerId } : null },
  });
  assert.equal(verifiedQbAlertIdentity(qb("available", "qb-1") as never), "qb-1");
  assert.equal(verifiedQbAlertIdentity(qb("unavailable", null) as never), null);
  assert.equal(verifiedQbAlertIdentity(qb("conflict", "qb-2") as never), null);
});

test("alert routes reconcile pregame changes after kickoff without leaking or retaining opted-out subscriptions", async (t) => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("This fixture test must run against the development database only");
  }
  const gameId = `alert-route-${randomUUID()}`;
  const userA = `alert-user-a-${randomUUID()}`;
  const userB = `alert-user-b-${randomUUID()}`;
  const kickoff = new Date("2097-09-12T18:00:00.000Z");
  const baseline: GameAlertEvidence = {
    projection: { margin: 2, total: 44, homeWinProbability: 0.52 },
    personnel: { "home:qb": "starter-a" },
    market: { "FanDuel:spread:home": { point: -2, price: -110 } },
  };
  let now = new Date("2097-09-11T12:00:00.000Z");
  let current = baseline;
  const cutoffs: Date[] = [];
  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.use(createGameAlertsRouter({
    userId: (req) => req.header("x-test-user") ?? null,
    now: () => now,
    readEvidence: async (_game, cutoff) => {
      cutoffs.push(cutoff);
      return current;
    },
  }));
  await db.insert(gamesTable).values({
    gameId, season: 2097, week: 1, gameDate: kickoff, kickoffTime: kickoff,
    homeTeamId: "test-home", awayTeamId: "test-away", gameStatus: "STATUS_SCHEDULED",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(gameAlertsTable).where(eq(gameAlertsTable.gameId, gameId));
    await db.delete(gamesTable).where(eq(gamesTable.gameId, gameId));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/consumer/games/${gameId}/alerts`;
  const request = (method: string, user?: string) =>
    fetch(url, { method, headers: user ? { "x-test-user": user } : {} });

  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.equal((await request(method)).status, 401);
  }
  assert.equal((await request("PUT", userA)).status, 200);
  assert.deepEqual(await (await request("GET", userB)).json(), { enabled: false, events: [] });
  assert.equal((await request("DELETE", userB)).status, 204);

  // A fresh-but-unverified QB (or absent injury report) must not look like a substitution.
  current = { ...baseline, personnel: null };
  assert.deepEqual((await (await request("GET", userA)).json() as { events: unknown[] }).events, []);
  const [unchanged] = await db.select().from(gameAlertsTable)
    .where(and(eq(gameAlertsTable.gameId, gameId), eq(gameAlertsTable.userId, userA)));
  assert.deepEqual(unchanged?.baseline.personnel, baseline.personnel);

  // No poll occurred during this change; the first visit is after kickoff.
  now = new Date("2097-09-13T12:00:00.000Z");
  current = {
    projection: { margin: 4, total: 44, homeWinProbability: 0.52 },
    personnel: { "home:qb": "starter-b" },
    market: { "FanDuel:spread:home": { point: -3, price: -110 } },
  };
  const alerts = await (await request("GET", userA)).json() as {
    enabled: boolean; events: Array<{ category: string }>;
  };
  assert.equal(alerts.enabled, true);
  assert.deepEqual(alerts.events.map((event) => event.category), ["projection", "personnel", "market"]);
  assert.ok(cutoffs.at(-1)!.getTime() < kickoff.getTime(), "post-kickoff reads must be pregame-cutoff safe");
  assert.equal((await (await request("GET", userA)).json() as typeof alerts).events.length, 3);

  // One user's opt-out removes their history but cannot affect another subscriber.
  now = new Date("2097-09-11T12:00:00.000Z");
  assert.equal((await request("PUT", userB)).status, 200);
  assert.equal((await request("DELETE", userA)).status, 204);
  assert.deepEqual(await (await request("GET", userA)).json(), { enabled: false, events: [] });
  assert.equal((await (await request("GET", userB)).json() as { enabled: boolean }).enabled, true);
});