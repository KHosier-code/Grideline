import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db, gamesTable, identitySourceImportsTable, nflversePlayerIdentitiesTable,
  playerGameStatsTable, redZonePlayerGameFactsTable, redZoneTeamGameFactsTable,
  snapCountsTable, teamsTable,
} from "@workspace/db";
import { GetConsumerRedZoneOpportunitiesResponse } from "@workspace/api-zod";
import { deriveRedZoneGameFacts, type RedZonePlay } from "../lib/red-zone-opportunities";
import { logger } from "../lib/logger";
import consumerRouter, { redZoneFeatureGate } from "./consumer";

test("disabled red-zone route gate returns unavailable without dispatching the database handler", () => {
  const previous = process.env.GRIDLINE_RED_ZONE_ENABLED;
  delete process.env.GRIDLINE_RED_ZONE_ENABLED;
  let statusCode = 0;
  let body: unknown;
  let handlerCalls = 0;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  try {
    redZoneFeatureGate({} as never, response as never, () => { handlerCalls += 1; });
  } finally {
    if (previous === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    else process.env.GRIDLINE_RED_ZONE_ENABLED = previous;
  }
  assert.equal(statusCode, 503);
  assert.deepEqual(body, {
    error: "Red-zone opportunities are temporarily unavailable",
    code: "red_zone_unavailable",
  });
  assert.equal(handlerCalls, 0, "the route database handler must not run while disabled");
});

test("red-zone HTTP read joins cutoff-safe schedule, stats, PBP and verified snaps without inventing zeroes", async (t) => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("This fixture test must run against the development database only");
  }
  const previousRedZoneFlag = process.env.GRIDLINE_RED_ZONE_ENABLED;
  process.env.GRIDLINE_RED_ZONE_ENABLED = "1";
  const prefix = `rz-route-${randomUUID()}`;
  const season = 2098;
  const a = { id: `${prefix}-a`, code: `A${randomUUID().slice(0, 10).toUpperCase()}` };
  const b = { id: `${prefix}-b`, code: `B${randomUUID().slice(0, 10).toUpperCase()}` };
  const games = [1, 2, 3, 4].map((week) => `${prefix}-week-${week}`);
  const player = (name: string) => `${prefix}-${name}`;
  const traded = player("traded");
  const zero = player("verified-zero");
  const missing = player("missing");
  const snapOnly = player("snap-only");
  const unverified = player("unverified-snap");
  const snapId = (name: string) => `${prefix}-pfr-${name}`;
  const kickoff = (week: number) => new Date(`2098-09-${String(week + 5).padStart(2, "0")}T18:00:00Z`);

  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.use(consumerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    if (previousRedZoneFlag === undefined) delete process.env.GRIDLINE_RED_ZONE_ENABLED;
    else process.env.GRIDLINE_RED_ZONE_ENABLED = previousRedZoneFlag;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    // Identity imports/observations are intentionally immutable and remain only in
    // the isolated test namespace; all removable fixture data is cleaned by ID.
    await db.delete(redZonePlayerGameFactsTable).where(inArray(redZonePlayerGameFactsTable.gameId, games));
    await db.delete(redZoneTeamGameFactsTable).where(inArray(redZoneTeamGameFactsTable.gameId, games));
    await db.delete(snapCountsTable).where(inArray(snapCountsTable.gameId, games));
    await db.delete(playerGameStatsTable).where(inArray(playerGameStatsTable.playerId,
      [traded, zero, missing, snapOnly, unverified]));
    await db.delete(gamesTable).where(inArray(gamesTable.gameId, games));
    await db.delete(teamsTable).where(inArray(teamsTable.teamId, [a.id, b.id]));
  });

  await db.insert(teamsTable).values([
    { teamId: a.id, abbreviation: a.code, teamName: "Fixture A" },
    { teamId: b.id, abbreviation: b.code, teamName: "Fixture B" },
  ]);
  await db.insert(gamesTable).values(games.map((gameId, index) => ({
    gameId, season, week: index + 1, gameDate: kickoff(index + 1), kickoffTime: kickoff(index + 1),
    homeTeamId: a.id, awayTeamId: b.id, gameStatus: "STATUS_FINAL",
  })));

  const play = (week: number, playId: string, team: typeof a, yardline100: number,
    attempt: { receiverId?: string; rusherId?: string }): RedZonePlay => ({
    gameId: games[week - 1]!, sourceGameId: `${prefix}-source-${week}`, season, week,
    seasonType: "REG", playId, teamId: team.code, opponentTeamId: team === a ? b.code : a.code,
    yardline100, passAttempt: Boolean(attempt.receiverId), rushAttempt: Boolean(attempt.rusherId),
    receiverId: attempt.receiverId ?? null, rusherId: attempt.rusherId ?? null,
    noPlay: false, twoPointAttempt: false, kneel: false, spike: false,
    passTouchdown: false, rushTouchdown: false,
  });
  const facts = deriveRedZoneGameFacts([
    play(1, "a-target-20", a, 20, { receiverId: traded }),
    play(1, "a-target-10", a, 10, { receiverId: traded }),
    play(1, "a-other", a, 20, { receiverId: player("a-other") }),
    play(1, "a-rush", a, 5, { rusherId: player("a-rusher") }),
    play(1, "b-target", b, 20, { receiverId: player("b-other") }),
    // No PBP for completed week 2: even a verified snap must not become zero.
    play(3, "b-traded", b, 5, { receiverId: traded }),
    play(3, "b-other", b, 20, { receiverId: player("b-other") }),
    play(3, "a-other", a, 20, { receiverId: player("a-other") }),
    // Week 4 has real evidence but is excluded by the game cutoff.
    play(4, "future", b, 20, { receiverId: traded }),
    play(4, "future-a", a, 20, { receiverId: player("a-other") }),
  ]);
  await db.insert(redZoneTeamGameFactsTable).values(facts.teams);
  await db.insert(redZonePlayerGameFactsTable).values(facts.players.map((fact) => ({
    ...fact, position: "WR",
  })));
  await db.insert(playerGameStatsTable).values([
    ...[1, 2, 3, 4].map((week) => ({
      playerId: traded, playerName: "Traded Receiver", position: "WR",
      teamId: week <= 2 ? a.code : b.code, opponentTeamId: week <= 2 ? b.code : a.code,
      season, seasonType: "REG", week, targets: 1,
    })),
    { playerId: zero, playerName: "Verified Zero", position: "WR", teamId: a.code,
      opponentTeamId: b.code, season, seasonType: "REG", week: 1, targets: 0 },
    { playerId: missing, playerName: "Unverified Stats", position: "WR", teamId: a.code,
      opponentTeamId: b.code, season, seasonType: "REG", week: 1, targets: 0 },
  ]);
  await db.insert(snapCountsTable).values([
    { gameId: games[0]!, playerId: snapId("zero"), playerName: "Verified Zero", position: "WR",
      teamId: a.code, opponentTeamId: b.code, season, week: 1, offenseSnaps: 15, offensePct: .25 },
    { gameId: games[1]!, playerId: snapId("zero"), playerName: "Verified Zero", position: "WR",
      teamId: a.code, opponentTeamId: b.code, season, week: 2, offenseSnaps: 12, offensePct: .2 },
    { gameId: games[2]!, playerId: snapId("snap-only"), playerName: "Snap Only", position: "WR",
      teamId: b.code, opponentTeamId: a.code, season, week: 3, offenseSnaps: 25, offensePct: .5 },
    { gameId: games[2]!, playerId: snapId("unverified"), playerName: "Unverified", position: "WR",
      teamId: b.code, opponentTeamId: a.code, season, week: 3, offenseSnaps: 30, offensePct: .6 },
  ]);
  const latestRealImport = () => db.select({ id: identitySourceImportsTable.id })
    .from(identitySourceImportsTable).where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
    .orderBy(desc(identitySourceImportsTable.id)).limit(1);
  const realImportBefore = await latestRealImport();
  const [fixtureImport] = await db.insert(identitySourceImportsTable).values({
    sourceNamespace: "test-fixture:nflverse", sourceUrl: `fixture://${prefix}`,
    sourceContentHash: prefix, canonicalRowsHash: prefix, rowCount: 2,
  }).returning({ id: identitySourceImportsTable.id });
  assert.ok(fixtureImport);
  await db.insert(nflversePlayerIdentitiesTable).values([
    { importId: fixtureImport.id, gsisId: zero, pfrId: snapId("zero"),
      displayName: "Verified Zero", rowFingerprint: `${prefix}-zero` },
    { importId: fixtureImport.id, gsisId: snapOnly, pfrId: snapId("snap-only"),
      displayName: "Snap Only", rowFingerprint: `${prefix}-snap-only` },
  ]);
  assert.deepEqual(await latestRealImport(), realImportBefore);

  const get = async (params: Record<string, string>) => {
    const query = new URLSearchParams({ season: String(season), game: games[3]!, ...params });
    const response = await fetch(`http://127.0.0.1:${address.port}/consumer/red-zone-opportunities?${query}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 400));
    return GetConsumerRedZoneOpportunitiesResponse.parse(body);
  };
  const zone = <T extends { zone: number }>(zones: T[], value: number): T | undefined =>
    zones.find((entry) => entry.zone === value);

  const aResult = await get({ team: a.id, position: "WR", period: "last3" });
  assert.equal(aResult.status, "partial");
  assert.deepEqual(aResult.coverage, {
    status: "partial", completedGames: 3, gamesWithPbp: 2, missingGames: [games[1]],
    coveredWeeks: [1, 3], missingWeeks: [2],
    firstCoveredKickoff: kickoff(1), lastCoveredKickoff: kickoff(3),
    partialReasons: ["Play-by-play coverage: covered weeks 1, 3; unavailable week 2."],
    note: aResult.coverage.note,
  });
  assert.ok(aResult.ingestedAt);
  assert.equal(aResult.sourceUpdatedAt, null);
  const aTraded = aResult.players.find((row) => row.playerId === traded)!;
  assert.equal(aTraded.teamId, a.code);
  assert.deepEqual(aTraded.games.map((row) => row.gameId), [games[0]],
    "an appearance without PBP is reported in coverage, not shown as a zero-opportunity game");
  assert.deepEqual(aTraded.sourceCoverage, {
    requestedGames: 2, includedGames: 1, missingGames: [games[1]],
    coveredWeeks: [1], missingWeeks: [2],
    firstCoveredKickoff: kickoff(1), lastCoveredKickoff: kickoff(1),
  });
  assert.equal(zone(aTraded.games[0]!.zones, 20)?.targets, 2);
  assert.equal(zone(aTraded.games[0]!.zones, 20)?.teamTargets, 3);
  assert.equal(zone(aTraded.games[0]!.zones, 20)?.targetShare, 2 / 3);
  assert.equal(zone(aTraded.games[0]!.zones, 10)?.targets, 1);
  assert.equal(zone(aTraded.games[0]!.zones, 10)?.targetShare, 1);
  assert.equal(zone(aTraded.games[0]!.zones, 5)?.targets, 0);
  assert.equal(zone(aTraded.games[0]!.zones, 5)?.teamCarries, 1);
  assert.equal(zone(aTraded.zones, 20)?.targets, 2,
    "the available game retains observed counts while sourceCoverage marks the missing appearance");
  const aZero = aResult.players.find((row) => row.playerId === zero)!;
  assert.equal(aZero.games[0]?.offenseSnaps, 15);
  assert.equal(zone(aZero.games[0]!.zones, 20)?.targets, 0);
  assert.equal(zone(aZero.games[0]!.zones, 20)?.targetShare, 0);
  assert.deepEqual(aZero.games.map((row) => row.gameId), [games[0]]);
  assert.deepEqual(aZero.sourceCoverage.missingGames, [games[1]]);
  const aMissing = aResult.players.find((row) => row.playerId === missing)!;
  assert.deepEqual(aMissing.games, [],
    "weekly stats without a player fact or verified positive snap do not prove zero opportunities");
  assert.deepEqual(aMissing.sourceCoverage.missingGames, [games[0]]);

  const bResult = await get({ team: b.code, position: "WR", period: "last3", zone: "20" });
  assert.equal(bResult.coverage.completedGames, 3);
  assert.equal(bResult.coverage.gamesWithPbp, 2);
  const bTraded = bResult.players.find((row) => row.playerId === traded)!;
  assert.deepEqual(bTraded.games.map((row) => row.gameId), [games[2]]);
  assert.equal(bTraded.teamId, b.code);
  assert.equal(bTraded.zones[0]?.targets, 1);
  assert.equal(bTraded.zones[0]?.teamTargets, 2);
  assert.equal(bTraded.zones[0]?.targetShare, .5);
  assert.equal(bTraded.zones[0]?.teamCarries, 0);
  assert.equal(bTraded.zones[0]?.carryShare, null);
  const bSnapOnly = bResult.players.find((row) => row.playerId === snapOnly)!;
  assert.equal(bSnapOnly.gamesPlayed, 1);
  assert.equal(bSnapOnly.snapGames, 1);
  assert.equal(bSnapOnly.games[0]?.offenseSnaps, 25);
  assert.equal(bSnapOnly.zones[0]?.targets, 0);
  assert.equal(bSnapOnly.zones[0]?.targetShare, 0);
  assert.ok(!bResult.players.some((row) => row.playerId === unverified),
    "positive snaps without a verified GSIS/PFR crosswalk are not appearances");

  const earlier = await get({ team: b.code, game: games[2]!, zone: "20" });
  assert.equal(earlier.coverage.completedGames, 2);
  assert.equal(earlier.coverage.gamesWithPbp, 1);
  assert.deepEqual(earlier.coverage.missingGames, [games[1]]);
  assert.ok(!earlier.players.some((row) => row.playerId === traded && row.teamId === b.code),
    "the cutoff game itself must not leak into the response");
});