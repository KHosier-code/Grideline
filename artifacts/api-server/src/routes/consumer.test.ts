import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { desc, eq, inArray, like } from "drizzle-orm";
import {
  db, gamesTable, identitySourceImportsTable, injuriesTable, nflversePlayerIdentitiesTable,
  playerGameStatsTable, playersTable, snapCountsTable, teamsTable,
} from "@workspace/db";
import {
  GetConsumerDashboardResponse,
  GetConsumerGameResponse,
  GetConsumerPerformanceResponse,
  GetConsumerPropsAvailabilityResponse,
  GetConsumerTrendsResponse,
  GetConsumerPlayerUsageResponse,
  ListConsumerGamesResponse,
  GetConsumerScheduleSelectionResponse,
} from "@workspace/api-zod";
import { selectConsumerSlate } from "../lib/consumer-schedule-selection";
import consumerRouter, {
  MAX_CONSUMER_GAMES,
  MAX_CONSUMER_MOVEMENT_ROWS,
  MAX_CONSUMER_PERFORMANCE_ROWS,
  MAX_CONSUMER_SNAPSHOT_ROWS,
  aggregatePlayerUsage,
  applyModelPersonnelLimitationToRecommendation,
  applyCurrentPersonnelToConsumerContext,
  americanOddsImpliedProbability,
  buildUsageSnapPlayerAliases,
  buildUsageTeamMappings,
  buildConsumerMarketBoard,
  compareUsageGameChronology,
  consumerGameDetailHandler,
  consumerGames,
  consumerFinalScore,
  consumerMarket,
  currentModelPersonnelLimitation,
  deterministicSourceGameId,
  eligibleUsageGames,
  eligibleUsageRows,
  filterUsagePlayers,
  rankRecentKeyPlayers,
  serializeContext,
  serializeMovement,
  serializePerformance,
  summarizeConsumerMarketBoards,
  usageCompositeIdentity,
  usageMatchupIdentity,
  usageSeasonAtCutoff,
  verifyTeamRecords,
} from "./consumer";
import { deriveCurrentTeamDepth } from "../lib/current-personnel-derivation";
import { logger } from "../lib/logger";

const boardRow = (
  sportsbook: string,
  market: string,
  selection: string,
  point: number | null,
  price: number,
  capturedAt: string,
) => ({ sportsbook, market, selection, point, price, capturedAt: new Date(capturedAt) });

test("persisted schedule selects live then next kickoff, including postseason year rollover", () => {
  const rows = [
    { season: 2026, week: 18, kickoffTime: new Date("2027-01-04T17:00:00Z"), gameStatus: "STATUS_FINAL" },
    { season: 2026, week: 19, kickoffTime: new Date("2027-01-11T18:00:00Z"), gameStatus: "STATUS_SCHEDULED" },
    { season: 2026, week: 19, kickoffTime: new Date("2027-01-12T18:00:00Z"), gameStatus: "STATUS_SCHEDULED" },
    { season: 2026, week: 20, kickoffTime: new Date("2027-01-19T18:00:00Z"), gameStatus: "STATUS_SCHEDULED" },
    { season: 2027, week: 1, kickoffTime: new Date("2027-09-10T18:00:00Z"), gameStatus: "STATUS_SCHEDULED" },
  ];
  assert.deepEqual(selectConsumerSlate(rows, new Date("2027-01-05T00:00:00Z")), { selection: { season: 2026, week: 19 }, reason: "upcoming" });
  assert.deepEqual(selectConsumerSlate([{ ...rows[1], gameStatus: "STATUS_IN_PROGRESS" }, ...rows.slice(2)], new Date("2027-01-11T19:00:00Z")), { selection: { season: 2026, week: 19 }, reason: "live" });
  assert.deepEqual(selectConsumerSlate(rows.slice(0, 1), new Date("2027-06-01T00:00:00Z")), { selection: { season: 2026, week: 18 }, reason: "past" });
  assert.deepEqual(selectConsumerSlate([{ ...rows[0], gameStatus: "STATUS_SCHEDULED" }, ...rows.slice(1)], new Date("2027-01-05T12:00:00Z")), { selection: { season: 2026, week: 19 }, reason: "upcoming" });
  assert.deepEqual(selectConsumerSlate([], new Date("2027-01-01T00:00:00Z")), { selection: null, reason: "no_schedule" });
  assert.equal(GetConsumerScheduleSelectionResponse.safeParse(selectConsumerSlate(rows, new Date("2027-01-05T00:00:00Z"))).success, true);
});

test("American odds implied probability rejects invalid prices", () => {
  assert.equal(americanOddsImpliedProbability(-150), 0.6);
  assert.equal(americanOddsImpliedProbability(200), 1 / 3);
  for (const invalid of [0, 99, -99, 100.5, Number.NaN, null]) {
    assert.equal(americanOddsImpliedProbability(invalid), null);
  }
});

test("market board deterministically selects best lines and orients model differences", () => {
  const board = buildConsumerMarketBoard({
    projectedMargin: 4,
    projectedTotal: 47,
    homeWinProbability: 0.6,
    predictionTimestamp: new Date("2026-09-01T11:00:00Z"),
  }, [
    boardRow("DraftKings", "spread", "Home Team", -3, -110, "2026-09-01T12:00:00Z"),
    boardRow("FanDuel", "spread", "Home Team", -3, -105, "2026-09-01T12:01:00Z"),
    boardRow("DraftKings", "total", "Over", 45.5, -105, "2026-09-01T12:00:00Z"),
    boardRow("FanDuel", "total", "Over", 46, 110, "2026-09-01T12:01:00Z"),
    boardRow("DraftKings", "moneyline", "Home Team", null, -150, "2026-09-01T12:00:00Z"),
    boardRow("FanDuel", "moneyline", "Home Team", null, -145, "2026-09-01T12:01:00Z"),
  ], { teamId: "home", name: "Home Team", abbreviation: "HME" }, new Date("2026-09-02T00:00:00Z"),
  new Date("2026-09-01T12:10:00Z"), new Date("2026-09-01T12:09:00Z"));

  assert.equal(board.status, "available");
  assert.equal(board.comparisons[0]?.selectedQuote?.sportsbook, "FanDuel");
  assert.equal(board.comparisons[0]?.difference, 1);
  assert.equal(board.comparisons[1]?.selectedQuote?.sportsbook, "DraftKings");
  assert.equal(board.comparisons[1]?.difference, 1.5);
  assert.equal(board.comparisons[2]?.selectedQuote?.sportsbook, "FanDuel");
  assert.ok(Math.abs((board.comparisons[2]?.difference ?? 0) - 0.8163265306) < 0.000001);
});

test("market board consumes only pre-kickoff history and exposes first/current evidence", () => {
  const board = buildConsumerMarketBoard({
    projectedMargin: 3,
    projectedTotal: 44,
    homeWinProbability: 0.55,
    predictionTimestamp: new Date("2026-09-01T10:00:00Z"),
  }, [
    boardRow("DraftKings", "spread", "Home Team", -2.5, -110, "2026-09-01T12:00:00Z"),
    boardRow("DraftKings", "spread", "Home Team", -3, -105, "2026-09-01T13:00:00Z"),
    boardRow("DraftKings", "spread", "Home Team", -1, 110, "2026-09-01T15:00:00Z"),
  ], { teamId: "home", name: "Home Team", abbreviation: "HME" }, new Date("2026-09-01T14:00:00Z"), new Date("2026-09-01T16:00:00Z"));

  const spread = board.comparisons[0];
  assert.equal(board.status, "stale");
  assert.equal(spread?.state, "stale");
  assert.equal(spread?.firstObserved?.point, -2.5);
  assert.equal(spread?.current?.point, -3);
  assert.equal(spread?.marketTimestamp, "2026-09-01T13:00:00.000Z");
  assert.equal(board.comparisons[1]?.state, "absent");
  assert.equal(board.comparisons[1]?.marketValue, null);
});

