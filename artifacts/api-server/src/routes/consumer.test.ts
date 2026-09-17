import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  GetConsumerDashboardResponse,
  GetConsumerGameResponse,
  GetConsumerPerformanceResponse,
  GetConsumerPropsAvailabilityResponse,
  GetConsumerTrendsResponse,
  ListConsumerGamesResponse,
} from "@workspace/api-zod";
import {
  MAX_CONSUMER_GAMES,
  MAX_CONSUMER_MOVEMENT_ROWS,
  MAX_CONSUMER_PERFORMANCE_ROWS,
  MAX_CONSUMER_SNAPSHOT_ROWS,
  americanOddsImpliedProbability,
  buildConsumerMarketBoard,
  consumerFinalScore,
  consumerMarket,
  serializeContext,
  serializeMovement,
  serializePerformance,
  summarizeConsumerMarketBoards,
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
        qb: { starterCertainty: 81, starterChange: true },
        injuries: { offense: { impactScore: 30 }, defense: { impactScore: 8 } },
        personnelCompleteness: 90,
      },
      away: {
        qb: { starterCertainty: 75, starterChange: false },
        injuries: { offense: { impactScore: 5 }, defense: { impactScore: 28 } },
        personnelCompleteness: 85,
      },
    },
  }, "home", "away");

  assert.equal(serialized.available, true);
  assert.equal(serialized.teams.length, 2);
  assert.equal(serialized.teams[0]?.depth[0]?.name, "Safe Player");
  assert.equal(serialized.teams[0]?.depth[0]?.role, "published_starter");
  assert.deepEqual(serialized.projectedMatchups, []);
  assert.equal(serialized.matchupMessage, "Matchup projection not yet available.");
  assert.ok(serialized.drivers.length <= 4);
  assert.doesNotMatch(JSON.stringify(serialized), /playerId|sourceUrl|featureAudit|modelVersion|unavailableReasons/);
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
