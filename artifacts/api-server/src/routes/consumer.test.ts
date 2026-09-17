import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import {
  GetConsumerDashboardResponse,
  GetConsumerGameResponse,
  GetConsumerPerformanceResponse,
  GetConsumerPropsAvailabilityResponse,
  GetConsumerTrendsResponse,
  GetConsumerPlayerUsageResponse,
  ListConsumerGamesResponse,
} from "@workspace/api-zod";
import consumerRouter, {
  MAX_CONSUMER_GAMES,
  MAX_CONSUMER_MOVEMENT_ROWS,
  MAX_CONSUMER_PERFORMANCE_ROWS,
  MAX_CONSUMER_SNAPSHOT_ROWS,
  aggregatePlayerUsage,
  americanOddsImpliedProbability,
  buildUsageSnapPlayerAliases,
  buildUsageTeamMappings,
  buildConsumerMarketBoard,
  compareUsageGameChronology,
  consumerFinalScore,
  consumerMarket,
  deterministicSourceGameId,
  eligibleUsageGames,
  filterUsagePlayers,
  serializeContext,
  serializeMovement,
  serializePerformance,
  summarizeConsumerMarketBoards,
  usageCompositeIdentity,
  usageMatchupIdentity,
} from "./consumer";

const boardRow = (
  sportsbook: string,
  market: string,
  selection: string,
  point: number | null,
  price: number,
  capturedAt: string,
) => ({ sportsbook, market, selection, point, price, capturedAt: new Date(capturedAt) });

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
  ], { teamId: "home", name: "Home Team", abbreviation: "HME" }, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-01T12:10:00Z"));

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
  ], home, new Date("2026-09-02T00:00:00Z"), new Date("2026-09-01T12:10:00Z"));
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

test("database-backed player usage route returns production and crosswalk-resolved snap evidence", async (t) => {
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
  assert.ok(payload.players.length > 0, "latest persisted player-game season should be exposed");
  assert.ok(payload.players.some((player) => player.aggregate.snapShare.available),
    "GSIS player-game IDs should crosswalk to PFR snap IDs");
  assert.ok(payload.sourceCoverage.requestedGames > 0);
  assert.ok(!payload.sourceCoverage.partialReasons.includes("No completed games are available for the requested cutoff"),
    "source-backed standalone history must not be mislabeled as having no completed games");

  const team = payload.players[0]!.teamId;
  assert.ok(team);
  const filteredResponse = await fetch(`${baseUrl}/consumer/player-usage?team=${encodeURIComponent(team)}&position=WR&window=last3`);
  assert.equal(filteredResponse.status, 200);
  const filtered = GetConsumerPlayerUsageResponse.parse(await filteredResponse.json());
  assert.ok(filtered.players.length > 0);
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
  assert.equal(result[0]?.trend, "down");
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

test("player usage payload validates generated contract with explicit unsupported metrics", () => {
  const payload = {
    status: "partial",
    players: [],
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
  const game = {
    gameId: "game-1",
    season: 2026,
    week: 1,
    kickoffTime: "2026-09-20T17:00:00.000Z",
    gameStatus: "STATUS_SCHEDULED",
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
      staleAfterMinutes: 30,
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
        firstObserved: null,
        current: null,
        modelTimestamp: null,
        marketTimestamp: null,
      })),
    },
    dataConfidence: { label: "Updating" as const, score: null, reason: "Prediction data is being refreshed" },
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
  const source = readFileSync(path.join(routesDirectory, "consumer.ts"), "utf8");
  const predictionSource = readFileSync(path.join(routesDirectory, "../lib/live-predictions.ts"), "utf8");
  assert.equal(ListConsumerGamesResponse.safeParse({
    status: "absent",
    coverage: { games: 1, gamesWithComparison: 0, DraftKings: 0, FanDuel: 0 },
    games: [game],
  }).success, true);
  assert.equal(GetConsumerDashboardResponse.safeParse({
    status: "available",
    games: [game],
    note: "Persisted snapshots only",
  }).success, true);
  assert.equal(GetConsumerGameResponse.safeParse(detail).success, true);
  assert.equal(MAX_CONSUMER_GAMES, 100);
  assert.equal(MAX_CONSUMER_MOVEMENT_ROWS, 200);
  assert.equal(MAX_CONSUMER_SNAPSHOT_ROWS, 100);
  assert.equal(MAX_CONSUMER_PERFORMANCE_ROWS, 5_000);
  assert.match(source, /\.limit\(MAX_CONSUMER_GAMES\)/);
  assert.match(source, /inArray\(sportsbookOddsTable\.sportsbook, \["DraftKings", "FanDuel"\]\)/);
  assert.match(source, /\.orderBy\(asc\(sportsbookOddsTable\.capturedAt\), asc\(sportsbookOddsTable\.id\)\)/);
  assert.match(source, /preKickoffOnly:\s*true/);
  assert.match(source, /authoritativeGameKickoff:\s*true/);
  assert.match(source, /new Date\(game\.kickoffTime\)\.getTime\(\) - 1/);
  assert.match(source, /featureVersion,\s*PERSONNEL_CONTEXT_VERSION/);
  assert.match(source, /maxRows:\s*MAX_CONSUMER_SNAPSHOT_ROWS/);
  assert.match(source, /getPredictionPerformance\(MAX_CONSUMER_PERFORMANCE_ROWS\)/);
  assert.match(predictionSource, /predictionTimestamp\}\s*<\s*\$\{gamesTable\.kickoffTime/);
  assert.match(predictionSource, /selectDistinctOn/);
  assert.match(predictionSource, /PHASE6_PRODUCTION_VECTOR_WIDTH/);
  assert.match(predictionSource, /snapshotMatchesProductionModels/);
  assert.match(predictionSource, /input-integrity-v3/);
  assert.match(predictionSource, /options\.maxRows === undefined \? await query : await query\.limit\(options\.maxRows\)/);
  assert.match(source, /\.limit\(1\)/);
  assert.doesNotMatch(source, /\b(generateLivePredictions|gradeCompletedPredictions|syncSchedule|rebuildPregamePersonnelContextFeatures)\b/);
});

test("consumer movement UI keeps honest terminology and responsive controls", () => {
  const webRoot = path.join(fileURLToPath(new URL("../../../nfl-analytics/src/", import.meta.url)));
  const component = readFileSync(path.join(webRoot, "components/LineMovementExperience.tsx"), "utf8");
  const css = readFileSync(path.join(webRoot, "index.css"), "utf8");
  assert.match(component, /First observed by Gridline/);
  assert.match(component, /Final pre-kickoff/);
  assert.match(component, /Compare books/);
  assert.match(component, /DraftKings.*FanDuel/s);
  assert.doesNotMatch(component, /\bopener\b|\bclosing line\b/i);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.movement-controls/);
  assert.match(css, /\.movement-chart \{[^}]*overflow: hidden/);
});

test("consumer market board keeps neutral language and 320px responsive controls", () => {
  const webRoot = path.join(fileURLToPath(new URL("../../../nfl-analytics/src/", import.meta.url)));
  const component = readFileSync(path.join(webRoot, "pages/consumer/ConsumerGames.tsx"), "utf8");
  const css = readFileSync(path.join(webRoot, "index.css"), "utf8");
  assert.match(component, /Model difference/);
  assert.match(component, /First observed by Gridline/);
  assert.match(component, /aria-expanded/);
  assert.doesNotMatch(component, /\bbet\b|\bpick\b|\bedge\b|recommendation|expected return/i);
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