test("market board summary reports partial, stale, absent, and sportsbook coverage", () => {
  const home = { teamId: "home", name: "Home Team", abbreviation: "HME" };
  const snapshot = {
    projectedMargin: 3,
    projectedTotal: 44,
    homeWinProbability: 0.55,
    predictionTimestamp: new Date("2026-09-01T10:00:00Z"),
  };
  const available = buildConsumerMarketBoard(snapshot, [
    boardRow("DraftKings", "spread", "Home Team", -3, -110, "2026-09-01T12:00:00Z"),
  ], home, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-01T12:10:00Z"),
  new Date("2026-09-01T12:09:00Z"));
  const stale = buildConsumerMarketBoard(snapshot, [
    boardRow("FanDuel", "total", "Over", 44, -110, "2026-09-01T11:00:00Z"),
  ], home, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-01T12:10:00Z"));
  const absent = buildConsumerMarketBoard(snapshot, [], home, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-01T12:10:00Z"));

  assert.deepEqual(summarizeConsumerMarketBoards([
    { marketBoard: available },
    { marketBoard: stale },
    { marketBoard: absent },
  ]), {
    status: "partial",
    coverage: { games: 3, gamesWithComparison: 2, DraftKings: 1, FanDuel: 1 },
  });
  assert.equal(summarizeConsumerMarketBoards([{ marketBoard: stale }]).status, "stale");
  assert.equal(summarizeConsumerMarketBoards([]).status, "absent");
});

test("database-backed player usage route isolates the applicable season and supports validated filters", async (t) => {
  const app = express();
  app.use(consumerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${baseUrl}/consumer/player-usage?position=WR&window=last3`);
  assert.equal(response.status, 200);
  const payload = GetConsumerPlayerUsageResponse.parse(await response.json());
  assert.equal(payload.season, usageSeasonAtCutoff(new Date()));
  assert.ok(payload.availableTeams.length >= 32);
  assert.ok(payload.players.every((player) => player.games.every((game) => game.season === payload.season)),
    "prior-season player identities must not leak into the default result");

  const team = payload.availableTeams[0]!.abbreviation;
  const filteredResponse = await fetch(`${baseUrl}/consumer/player-usage?team=${encodeURIComponent(team)}&position=WR&window=last3`);
  assert.equal(filteredResponse.status, 200);
  const filtered = GetConsumerPlayerUsageResponse.parse(await filteredResponse.json());
  assert.ok(filtered.players.every((player) => player.teamId === team && player.position === "WR"));
});

test("player usage aggregation preserves sparse history and null denominators", () => {
  const result = aggregatePlayerUsage([
    { playerId: "p1", playerName: "Receiver", position: "WR", teamId: "T", gameId: "g1", season: 2025, week: 1, seasonType: "REG", targets: 4, receptions: 2, receivingYards: 30, carries: 0, rushingYards: 0, rushingTds: null, receivingTds: 1 },
    { playerId: "p1", playerName: "Receiver", position: "WR", teamId: "T", gameId: "g2", season: 2025, week: 2, seasonType: "REG", targets: 0, receptions: 0, receivingYards: 0, carries: 0, rushingYards: 0, rushingTds: null, receivingTds: null },
  ], [{ playerId: "p1", gameId: "g1", offensePct: 0.8 }], 3, "last3");
  assert.equal(result[0]?.sourceCoverage.includedGames, 2);
  assert.equal(result[0]?.aggregate.yardsPerTarget.value, 7.5);
  assert.equal(result[0]?.aggregate.yardsPerCarry.value, null);
  assert.equal(result[0]?.aggregate.yardsPerCarry.reason, "Carries denominator unavailable");
  assert.equal(result[0]?.aggregate.redZoneTouches.available, false);
  assert.equal(result[0]?.aggregate.receivingTds.value, 1);
  assert.equal(result[0]?.games[0]?.metrics.receivingTds.value, 1);
  assert.equal(result[0]?.games[1]?.metrics.receivingTds.value, null);
  assert.equal(result[0]?.trend, "down");
});

test("quarterback passing stats survive aggregation; missing source stays unavailable", () => {
  const common = { playerId: "qb", playerName: "Quarterback", position: "QB", teamId: "KC", season: 2026, seasonType: "REG",
    targets: 0, receptions: 0, receivingYards: 0, carries: 2, rushingYards: 17, rushingTds: 0, receivingTds: 0 };
  const result = aggregatePlayerUsage([
    { ...common, gameId: "g1", week: 1, attempts: 27, completions: 15, passingYards: 184, passingTds: 2 },
    { ...common, gameId: "g2", week: 2, attempts: 47, completions: 32, passingYards: 382, passingTds: 3 },
  ], [], 3, "last3", new Map([["KC", 3]]), new Map([["KC", ["g1", "g2", "g3"]]]))[0]!;
  assert.equal(result.aggregate.attempts.value, 74);
  assert.equal(result.aggregate.completions.value, 47);
  assert.equal(result.aggregate.passingYards.value, 566);
  assert.equal(result.aggregate.passingTds.value, 5);
  assert.equal(result.aggregate.receivingTds.value, 0);
  assert.equal(result.aggregate.totalTd.value, 5);
  assert.equal(result.games[0]?.metrics.passingYards.value, 184);
  assert.equal(result.trend, "up");
  assert.equal(result.sourceCoverage.includedGames, 2);
  assert.equal(result.sourceCoverage.requestedGames, 3);
  const missing = aggregatePlayerUsage([
    { ...common, gameId: "g1", week: 1, attempts: null, completions: 0, passingYards: null, passingTds: 0 },
  ], [], 1, "season")[0]!;
  assert.equal(missing.aggregate.attempts.value, null);
  assert.equal(missing.aggregate.attempts.available, false);
  assert.equal(missing.aggregate.completions.value, 0);
  assert.equal(missing.aggregate.completions.available, true);
});

test("usage windows exclude kicked-off games until their final status is recorded", () => {
  const kickoff = new Date("2026-09-20T18:00:00Z");
  const candidates = [
    { gameId: "final", season: 2026, kickoffTime: kickoff, gameStatus: "STATUS_FINAL" },
    { gameId: "still-playing", season: 2026, kickoffTime: kickoff, gameStatus: "STATUS_IN_PROGRESS" },
    { gameId: "scheduled", season: 2026, kickoffTime: kickoff, gameStatus: "STATUS_SCHEDULED" },
  ];
  assert.deepEqual(eligibleUsageGames(candidates, 2026, new Date("2026-09-21T00:00:00Z"))
    .map((game) => game.gameId), ["final"]);
});

test("usage keeps a player's statistics separate after changing teams", () => {
  const common = { playerId: "same-id", playerName: "Traded player", position: "WR", season: 2026,
    seasonType: "REG", attempts: 0, completions: 0, passingYards: 0, passingTds: 0,
    receptions: 2, receivingYards: 20, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0 };
  const players = aggregatePlayerUsage([
    { ...common, teamId: "KC", gameId: "g1", week: 1, targets: 3 },
    { ...common, teamId: "BUF", gameId: "g2", week: 2, targets: 5 },
  ], [], 2, "last3", new Map([["KC", 1], ["BUF", 1]]),
  new Map([["KC", ["g1"]], ["BUF", ["g2"]]]));
  assert.equal(players.length, 2);
  assert.equal(players.find((player) => player.teamId === "KC")?.aggregate.targets.value, 3);
  assert.equal(players.find((player) => player.teamId === "BUF")?.aggregate.targets.value, 5);
});

test("usage windows retain only requested recent games and consumer positions", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    playerId: "p1", playerName: "Back", position: "RB", teamId: "T", gameId: `g${index}`,
    season: 2025, week: index + 1, seasonType: "REG", targets: 1, receptions: 1,
    receivingYards: 2, carries: 2, rushingYards: 8, rushingTds: 0, receivingTds: 0,
  }));
  const snaps = rows.map((row) => ({ playerId: row.playerId, gameId: row.gameId, offensePct: 0.5 }));
  for (const [name, count] of [["last3", 3], ["last5", 5], ["last8", 8]] as const) {
    assert.equal(aggregatePlayerUsage(rows, snaps, 8, name)[0]?.games.length, count);
  }
  assert.equal(filterUsagePlayers([{ teamId: "T", position: "K" }, { teamId: "T", position: "WR" }], "T").length, 1);
  assert.equal(filterUsagePlayers([{ teamId: "T", position: "RB" }], "OTHER").length, 0);
});

test("Game Detail Cleveland cards include Judkins and skill positions ahead of linemen", () => {
  const candidate = (playerId: string, position: string, snapShare: number | null, targets = 0, carries = 0) => ({
    playerId, teamId: "CLE", position,
    aggregate: { snapShare: { value: snapShare }, targets: { value: targets }, carries: { value: carries } },
  });
  const selected = rankRecentKeyPlayers([
    ...Array.from({ length: 6 }, (_, i) => candidate(`lineman-${i}`, "OL", 1)),
    candidate("quarterback", "QB", .98),
    candidate("Quinshon Judkins", "RB", .51, 7, 24),
    candidate("other-back", "RB", .65, 1, 5),
    candidate("receiver", "WR", .43, 10),
    candidate("tight-end", "TE", .5, 4),
    candidate("other-receiver", "WR", .75, 8),
  ], "CLE");
  assert.deepEqual(selected.map((player) => player.playerId),
    ["quarterback", "Quinshon Judkins", "receiver", "tight-end", "other-receiver"]);
  assert.equal(selected.length, 5);
});

test("Game Detail Seattle cards retain sparse usage and fill missing roles without inventing metrics", () => {
  const candidate = (playerId: string, position: string, snapShare: number | null, targets: number | null, carries: number | null) => ({
    playerId, teamId: "SEA", position,
    aggregate: { snapShare: { value: snapShare }, targets: { value: targets }, carries: { value: carries } },
  });
  const selected = rankRecentKeyPlayers([
    candidate("Drew Lock", "QB", .67, null, 2),
    candidate("Sam Darnold", "QB", .33, null, null),
    candidate("Jaxon Smith-Njigba", "WR", .85, 22, null),
    candidate("Cooper Kupp", "WR", .8, 12, null),
    candidate("Rashid Shaheed", "WR", .65, 6, null),
    candidate("lineman", "C", 1, null, null),
    { ...candidate("opposing-player", "RB", 1, 20, 20), teamId: "CLE" },
  ], "SEA");
  assert.deepEqual(selected.map((player) => player.playerId),
    ["Drew Lock", "Jaxon Smith-Njigba", "Cooper Kupp", "Rashid Shaheed", "Sam Darnold"]);
  assert.equal(selected.find((player) => player.playerId === "Jaxon Smith-Njigba")?.aggregate.carries.value, null);
  assert.equal(selected.find((player) => player.playerId === "Drew Lock")?.aggregate.targets.value, null);
  assert.deepEqual(rankRecentKeyPlayers([], "SEA"), []);
});

test("database-backed Game Detail selects both teams' skill players and enforces pregame eligibility", async (t) => {
  const prefix = `detail-fixture-${randomUUID()}`;
  // Unique source abbreviations and IDs prevent existing seasons or concurrent tests
  // from contributing player history to either team's selection.
  const away = { id: `${prefix}-away`, code: `A${randomUUID().slice(0, 10).toUpperCase()}` };
  const home = { id: `${prefix}-home`, code: `H${randomUUID().slice(0, 10).toUpperCase()}` };
  const previousId = `${prefix}-previous`;
  const finalId = `${prefix}-final`;
  const upcomingId = `${prefix}-upcoming`;
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 86_400_000);
  const tomorrow = new Date(now + 86_400_000);
  const statusAt = new Date(now - 60_000);
  const playerId = (name: string) => `${prefix}-${name}`;
  const receiverSnapId = `${prefix}-pfr-away-wr`;
  const players = [
    { name: "away-qb", team: away, position: "QB", targets: 0, carries: 2, snap: .95 },
    { name: "away-rb", team: away, position: "RB", targets: 3, carries: 14, snap: .65 },
    { name: "away-wr", team: away, position: "WR", targets: 9, carries: 0, snap: .8 },
    { name: "away-ol", team: away, position: "OL", targets: 0, carries: 0, snap: 1 },
    { name: "away-out", team: away, position: "WR", targets: 22, carries: 0, snap: .9 },
    { name: "home-qb", team: home, position: "QB", targets: 0, carries: 3, snap: .98 },
    { name: "home-rb", team: home, position: "RB", targets: 4, carries: 17, snap: .7 },
    { name: "home-wr", team: home, position: "WR", targets: 12, carries: 0, snap: .76 },
    { name: "home-ol", team: home, position: "C", targets: 0, carries: 0, snap: 1 },
    { name: "home-out", team: home, position: "RB", targets: 5, carries: 30, snap: .92 },
  ];
  let injurySourceStatus: "healthy" | "stale" = "healthy";
  let playerSourceStatus: "healthy" | "stale" = "healthy";
  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.get("/consumer/games/:gameId", consumerGameDetailHandler(async (filters) => {
    const games = await consumerGames(filters);
    return Object.assign(games, {
      sourceHealth: {
        ...games.sourceHealth,
        sources: {
          ...games.sourceHealth.sources,
          injuries: { ...games.sourceHealth.sources.injuries, status: injurySourceStatus },
          players: { ...games.sourceHealth.sources.players, status: playerSourceStatus },
        },
      },
    });
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(injuriesTable).where(like(injuriesTable.sourceHash, `${prefix}%`));
    await db.delete(snapCountsTable).where(inArray(snapCountsTable.gameId, [previousId, finalId]));
    await db.delete(playerGameStatsTable).where(inArray(playerGameStatsTable.teamId, [away.code, home.code]));
    await db.delete(playersTable).where(like(playersTable.playerId, `${prefix}%`));
    await db.delete(gamesTable).where(inArray(gamesTable.gameId, [previousId, finalId, upcomingId]));
    await db.delete(teamsTable).where(inArray(teamsTable.teamId, [away.id, home.id]));
  });

  await db.insert(teamsTable).values([
    { teamId: away.id, abbreviation: away.code, teamName: "Fixture Away" },
    { teamId: home.id, abbreviation: home.code, teamName: "Fixture Home" },
  ]);
  await db.insert(gamesTable).values([
    { gameId: previousId, season: 2026, week: 1, gameDate: daysAgo(4), kickoffTime: daysAgo(4),
      homeTeamId: home.id, awayTeamId: away.id, gameStatus: "STATUS_FINAL", finalHomeScore: 20, finalAwayScore: 17 },
    { gameId: finalId, season: 2026, week: 2, gameDate: daysAgo(2), kickoffTime: daysAgo(2),
      homeTeamId: home.id, awayTeamId: away.id, gameStatus: "STATUS_FINAL", finalHomeScore: 24, finalAwayScore: 21 },
    { gameId: upcomingId, season: 2026, week: 3, gameDate: tomorrow, kickoffTime: tomorrow,
      homeTeamId: home.id, awayTeamId: away.id, gameStatus: "STATUS_SCHEDULED" },
  ]);
  await db.insert(playersTable).values(players.map(({ name, team, position }) => ({
    playerId: playerId(name), name, teamId: team.id, position,
    activeStatus: name.endsWith("-out") ? "Out" : "Active", sourceUpdatedAt: statusAt,
  })));
  const latestRealImport = () => db.select({ id: identitySourceImportsTable.id })
    .from(identitySourceImportsTable)
    .where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
    .orderBy(desc(identitySourceImportsTable.id)).limit(1);
  const realImportBefore = await latestRealImport();
  // This append-only observation uses a test namespace, so latest real nflverse
  // import selection remains unchanged even though the fixture cannot be deleted.
  const [identityImport] = await db.insert(identitySourceImportsTable).values({
    sourceNamespace: "test-fixture:nflverse",
    sourceUrl: `fixture://${prefix}`,
    sourceContentHash: prefix,
    canonicalRowsHash: prefix,
    rowCount: 1,
  }).returning({ id: identitySourceImportsTable.id });
  assert.ok(identityImport);
  await db.insert(nflversePlayerIdentitiesTable).values({
    importId: identityImport.id,
    gsisId: playerId("away-wr"),
    pfrId: receiverSnapId,
    displayName: "away-wr",
    rowFingerprint: prefix,
  });
  assert.deepEqual(await latestRealImport(), realImportBefore,
    "a route fixture must not replace the latest real nflverse import");
  await db.insert(playerGameStatsTable).values([1, 2].flatMap((week) => players.map((player) => ({
    playerId: playerId(player.name), playerName: player.name, position: player.position,
    teamId: player.team.code, opponentTeamId: player.team === away ? home.code : away.code,
    season: 2026, seasonType: "REG", week, targets: player.targets,
    carries: player.carries, receptions: player.targets, receivingYards: player.targets * 10,
    rushingYards: player.carries * 4,
  }))));
  await db.insert(snapCountsTable).values([1, 2].flatMap((week) => players.map((player) => ({
    gameId: week === 1 ? previousId : finalId,
    playerId: player.name === "away-wr" ? receiverSnapId : playerId(player.name),
    playerName: player.name, position: player.position, season: 2026, week,
    teamId: player.team.code, opponentTeamId: player.team === away ? home.code : away.code,
    offensePct: player.snap,
  }))));
  // The route's health assessment is fixed above; only this game's player
  // statuses and injury records need to exist in the development database.
  await db.insert(injuriesTable).values(players.map(({ name, team, position }) => ({
    playerId: playerId(name), teamId: team.id, position,
    gameStatus: name.endsWith("-out") ? "Out" : "Active",
    sourceHash: `${prefix}-${name}`, snapshotTimestamp: statusAt,
  })));

  const getDetail = async (gameId: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/consumer/games/${gameId}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 300));
    return GetConsumerGameResponse.parse(body);
  };
  const upcoming = await getDetail(upcomingId);
  assert.equal(upcoming.gameState, "pregame");
  assert.deepEqual(upcoming.keyPlayers.map(({ name }) => name),
    ["away-qb", "away-rb", "away-wr", "home-qb", "home-rb", "home-wr"]);
  assert.deepEqual(upcoming.keyPlayers.map(({ teamId }) => teamId),
    [away.code, away.code, away.code, home.code, home.code, home.code]);
  assert.ok(upcoming.keyPlayers.every(({ eligibility }) => eligibility.status === "eligible"));
  assert.equal(upcoming.keyPlayers.find(({ name }) => name === "away-wr")?.recentUsage.targets, 18);
  assert.equal(upcoming.keyPlayers.find(({ name }) => name === "away-wr")?.recentUsage.snapShare, .8);
  assert.equal(upcoming.keyPlayers.find(({ name }) => name === "home-rb")?.recentUsage.carries, 34);
  const completed = await getDetail(finalId);
  assert.equal(completed.gameState, "final");
  assert.deepEqual(completed.keyPlayers.map(({ name }) => name),
    ["away-qb", "away-rb", "away-out", "away-wr", "home-qb", "home-out", "home-wr", "home-rb"]);
  assert.ok(completed.keyPlayers.every(({ eligibility }) => eligibility.status === "ineligible"));
  assert.equal(completed.keyPlayers.find(({ name }) => name === "away-wr")?.recentUsage.targets, 9);
  assert.equal(completed.keyPlayers.find(({ name }) => name === "away-wr")?.recentUsage.snapShare, .8);

  // Preserve the incoming source-health checks with the restored fixture.
  const assertUnknownPregameStatuses = (detail: typeof upcoming) => {
    assert.equal(detail.gameState, "pregame");
    assert.equal(detail.keyPlayers.find(({ name }) => name === "away-out")?.eligibility.status, "unknown");
    assert.equal(detail.keyPlayers.find(({ name }) => name === "home-out")?.eligibility.status, "unknown");
    assert.equal(detail.keyPlayers.find(({ name }) => name === "away-qb")?.eligibility.status, "unknown");
    assert.ok(detail.keyPlayers.every(({ eligibility }) =>
      eligibility.status === "unknown" && eligibility.reason === "Player status evidence is missing, invalid, or stale."));
  };
  injurySourceStatus = "stale";
  const staleInjuries = await getDetail(upcomingId);
  assert.equal(staleInjuries.sourceHealth.sources.injuries.status, "stale");
  assert.equal(staleInjuries.sourceHealth.sources.players.status, "healthy");
  assertUnknownPregameStatuses(staleInjuries);

  injurySourceStatus = "healthy";
  playerSourceStatus = "stale";
  const stalePlayers = await getDetail(upcomingId);
  assert.equal(stalePlayers.sourceHealth.sources.injuries.status, "healthy");
  assert.equal(stalePlayers.sourceHealth.sources.players.status, "stale");
  assertUnknownPregameStatuses(stalePlayers);

  playerSourceStatus = "healthy";
  await db.update(playersTable).set({ sourceUpdatedAt: daysAgo(4) })
    .where(like(playersTable.playerId, `${prefix}%`));
  await db.update(injuriesTable).set({ snapshotTimestamp: daysAgo(4) })
    .where(like(injuriesTable.sourceHash, `${prefix}%`));
  const oldStatuses = await getDetail(upcomingId);
  assert.equal(oldStatuses.sourceHealth.sources.injuries.status, "healthy");
  assert.equal(oldStatuses.sourceHealth.sources.players.status, "healthy");
  assertUnknownPregameStatuses(oldStatuses);
});

