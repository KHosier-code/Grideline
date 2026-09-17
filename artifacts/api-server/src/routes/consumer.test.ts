import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  consumerFinalScore,
  consumerMarket,
  serializeContext,
  serializeMovement,
  serializePerformance,
} from "./consumer";

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

test("consumer movement preserves legitimate A-B-A history without exposing row identifiers", () => {
  const movement = serializeMovement([
    { sportsbook: "DraftKings", market: "spread", selection: "Home", point: -3, price: -110, capturedAt: new Date("2026-09-01T12:00:00Z") },
    { sportsbook: "DraftKings", market: "spread", selection: "Home", point: -2.5, price: -105, capturedAt: new Date("2026-09-01T13:00:00Z") },
    { sportsbook: "DraftKings", market: "spread", selection: "Home", point: -3, price: -108, capturedAt: new Date("2026-09-01T14:00:00Z") },
  ]);

  assert.equal(movement.available, true);
  assert.equal(movement.movements[0]?.observationsInWindow, 3);
  assert.equal(movement.movements[0]?.pointChange, 0);
  assert.equal(movement.movements[0]?.priceChange, 2);
  assert.doesNotMatch(JSON.stringify(movement), /"id"|"observationKey"|"stateHash"/);
});

test("consumer movement and context use explicit unavailable states", () => {
  assert.deepEqual(serializeMovement([]), {
    available: false,
    movements: [],
    window: { maximumRows: 200, truncated: false },
    message: "Line movement is not yet available",
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

test("consumer movement reports truncation only when a sentinel row exists", () => {
  const rows = Array.from({ length: MAX_CONSUMER_MOVEMENT_ROWS + 1 }, (_, index) => ({
    sportsbook: "DraftKings",
    market: "spread",
    selection: "Home",
    point: -3,
    price: -110 + (index % 2),
    capturedAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
  }));
  const movement = serializeMovement(rows);
  assert.equal(movement.window.truncated, true);
  assert.equal(movement.movements[0]?.observationsInWindow, MAX_CONSUMER_MOVEMENT_ROWS);
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
        movement: "Line movement is not yet available",
      },
    },
  };

  assert.equal(ListConsumerGamesResponse.safeParse({ status: "available", games: [game] }).success, true);
  assert.equal(GetConsumerDashboardResponse.safeParse({ status: "available", games: [game], note: "Persisted only." }).success, true);
  assert.equal(GetConsumerGameResponse.safeParse(detail).success, true);
  assert.equal(GetConsumerPropsAvailabilityResponse.safeParse({
    status: "unavailable",
    message: "Player information temporarily unavailable",
    available: false,
  }).success, true);
});

test("consumer reads remain bounded and cannot invoke computation side effects", () => {
  const source = readFileSync(fileURLToPath(new URL("./consumer.ts", import.meta.url)), "utf8");
  const predictionSource = readFileSync(fileURLToPath(new URL("../lib/live-predictions.ts", import.meta.url)), "utf8");
  assert.equal(MAX_CONSUMER_GAMES, 100);
  assert.equal(MAX_CONSUMER_MOVEMENT_ROWS, 200);
  assert.equal(MAX_CONSUMER_SNAPSHOT_ROWS, 100);
  assert.equal(MAX_CONSUMER_PERFORMANCE_ROWS, 5_000);
  assert.match(source, /\.limit\(MAX_CONSUMER_GAMES\)/);
  assert.match(source, /\.limit\(MAX_CONSUMER_MOVEMENT_ROWS \+ 1\)/);
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