test("usage team mapping joins ESPN schedule IDs to nflverse abbreviations and aliases", () => {
  const mappings = buildUsageTeamMappings([
    { teamId: "12", abbreviation: "KC" },
    { teamId: "13", abbreviation: "LAR" },
  ]);
  assert.equal(mappings.canonical("KC"), "KC");
  assert.equal(mappings.canonical("LA"), "LAR");
  assert.equal(mappings.scheduleToAbbreviation.get("12"), "KC");
  assert.equal(mappings.canonical("13"), "LAR");
  const scheduleKey = `2026:1:${mappings.canonical("12")}:${mappings.canonical("13")}`;
  const nflverseRowKey = `2026:1:${mappings.canonical("KC")}:${mappings.canonical("LA")}`;
  assert.equal(nflverseRowKey, scheduleKey);
});

test("source game and snap identities resolve independently of persisted raw game IDs", () => {
  const stat = { season: 2024, seasonType: "REG", week: 3, teamId: "KC", opponentTeamId: "BUF", playerId: "00-0012345" };
  const sourceGame = deterministicSourceGameId(stat);
  assert.equal(sourceGame, "source:2024:REG:3:KC:BUF");
  assert.equal(usageCompositeIdentity(stat), "2024:REG:3:KC:BUF:00-0012345");
  const resolvedGames = new Map([[usageMatchupIdentity(stat), sourceGame]]);
  assert.equal(resolvedGames.get(usageMatchupIdentity({
    season: 2024, week: 3, teamId: "KC", opponentTeamId: "BUF",
  })), sourceGame);
  assert.ok(compareUsageGameChronology({ seasonType: "REG", week: 18 }, { seasonType: "POST", week: 1 }) < 0);
  const aliases = buildUsageSnapPlayerAliases([{ gsisId: stat.playerId, pfrId: "PlayPa00" }]);
  const usage = aggregatePlayerUsage([{
    ...stat, gameId: sourceGame, playerName: "Player", position: "WR",
    targets: 2, receptions: 1, receivingYards: 12, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0,
  }], [{ playerId: aliases.get("PlayPa00")!, gameId: sourceGame, offensePct: 0.71 }], 1, "season",
  new Map([["KC", 1]]), new Map([["KC", [sourceGame]]]));
  assert.equal(usage[0]?.aggregate.snapShare.value, 0.71);
});

test("aggregation keeps traded player histories separate by team", () => {
  const rows = [
    { playerId: "p1", playerName: "Traded", position: "WR", teamId: "KC", gameId: "g1", season: 2024, week: 1, seasonType: "REG", targets: 5, receptions: 5, receivingYards: 50, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0 },
    { playerId: "p1", playerName: "Traded", position: "WR", teamId: "BUF", gameId: "g2", season: 2024, week: 2, seasonType: "REG", targets: 2, receptions: 1, receivingYards: 10, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0 },
  ];
  const usage = aggregatePlayerUsage(rows, [], 1, "season", new Map([["KC", 1], ["BUF", 1]]), new Map([["KC", ["g1"]], ["BUF", ["g2"]]]));
  assert.equal(usage.length, 2);
  assert.deepEqual(usage.map((player) => player.teamId).sort(), ["BUF", "KC"]);
});

test("short rolling windows compare sparse history with the bounded request", () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    playerId: "p1", playerName: "Receiver", position: "WR", teamId: "T", gameId: `g${index}`,
    season: 2025, week: index + 1, seasonType: "REG", targets: 1, receptions: 1,
    receivingYards: 5, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0,
  }));
  const result = aggregatePlayerUsage(rows, [], 10, "last3", new Map([["T", 10]]))[0];
  assert.equal(result?.sourceCoverage.requestedGames, 3);
  assert.deepEqual(result?.sourceCoverage.partialReasons, []);
});

test("team-game windows do not backfill a missing latest player appearance", () => {
  const rows = ["g1", "g2", "g3"].map((gameId, index) => ({
    playerId: "p1", playerName: "Receiver", position: "WR", teamId: "T", gameId,
    season: 2026, week: index + 1, seasonType: "REG", targets: 1, receptions: 1,
    receivingYards: 5, carries: 0, rushingYards: 0, rushingTds: 0, receivingTds: 0,
  }));
  const result = aggregatePlayerUsage(
    rows, [], 4, "last3",
    new Map([["T", 4]]),
    new Map([["T", ["g1", "g2", "g3", "g4"]]]),
  )[0];
  assert.deepEqual(result?.games.map((game) => game.gameId), ["g2", "g3"]);
  assert.equal(result?.sourceCoverage.requestedGames, 3);
  assert.equal(result?.sourceCoverage.includedGames, 2);
  assert.deepEqual(result?.sourceCoverage.partialReasons, ["Some requested games have no persisted player-game record"]);
});

test("usage game cutoffs exclude future games and order by kickoff rather than week", () => {
  const cutoff = new Date("2026-09-20T17:00:00Z");
  const games = [
    { gameId: "week-1-postponed", season: 2026, week: 1, kickoffTime: new Date("2026-09-20T20:00:00Z") },
    { gameId: "week-3", season: 2026, week: 3, kickoffTime: new Date("2026-09-13T17:00:00Z") },
    { gameId: "week-2", season: 2026, week: 2, kickoffTime: new Date("2026-09-06T17:00:00Z") },
    { gameId: "selected", season: 2026, week: 4, kickoffTime: cutoff },
    { gameId: "old-season", season: 2025, week: 1, kickoffTime: new Date("2025-09-13T17:00:00Z") },
    { gameId: "unknown", season: 2026, week: 1, kickoffTime: null },
  ];
  assert.deepEqual(
    eligibleUsageGames(games, 2026, cutoff, "selected").map((game) => game.gameId),
    ["week-2", "week-3"],
  );
});

test("usage eligibility excludes stale seasons and rows outside completed games", () => {
  const rows = [
    { season: 2025, gameId: "old", playerId: "stale" },
    { season: 2026, gameId: "completed", playerId: "current" },
    { season: 2026, gameId: "future", playerId: "future" },
  ];
  assert.deepEqual(
    eligibleUsageRows(rows, 2026, new Set(["completed"]), false).map((row) => row.playerId),
    ["current"],
  );
  assert.deepEqual(
    eligibleUsageRows(rows, 2026, new Set(), true).map((row) => row.playerId),
    ["current", "future"],
  );
});

test("default usage season follows the NFL season at the cutoff", () => {
  assert.equal(usageSeasonAtCutoff(new Date("2026-09-17T12:00:00Z")), 2026);
  assert.equal(usageSeasonAtCutoff(new Date("2027-01-20T12:00:00Z")), 2026);
  assert.equal(usageSeasonAtCutoff(new Date("2027-03-01T12:00:00Z")), 2027);
});

test("player usage payload validates generated contract with explicit unsupported metrics", () => {
  const payload = {
    status: "partial",
    season: 2026,
    players: [],
    availableTeams: [{ teamId: "12", abbreviation: "KC" }],
    filters: { team: null, position: "WR", game: null, window: "last5" },
    metricAvailability: { redZoneTouches: false, redZoneTargets: false, explosiveRate: false },
    sourceCoverage: { requestedGames: 5, includedGames: 0, partialReasons: ["No completed games"] },
  };
  assert.equal(GetConsumerPlayerUsageResponse.safeParse(payload).success, true);
});

test("consumer scores appear only for completed games", () => {
  assert.equal(consumerFinalScore({
    gameStatus: "STATUS_SCHEDULED",
    finalHomeScore: 0,
    finalAwayScore: 0,
  }), null);
  assert.deepEqual(consumerFinalScore({
    gameStatus: "STATUS_FINAL",
    finalHomeScore: 27,
    finalAwayScore: 20,
  }), { home: 27, away: 20 });
});

test("consumer record verification never labels 32 all-zero records verified", () => {
  const records = Array.from({ length: 32 }, (_, index) => ({
    teamId: String(index), abbreviation: `T${index}`, teamName: `Team ${index}`,
    wins: 0, losses: 0, ties: 0, games: 0,
  }));
  const verification = verifyTeamRecords(records, { targetWeek: 2, completedPriorGames: 0 });
  assert.equal(verification.complete, false);
  assert.ok(verification.discrepancies.length > 0);
});

test("consumer market quotes use deterministic, explicitly labeled sides", () => {
  const quote = (sportsbook: string, selection: string, point: number | null, price: number) => ({
    sportsbook,
    selection,
    point,
    price,
    capturedAt: "2026-09-01T12:00:00.000Z",
  });
  const market = consumerMarket({
    marketSnapshot: {
      markets: {
        spread: { quotes: [quote("DraftKings", "Away Team", -3, -105), quote("DraftKings", "Home Team", 3, -115)] },
        moneyline: { quotes: [quote("DraftKings", "Away Team", null, 130), quote("DraftKings", "Home Team", null, -145)] },
        total: { quotes: [quote("DraftKings", "Under", 44.5, -108), quote("DraftKings", "Over", 44.5, -112)] },
      },
    },
  } as any, { teamId: "home", name: "Home Team", abbreviation: "HME" });

  assert.deepEqual(market.spread && { selection: market.spread.selection, point: market.spread.point, price: market.spread.price }, { selection: "HME", point: 3, price: -115 });
  assert.deepEqual(market.moneyline && { selection: market.moneyline.selection, price: market.moneyline.price }, { selection: "HME", price: -145 });
  assert.deepEqual(market.total && { selection: market.total.selection, point: market.total.point, price: market.total.price }, { selection: "Over", point: 44.5, price: -112 });
});

test("consumer movement preserves chronology, price-only changes, and legitimate A-B-A history", () => {
  const movement = serializeMovement([
    {
      sportsbook: "DraftKings",
      market: "spread",
      selection: "Home",
      point: -3,
      price: -110,
      capturedAt: new Date("2026-09-01T12:00:00Z"),
    },
    {
      sportsbook: "DraftKings",
      market: "spread",
      selection: "Home",
      point: -2.5,
      price: -105,
      capturedAt: new Date("2026-09-01T13:00:00Z"),
    },
    {
      sportsbook: "DraftKings",
      market: "spread",
      selection: "Home",
      point: -3,
      price: -108,
      capturedAt: new Date("2026-09-01T14:00:00Z"),
    },
  ], new Date("2026-09-01T13:30:00Z"));

  assert.equal(movement.available, true);
  assert.deepEqual(movement.streams[0]?.observations.map(({ point, price }) => ({ point, price })), [
    { point: -3, price: -110 },
    { point: -2.5, price: -105 },
    { point: -3, price: -108 },
  ]);
  assert.equal(movement.streams[0]?.firstObserved.capturedAt, "2026-09-01T12:00:00.000Z");
  assert.equal(movement.streams[0]?.current.price, -108);
  assert.equal(movement.streams[0]?.finalPreKickoff?.price, -105);
  assert.doesNotMatch(JSON.stringify(movement), /"id"|"observationKey"|"stateHash"/);
});

test("future games do not expose a final pre-kickoff quote; completed games expose only recorded pre-kickoff history", () => {
  const rows = [
    boardRow("DraftKings", "spread", "Home", -3, -110, "2026-09-01T12:00:00Z"),
    boardRow("DraftKings", "spread", "Home", -3, -105, "2026-09-01T13:00:00Z"),
    boardRow("DraftKings", "spread", "Home", -2.5, -110, "2026-09-01T15:00:00Z"),
  ];
  const kickoff = new Date("2026-09-01T14:00:00Z");
  const future = serializeMovement(rows, kickoff, new Date("2026-09-01T13:30:00Z"));
  assert.equal(future.streams[0]?.finalPreKickoff, null);
  assert.equal(future.streams[0]?.firstObserved.price, -110);
  assert.equal(future.streams[0]?.current.point, -2.5);
  const final = serializeMovement(rows, kickoff, new Date("2026-09-01T16:00:00Z"));
  assert.equal(final.streams[0]?.finalPreKickoff?.price, -105);
  assert.equal(final.streams[0]?.current.point, -2.5);
});

test("Washington–Seattle persisted spread/total score and independent moneyline orientation", () => {
  const homeMargin = -0.7257358100211451;
  const total = 44.954963921603145;
  const homeProbability = 0.3432441400949979;
  assert.ok(Math.abs((total + homeMargin) / 2 - 22.114614055791) < 1e-9);
  assert.ok(Math.abs((total - homeMargin) / 2 - 22.840349865812144) < 1e-9);
  assert.ok(Math.abs((1 - homeProbability) * 100 - 65.67558599050021) < 1e-9);
});

test("consumer movement and context use explicit unavailable states", () => {
  assert.deepEqual(serializeMovement([]), {
    available: false,
    streams: [],
    completeness: {
      status: "complete",
      maximumObservations: 200,
      totalObservations: 0,
      returnedObservations: 0,
      omittedObservations: 0,
    },
    message: "Line history is not yet available for DraftKings or FanDuel",
  });
  assert.deepEqual(serializeContext(null, "home-id", "away-id"), {
    available: false,
    dataConfidence: null,
    teams: [],
    drivers: [],
    projectedMatchups: [],
    matchupMessage: "Matchup projection not yet available.",
    message: "Player information temporarily unavailable",
    modelPersonnelLimitation: { active: false, reason: null, recommendationSuppressed: false },
  });
});

test("consumer movement reports truncation while retaining true summaries", () => {
  const rows = Array.from({ length: MAX_CONSUMER_MOVEMENT_ROWS + 1 }, (_, index) => ({
    sportsbook: "DraftKings",
    market: "spread",
    selection: "Home",
    point: -3,
    price: -110 + (index % 2),
    capturedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
  }));
  const movement = serializeMovement(rows);
  assert.equal(movement.completeness.status, "truncated");
  assert.equal(movement.completeness.omittedObservations, 1);
  assert.equal(movement.streams[0]?.observations.length, MAX_CONSUMER_MOVEMENT_ROWS);
  assert.equal(movement.streams[0]?.firstObserved.capturedAt, rows[0]?.capturedAt.toISOString());
});

test("consumer movement groups books and selections and excludes unsupported sources", () => {
  const at = new Date("2026-09-01T12:00:00Z");
  const movement = serializeMovement([
    { sportsbook: "FanDuel", market: "total", selection: "Over", point: 44.5, price: -110, capturedAt: at },
    { sportsbook: "DraftKings", market: "total", selection: "Under", point: 44.5, price: -105, capturedAt: at },
    { sportsbook: "OtherBook", market: "total", selection: "Over", point: 45, price: -110, capturedAt: at },
  ]);
  assert.deepEqual(movement.streams.map(({ sportsbook, selection }) => ({ sportsbook, selection })), [
    { sportsbook: "DraftKings", selection: "Under" },
    { sportsbook: "FanDuel", selection: "Over" },
  ]);
  assert.equal(movement.streams[0]?.finalPreKickoff, null);
});

test("consumer context is concise and excludes raw personnel evidence", () => {
  const serialized = serializeContext({
    dataConfidence: { overall: 72 },
    teams: {
      home: {
        teamName: "Home Team",
        abbreviation: "HOM",
        starters: [{
          playerName: "Safe Player",
          position: "WR",
          unit: "wide_receiver",
          estimatedDepthPosition: 1,
          classification: "published_secondary",
          confidence: 82,
          recentSnapShare: 0.72,
          injuryStatus: { gameStatus: "Questionable", practiceStatus: "Limited" },
          recentStarterEvidence: ["Listed first on the latest supported depth chart."],
        }],
        qb: { starterCertainty: 81, starterChange: true, projectedStarter: { playerId: "qb-home" } },
        injuries: { offense: { impactScore: 30 }, defense: { impactScore: 8 } },
        injuryPlayers: [{ playerId: "injured-home" }],
        personnelCompleteness: 90,
      },
      away: {
        qb: { starterCertainty: 75, starterChange: false, projectedStarter: { playerId: "qb-away" } },
        injuries: { offense: { impactScore: 5 }, defense: { impactScore: 28 } },
        injuryPlayers: [{ playerId: "injured-away" }],
        personnelCompleteness: 85,
      },
    },
  }, "home", "away");

  assert.equal(serialized.available, true);
  assert.equal(serialized.teams.length, 2);
  assert.equal(serialized.teams[0]?.depth[0]?.name, "Safe Player");
  assert.equal(serialized.teams[0]?.depth[0]?.role, "published_starter");
  assert.equal(serialized.teams[0]?.qbEvidenceAvailable, true);
  assert.equal(serialized.teams[0]?.injuryEvidenceAvailable, true);
  assert.deepEqual(serialized.projectedMatchups, []);
  assert.equal(serialized.matchupMessage, "Matchup projection not yet available.");
  assert.ok(serialized.drivers.length <= 4);
  assert.doesNotMatch(JSON.stringify(serialized), /playerId|sourceUrl|featureAudit|modelVersion|unavailableReasons/);
});

test("consumer context preserves absence flags for derived personnel zeroes", () => {
  const serialized = serializeContext({
    teams: {
      home: {
        qb: { starterCertainty: 0, starterChange: false },
        injuries: { offense: { impactScore: 0 }, defense: { impactScore: 0 } },
        injuryPlayers: [],
        personnelCompleteness: 0,
      },
      away: {
        qb: { starterCertainty: 75, starterChange: false, projectedStarter: { playerId: "qb-away" } },
        injuries: { offense: { impactScore: 8 }, defense: { impactScore: 4 } },
        injuryPlayers: [{ playerId: "injured-away" }],
        personnelCompleteness: 80,
      },
    },
  }, "home", "away");
  assert.equal(serialized.teams[0]?.qbEvidenceAvailable, false);
  assert.equal(serialized.teams[0]?.injuryEvidenceAvailable, false);
  assert.equal(serialized.teams[1]?.qbEvidenceAvailable, true);
  assert.equal(serialized.teams[1]?.injuryEvidenceAvailable, true);
});

test("consumer context serializes dual receiver slots and a partial cutoff-safe injury report", () => {
  const serialized = serializeContext({
    sourceCutoff: "2026-09-17T11:59:59.999Z",
    teams: {
      home: {
        teamName: "Buffalo Bills", abbreviation: "BUF",
        starters: [
          { playerName: "Receiver One", position: "WR", lineupSlot: "LWR", estimatedDepthPosition: 1, classification: "published_secondary", dataFreshness: "fresh", snapshotTimestamp: "2026-09-17T10:00:00.000Z" },
          { playerName: "Receiver Two", position: "WR", lineupSlot: "RWR", estimatedDepthPosition: 1, classification: "published_secondary", dataFreshness: "fresh", snapshotTimestamp: "2026-09-17T10:00:00.000Z" },
        ],
        injuryPlayers: [{
          playerName: "Current Player", position: "WR", injury: "Hamstring",
          gameStatus: "Questionable", practiceStatus: null, snapshotTimestamp: "2026-09-17T09:00:00.000Z",
        }],
      },
    },
  }, "home", "away");
  assert.deepEqual(serialized.teams[0]?.depth.map((row) => row.lineupSlot), ["LWR", "RWR"]);
  assert.equal(serialized.teams[0]?.injuryReportStatus, "partial");
  assert.deepEqual(serialized.teams[0]?.injuries[0], {
    name: "Current Player", position: "WR", injury: "Hamstring", gameStatus: "Questionable",
    practiceStatus: null, asOf: "2026-09-17T09:00:00.000Z", sourceLabel: "ESPN injury report",
  });
  assert.equal(serialized.teams[0]?.asOf, "2026-09-17T11:59:59.999Z");
});

test("live season-bound personnel replaces stale persisted Buffalo starters", () => {
  const persisted = serializeContext({
    teams: {
      home: {
        starters: [{ playerName: "Devin Singletary", position: "RB", estimatedDepthPosition: 1, classification: "published_secondary" }],
      },
    },
  }, "home", "away");
  const player = (name: string, position: string, role: string) => ({
    playerId: name, playerName: name, teamId: "home", position, unit: "offense", role, rank: 1,
    starter: true, source: "sleeper", sourceClassification: "published_secondary" as const,
    providerLabel: "Sleeper published secondary depth signal", providerEvidence: [{
      source: "sleeper", classification: "published_secondary" as const, rank: 1, capturedAt: "2026-09-17T10:00:00.000Z",
    }],
    recentSnapShare: null, recentGames: 0,
    injuryState: { injury: null, practiceStatus: null, gameStatus: null, asOf: null, source: null, sleeperStatus: null, sleeperInjuryStatus: null, sleeperPracticeParticipation: null },
    confidence: 80, explanation: ["Current 2026 evidence."], conflicts: [],
  });
  const team = {
    teamId: "home", teamName: "Buffalo Bills", abbreviation: "BUF", asOf: "2026-09-17T11:00:00.000Z",
    freshness: "current" as const, sourcePrecedence: [], qbStarter: { status: "unavailable" as const, player: null, confidence: 0, supportingEvidence: [], conflicts: [], unavailableReason: "Unavailable" },
    depth: { offense: [player("James Cook", "RB", "RB"), player("Receiver One", "WR", "LWR"), player("Receiver Two", "WR", "RWR")], defense: [], specialTeams: [], unknown: [] },
    wrRoles: [], cbRoles: [], conflicts: [], positionalCoverage: {}, downstreamReady: false, unavailableReasons: [],
    injuryReport: [],
  };
  const result = applyCurrentPersonnelToConsumerContext(persisted, {
    asOf: team.asOf, teams: { home: team, away: null },
  });
  assert.equal(result.teams[0]?.depth.some((row) => row.name === "Devin Singletary"), false);
  assert.equal(result.teams[0]?.depth.find((row) => row.position === "RB")?.name, "James Cook");
  assert.deepEqual(result.teams[0]?.depth.filter((row) => row.position === "WR").map((row) => row.lineupSlot), ["LWR", "RWR"]);
});

test("live personnel is exposed when persisted model context is absent", () => {
  const empty = serializeContext(null, "home", "away");
  const team = {
    teamId: "home", teamName: "Buffalo Bills", abbreviation: "BUF", asOf: "2026-09-17T11:00:00.000Z",
    freshness: "current" as const, sourcePrecedence: [], qbStarter: { status: "unavailable" as const, player: null, confidence: 0, supportingEvidence: [], conflicts: [], unavailableReason: "Unavailable" },
    depth: { offense: [{
      playerId: "cook", playerName: "James Cook", teamId: "home", position: "RB", unit: "backfield", role: "RB", rank: 1,
      starter: true, source: "sleeper", sourceClassification: "published_secondary" as const,
      providerLabel: "Sleeper published secondary depth signal", providerEvidence: [{
        source: "sleeper", classification: "published_secondary" as const, rank: 1, capturedAt: "2026-09-17T10:00:00.000Z",
      }], recentSnapShare: null, recentGames: 0,
      injuryState: { injury: null, practiceStatus: null, gameStatus: null, asOf: null, source: null, sleeperStatus: null, sleeperInjuryStatus: null, sleeperPracticeParticipation: null },
      confidence: 80, explanation: ["Current 2026 evidence."], conflicts: [],
    }], defense: [], specialTeams: [], unknown: [] },
    wrRoles: [], cbRoles: [], conflicts: [], positionalCoverage: {}, downstreamReady: false, unavailableReasons: [],
    injuryReport: [],
  };
  const result = applyCurrentPersonnelToConsumerContext(empty, {
    asOf: team.asOf, teams: { home: team, away: null },
  });
  assert.equal(result.available, true);
  assert.equal(result.teams.length, 2);
  assert.equal(result.teams[0]?.depth[0]?.name, "James Cook");
  assert.equal(result.message, null);
});

test("curated context selects replacement QB, RB committee and flags unavailable WR", () => {
  const cutoff = new Date("2026-09-17T12:00:00.000Z");
  const source = (playerId: string, playerName: string, position: string, depthOrder: number, role = position) => ({
    playerId, playerName, teamId: "home", sourceTeamId: "HOM", position, role, depthOrder,
    source: "sleeper" as const, classification: "published_secondary" as const,
    capturedAt: "2026-09-17T10:00:00.000Z", sourceUpdatedAt: "2026-09-17T10:00:00.000Z",
    mappingStatus: "exact_provider_id", mappingConfidence: 1,
  });
  const current = deriveCurrentTeamDepth({
    teamId: "home", abbreviation: "HOM", cutoff, season: 2026,
    publishedDepth: [
      source("daniels", "Jayden Daniels", "QB", 1), source("mariota", "Marcus Mariota", "QB", 2),
      source("rb1", "Back One", "RB", 1), source("rb2", "Back Two", "RB", 2),
      source("te", "Tight End", "TE", 1),
      source("wr1", "Unavailable Receiver", "WR", 1), source("wr2", "Receiver Two", "WR", 2),
      source("edge", "Edge Defender", "EDGE", 1), source("dt", "Defensive Tackle", "DT", 1),
      source("lb", "Linebacker", "LB", 1), source("cb", "Cornerback", "CB", 1),
      source("s", "Safety", "S", 1),
    ],
    snaps: [], historicalDepth: [],
    injuries: [{
      playerId: "daniels", teamId: "home", position: "QB", gameStatus: "Out",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }, {
      playerId: "mariota", teamId: "home", position: "QB", gameStatus: "Active",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }, {
      playerId: "wr1", teamId: "home", position: "WR", gameStatus: "Out",
      snapshotTimestamp: "2026-09-17T11:00:00.000Z", sourceUpdatedAt: "2026-09-17T11:00:00.000Z",
    }],
    playerNames: { daniels: "Jayden Daniels", mariota: "Marcus Mariota", wr1: "Unavailable Receiver" },
  });
  current.depth.offense.find((player) => player.playerId === "rb1")!.recentSnapShare = 0.52;
  current.depth.offense.find((player) => player.playerId === "rb2")!.recentSnapShare = 0.38;
  const context = applyCurrentPersonnelToConsumerContext(serializeContext(null, "home", "away"), {
    asOf: cutoff.toISOString(), teams: { home: current, away: null },
  });
  const home = context.teams.find((team) => team.side === "home")!;
  assert.deepEqual(home.expectedQb, {
    name: "Marcus Mariota", status: "available", availability: "available", confidence: current.qbStarter.confidence,
    asOf: "2026-09-17T11:00:00.000Z", confirmed: true,
  });
  assert.equal(home.currentOffenseRoles.runningBackCommittee.players.length, 2);
  assert.equal(home.currentOffenseRoles.runningBackCommittee.status, "confirmed");
  assert.equal(home.currentOffenseRoles.primaryTe.name, "Tight End");
  assert.equal(home.currentOffenseRoles.wr1.name, "Unavailable Receiver");
  assert.equal(home.currentOffenseRoles.wr1.availability, "unavailable");
  assert.equal(home.currentOffenseRoles.wr1.confirmed, false);
  assert.equal(home.currentOffenseRoles.wr2.name, "Receiver Two");
  assert.deepEqual(home.defensiveGroupings.front.map((player) => player.position).sort(), ["DT", "EDGE"]);
  assert.deepEqual(home.defensiveGroupings.linebackers.map((player) => player.position), ["LB"]);
  assert.deepEqual(home.defensiveGroupings.corners.map((player) => player.position), ["CB"]);
  assert.deepEqual(home.defensiveGroupings.safeties.map((player) => player.position), ["S"]);
  current.depth.offense.find((player) => player.playerId === "rb2")!.recentSnapShare = null;
  const leadOnly = applyCurrentPersonnelToConsumerContext(serializeContext(null, "home", "away"), {
    asOf: cutoff.toISOString(), teams: { home: current, away: null },
  }).teams[0]!;
  assert.deepEqual(leadOnly.currentOffenseRoles.runningBackCommittee.players.map((player) => player.name), ["Back One"]);
});

test("defensive groupings retain distinct 3-4 and 4-3 fronts without guessed roles", () => {
  const cutoff = new Date("2026-09-17T12:00:00.000Z");
  const source = (id: string, pos: string, rank: number) => ({
    playerId: id, playerName: id, teamId: "team", sourceTeamId: "TST",
    position: pos, role: pos, depthOrder: rank, source: "sleeper" as const,
    classification: "published_secondary" as const, capturedAt: "2026-09-17T10:00:00.000Z",
    mappingStatus: "exact_provider_id", mappingConfidence: 1,
  });
  const make = (positions: string[]) => deriveCurrentTeamDepth({
    teamId: "team", cutoff, season: 2026,
    publishedDepth: positions.map((position, index) => source(`${position}-${index}`, position, index + 1)),
    snaps: [], historicalDepth: [], injuries: [],
  });
  const threeFour = make(["NT", "DE", "EDGE", "LB", "ILB", "CB", "S"]);
  const fourThree = make(["DT", "DE", "EDGE", "LB", "LB", "CB", "FS", "SS"]);
  const serialize = (team: ReturnType<typeof make>) => applyCurrentPersonnelToConsumerContext(
    serializeContext(null, "home", "away"), { asOf: team.asOf, teams: { home: team, away: null } },
  ).teams[0]!;
  assert.deepEqual(serialize(threeFour).defensiveGroupings.front.map((player) => player.position).sort(), ["DT", "EDGE", "EDGE"]);
  assert.deepEqual(serialize(threeFour).defensiveGroupings.front.map((player) => player.role).sort(), ["DE", "EDGE", "NT"]);
  assert.deepEqual(serialize(threeFour).defensiveGroupings.linebackers.map((player) => player.position).sort(), ["LB", "LB"]);
  assert.deepEqual(serialize(threeFour).defensiveGroupings.linebackers.map((player) => player.role).sort(), ["ILB", "LB"]);
  assert.deepEqual(serialize(fourThree).defensiveGroupings.front.map((player) => player.position).sort(), ["DT", "EDGE", "EDGE"]);
  assert.deepEqual(serialize(fourThree).defensiveGroupings.safeties.map((player) => player.role).sort(), ["FS", "SS"]);
});

test("QB model limitation compares explicit cutoff-safe identity only", () => {
  const current = {
    teamId: "home", teamName: "Home", abbreviation: "HOM", asOf: "2026-09-17T11:00:00.000Z",
    freshness: "current" as const,
    qbStarter: { status: "available" as const, player: { playerId: "mariota", playerName: "Marcus Mariota" } as any },
  } as any;
  const predictionTimestamp = new Date("2026-09-15T15:00:00.000Z");
  const evidence = (qbId: string) => ({
    rows: [{
      isHome: true, teamId: "home", opponentTeamId: "away",
      sourceCutoff: "2026-09-15T14:59:59.000Z", generatedAt: "2026-09-15T15:00:00.000Z",
      selectedAudit: { _personnel_context: { teams: { home: { qb: { projectedStarter: { playerId: qbId } } } } } },
    }, {
      isHome: false, teamId: "away", opponentTeamId: "home",
      sourceCutoff: "2026-09-15T14:59:59.000Z", generatedAt: "2026-09-15T15:00:00.000Z",
      selectedAudit: {},
    }],
  });
  const base = {
    predictionTimestamp, kickoffTime: new Date("2026-09-24T17:00:00.000Z"),
    homeTeamId: "home", awayTeamId: "away", current: { home: current, away: null },
  };
  assert.equal(currentModelPersonnelLimitation({ ...base, savedInputSourceEvidence: evidence("daniels") }).recommendationSuppressed, true);
  assert.equal(currentModelPersonnelLimitation({ ...base, savedInputSourceEvidence: evidence("mariota") }).active, false);
  const noNamedQb = currentModelPersonnelLimitation({
    ...base, savedInputSourceEvidence: { rows: [{ selectedValues: { qb_confidence_difference: 0 } }] },
  });
  assert.equal(noNamedQb.active, true);
  assert.equal(noNamedQb.recommendationSuppressed, false);
  assert.match(noNamedQb.reason ?? "", /does not retain a named quarterback identity/);
  const futureEvidence = evidence("daniels");
  futureEvidence.rows[0]!.sourceCutoff = "2026-09-17T11:00:00.000Z";
  assert.equal(currentModelPersonnelLimitation({ ...base, savedInputSourceEvidence: futureEvidence }).recommendationSuppressed, false);
});

test("named QB-less snapshot warns unless cutoff-safe personnel confirms a post-snapshot change", () => {
  const predictionTimestamp = new Date("2026-09-17T15:00:00.000Z");
  const player = (playerId: string, capturedAt: string, rank: number) => ({
    playerId, playerName: playerId === "daniels" ? "Jayden Daniels" : "Marcus Mariota",
    position: "QB", rank, sourceClassification: "published_secondary" as const,
    providerEvidence: [{ capturedAt }],
    conflicts: [],
  });
  const current = {
    home: {
      asOf: "2026-09-24T11:00:00.000Z", freshness: "current" as const,
      qbStarter: { status: "available" as const, player: player("mariota", "2026-09-24T10:00:00.000Z", 1) },
    },
    away: null,
  } as any;
  const historical = {
    home: {
      asOf: predictionTimestamp.toISOString(), freshness: "current" as const,
      qbStarter: { status: "available" as const, player: player("daniels", "2026-09-17T11:00:00.000Z", 1) },
    },
    away: null,
  } as any;
  const result = currentModelPersonnelLimitation({
    savedInputSourceEvidence: { rows: [{ selectedValues: { qb_confidence_difference: 0 } }] },
    predictionTimestamp, kickoffTime: new Date("2026-09-24T17:00:00.000Z"),
    homeTeamId: "home", awayTeamId: "away", current, historical,
  });
  assert.equal(result.active, true);
  assert.equal(result.recommendationSuppressed, true);
  assert.match(result.reason ?? "", /saved model input does not retain a named quarterback identity/);

  const noTransition = currentModelPersonnelLimitation({
    savedInputSourceEvidence: { rows: [{ selectedValues: { qb_confidence_difference: 0 } }] },
    predictionTimestamp, kickoffTime: new Date("2026-09-24T17:00:00.000Z"),
    homeTeamId: "home", awayTeamId: "away", current, historical: null,
  });
  assert.equal(noTransition.active, true);
  assert.equal(noTransition.recommendationSuppressed, false);
});

test("confirmed QB mismatch withholds recommendations without modifying projections", () => {
  const savedProjection = {
    projectedHomeScore: 22.1146,
    projectedAwayScore: 22.8403,
    projectedMargin: -0.7257,
    projectedTotal: 44.9549,
    homeWinProbability: 0.3432,
  };
  const recommendation = {
    status: "healthy" as const, reason: null,
    markets: { spread: true, total: true, moneyline: true },
  };
  const limitation = { active: true, reason: "Saved personnel identity differs.", recommendationSuppressed: true };
  assert.deepEqual(applyModelPersonnelLimitationToRecommendation(recommendation, limitation), {
    status: "unavailable", reason: limitation.reason,
    markets: { spread: false, total: false, moneyline: false },
  });
  assert.deepEqual(applyModelPersonnelLimitationToRecommendation(recommendation, {
    active: true, reason: "No saved named QB.", recommendationSuppressed: false,
  }), recommendation);
  assert.deepEqual(savedProjection, {
    projectedHomeScore: 22.1146, projectedAwayScore: 22.8403,
    projectedMargin: -0.7257, projectedTotal: 44.9549, homeWinProbability: 0.3432,
  });
});

test("consumer performance is whitelisted and matches generated response contracts", () => {
  const performance = serializePerformance({
    status: "measured",
    windowTruncated: false,
    officialPredictions: 12,
    gradedPredictions: 10,
    byFamily: {
      spread: { predictions: 10, mae: 6.1, rmse: 8, avgClv: null },
      moneyline: { predictions: 10, accuracy: 0.6, brier: 0.21, logLoss: 0.62 },
      totals: { predictions: 10, mae: 7.2, rmse: 9.1, avgClv: 0.4 },
    },
    breakdowns: {
      season: [{ group: "2025", predictions: 10, spreadMae: 6.1, totalsMae: 7.2, moneylineAccuracy: 0.6, avgClv: null }],
      week: [],
      model: [{ group: "internal-model-version", predictions: 10, spreadMae: 6.1, totalsMae: 7.2, moneylineAccuracy: 0.6, avgClv: null }],
      edge: [],
      homeAway: [],
      favoriteUnderdog: [],
      sampleQuality: [],
      qbConfidence: [],
    },
    note: "internal note",
  });

  assert.equal(GetConsumerPerformanceResponse.safeParse(performance).success, true);
  assert.equal(GetConsumerTrendsResponse.safeParse({
    status: performance.status,
    byWeek: performance.breakdowns.week,
    byConfidence: performance.breakdowns.confidence,
    byEdge: performance.breakdowns.edge,
    window: performance.window,
    note: "Trends are derived from persisted, graded official predictions only.",
  }).success, true);
  assert.doesNotMatch(JSON.stringify(performance), /internal-model-version|modelVersion|internal note/);
});

test("generated contracts accept representative list, dashboard, detail, and unavailable payloads", () => {
  const source = {
    status: "unavailable" as const,
    lastAttemptAt: null, lastSuccessAt: null, sourceTimestamp: null,
    lastAttemptStatus: null, message: "No observations", staleAfterMinutes: 15,
  };
  const sourceHealth = { status: "unavailable" as const, sources: {
    schedule: source, injuries: source, odds: source, players: source,
  } };
  const game = {
    gameId: "game-1",
    season: 2026,
    week: 1,
    kickoffTime: "2026-09-20T17:00:00.000Z",
    gameStatus: "STATUS_SCHEDULED",
    gameState: "pregame" as const,
    venue: null,
    matchup: {
      home: { name: "Home", abbreviation: "HME", logoUrl: null },
      away: { name: "Away", abbreviation: "AWY", logoUrl: null },
    },
    finalScore: null,
    prediction: null,
    market: {
      spread: null,
      moneyline: null,
      total: null,
      evidence: { available: false, capturedAt: null, message: "Sportsbook line updating" },
    },
    marketBoard: {
      status: "absent" as const,
      staleAfterMinutes: 15,
      selectionRule: "Best means the most favorable canonical line point, then the higher American price when points match; exact ties prefer DraftKings.",
      comparisons: (["spread", "total", "moneyline"] as const).map((market) => ({
        market,
        label: market,
        state: "absent" as const,
        modelValue: null,
        marketValue: null,
        difference: null,
        differenceUnit: market === "moneyline" ? "probability_points" as const : "points" as const,
        selectedQuote: null,
        currentQuotes: [],
        firstObserved: null,
        current: null,
        modelTimestamp: null,
        marketTimestamp: null,
        observationAgeMinutes: null,
        freshnessLabel: "Sportsbook line updating",
      })),
    },
    recommendation: { status: "unavailable" as const, reason: "No complete market", markets: {
      spread: false, total: false, moneyline: false,
    } },
    dataConfidence: { label: "Updating" as const, score: null, reason: "Prediction data is being refreshed" },
    confidence: {
      markets: (["spread", "moneyline", "total"] as const).map((market) => ({
        market,
        score: 0,
        label: "Low" as const,
        explanation: "Low confidence; required evidence is unavailable.",
        components: [
          { key: "data" as const, label: "Data Confidence", score: null, summary: "Unavailable" },
          { key: "model" as const, label: "Model Confidence", score: null, summary: "Unavailable" },
          { key: "marketEdge" as const, label: "Market Edge Strength", score: null, summary: "Unavailable" },
        ],
        evidence: {},
        downgradeReasons: ["Required evidence is unavailable"],
        calculatedAt: "2026-09-17T12:00:00.000Z",
      })),
    },
    availability: { prediction: "Prediction pending — incomplete model inputs", market: "Sportsbook line updating" },
  };
  const detail = {
    ...game,
    weather: {
      available: false,
      summary: null,
      temperature: null,
      sustainedWind: null,
      windGust: null,
      precipitationProbability: null,
      precipitationType: null,
      humidity: null,
      indoorOutdoor: null,
      roofStatus: null,
      validTime: null,
      message: "Weather not yet available",
    },
    movement: serializeMovement([]),
    context: serializeContext(null, "home", "away"),
    keyPlayers: [],
    matchupBoard: {
      status: "unavailable" as const,
      sourceCutoff: "2026-09-20T16:59:59.999Z",
      completeness: { supportedCategories: 0, totalCategories: 10 },
      sources: ["nflverse team game stats"],
      methodology: "Only persisted evidence available before the game cutoff is used.",
      summary: [],
      assessments: Array.from({ length: 10 }, (_, index) => ({
        category: `category-${index}`,
        title: `Category ${index}`,
        edge: "insufficient" as const,
        edgeLabel: "Insufficient data",
        confidence: "unavailable" as const,
        strength: null,
        metrics: [],
        explanation: "No supported comparison.",
        coverage: "Verified evidence unavailable",
        limitations: ["Evidence unavailable"],
      })),
    },
    analysis: {
      drivers: [],
      availability: {
        weather: "Weather not yet available",
        personnel: "Player information temporarily unavailable",
        movement: "Line history is not yet available for DraftKings or FanDuel",
      },
    },
  };

  const routesDirectory = path.join(fileURLToPath(new URL("../../", import.meta.url)), "src/routes");
  const routeSource = readFileSync(path.join(routesDirectory, "consumer.ts"), "utf8");
  const predictionSource = readFileSync(path.join(routesDirectory, "../lib/live-predictions.ts"), "utf8");
  assert.equal(ListConsumerGamesResponse.safeParse({
    status: "absent",
    coverage: { games: 1, gamesWithComparison: 0, DraftKings: 0, FanDuel: 0 },
    games: [game],
    sourceHealth,
    teamRecords: [],
    recordVerification: {
      expectedTeamCount: 32,
      actualTeamCount: 0,
      targetWeek: 1,
      completedPriorGames: 0,
      complete: false,
      discrepancies: ["Expected 32 teams, found 0"],
    },
  }).success, true);
  assert.equal(GetConsumerDashboardResponse.safeParse({
    status: "available",
    games: [game],
    sourceHealth,
    note: "Persisted snapshots only",
  }).success, true);
  assert.equal(GetConsumerGameResponse.safeParse({ ...detail, sourceHealth }).success, true);
  assert.equal(MAX_CONSUMER_GAMES, 100);
  assert.equal(MAX_CONSUMER_MOVEMENT_ROWS, 200);
  assert.equal(MAX_CONSUMER_SNAPSHOT_ROWS, 100);
  assert.equal(MAX_CONSUMER_PERFORMANCE_ROWS, 5_000);
  assert.match(routeSource, /\.limit\(MAX_CONSUMER_GAMES\)/);
  assert.match(routeSource, /inArray\(sportsbookOddsTable\.sportsbook, \["DraftKings", "FanDuel"\]\)/);
  assert.match(routeSource, /\.orderBy\(asc\(sportsbookOddsTable\.capturedAt\), asc\(sportsbookOddsTable\.id\)\)/);
  assert.match(routeSource, /preKickoffOnly:\s*true/);
  assert.match(routeSource, /snapshotDataConfidence\(\{[\s\S]*lowSample:\s*snapshot\.lowSample[\s\S]*inputMissingFeatureCount/);
  assert.match(routeSource, /dataAcceptable:\s*confidenceData\.acceptable/);
  assert.match(routeSource, /authoritativeGameKickoff:\s*true/);
  assert.match(routeSource, /new Date\(game\.kickoffTime\)\.getTime\(\) - 1/);
  assert.match(routeSource, /featureVersion,\s*PERSONNEL_CONTEXT_VERSION/);
  assert.match(routeSource, /maxRows:\s*MAX_CONSUMER_SNAPSHOT_ROWS/);
  assert.match(routeSource, /getPredictionPerformance\(MAX_CONSUMER_PERFORMANCE_ROWS\)/);
  assert.match(predictionSource, /predictionTimestamp\}\s*<\s*\$\{gamesTable\.kickoffTime/);
  assert.match(predictionSource, /selectDistinctOn/);
  assert.match(predictionSource, /PHASE6_PRODUCTION_VECTOR_WIDTH/);
  assert.match(predictionSource, /snapshotMatchesProductionModels/);
  assert.match(predictionSource, /input-integrity-v3/);
  assert.match(predictionSource, /options\.maxRows === undefined \? await query : await query\.limit\(options\.maxRows\)/);
  assert.match(routeSource, /\.limit\(1\)/);
  assert.doesNotMatch(routeSource, /\b(generateLivePredictions|gradeCompletedPredictions|syncSchedule|rebuildPregamePersonnelContextFeatures)\b/);
});

test("consumer movement UI keeps honest terminology and responsive controls", () => {
  const webRoot = path.join(fileURLToPath(new URL("../../../nfl-analytics/src/", import.meta.url)));
  const component = readFileSync(path.join(webRoot, "components/LineMovementExperience.tsx"), "utf8");
  const css = readFileSync(path.join(webRoot, "index.css"), "utf8");
  assert.match(component, /First observed by Gridline/);
  assert.match(component, /preKickoffMovementLabel\(beforeKickoff\)/);
  assert.match(component, /Compare books/);
  assert.match(component, /DraftKings.*FanDuel/s);
  assert.match(component, /not a verified sportsbook closing line/);
  assert.doesNotMatch(component, /\bopener\b|label="Final pre-kickoff"/i);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.movement-controls/);
  assert.match(css, /\.movement-chart \{[^}]*overflow: hidden/);
});

test("consumer market board keeps neutral language and 320px responsive controls", () => {
  const webRoot = path.join(fileURLToPath(new URL("../../../nfl-analytics/src/", import.meta.url)));
  const component = readFileSync(path.join(webRoot, "pages/consumer/ConsumerGames.tsx"), "utf8");
  const comparison = readFileSync(path.join(webRoot, "components/ConsumerMarketComparison.tsx"), "utf8");
  const css = readFileSync(path.join(webRoot, "index.css"), "utf8");
  assert.match(comparison, /Model difference/);
  assert.match(component, /Not eligible:.*evidence only, not current comparisons/);
  assert.match(component, /aria-expanded/);
  assert.doesNotMatch(component, /\bbet\b|\bpick\b|\bedge\b|expected return/i);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.btn-icon \{[^}]*width: 44px;[^}]*height: 44px/);
});

test("consumer matchup board exposes accessible partial states without wide tables or betting claims", () => {
  const webRoot = path.join(fileURLToPath(new URL("../../../nfl-analytics/src/", import.meta.url)));
  const component = readFileSync(path.join(webRoot, "components/ConsumerMatchupBoard.tsx"), "utf8");
  const css = readFileSync(path.join(webRoot, "index.css"), "utf8");
  assert.match(component, /Insufficient data|edgeLabel/);
  assert.match(component, /These assessments do not change the Gridline prediction/);
  assert.match(component, /<details/);
  assert.doesNotMatch(component, /<table|\bbet\b|recommendation/i);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.matchup-assessment summary/);
  assert.match(css, /\.matchup-assessment \{[^}]*overflow: hidden/);
});
