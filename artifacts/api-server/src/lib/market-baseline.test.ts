import assert from "node:assert/strict";
import test from "node:test";
import {
  assert2025BaselineIsolation,
  applyMinimumEdgeSettlement,
  canonicalizeBaselineRows,
  hasDuplicateMarketSelections,
  matchHistoricalMarketGame,
  parseNflDataMarketCsv,
  pricingAvailability,
  qualify2025MarketSource,
  qualify2025MarketSourceAgainstContract,
  sourceFingerprint,
  settlementReturn,
  settleSpread,
  settleTotal,
  summarizeMarketEdges,
} from "./market-baseline";

const csv = `game_id,season,week,gameday,gametime,away_team,home_team,location,away_moneyline,home_moneyline,spread_line,away_spread_odds,home_spread_odds,total_line,under_odds,over_odds
2025_01_MIA_IND,2025,1,2025-09-07,17:00,MIA,IND,Home,105,-125,2.5,-110,-110,44.5,-110,-110
`;

const qualifiedHeader = "game_id,season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,location,away_moneyline,home_moneyline,spread_line,away_spread_odds,home_spread_odds,total_line,under_odds,over_odds";

function qualificationFixture() {
  const rows = Array.from({ length: 285 }, (_, index) => {
    const week = index < 22 ? index + 1 : 22;
    return `game-${index},2025,REG,${week},2025-09-07,13:00,AWY,10,HME,20,Home,-110,-110,3,-110,-110,44,-110,-110`;
  });
  const gamesDocumentation = `prefix\n## Games\nstable contract\n\n<a name="colors"/>\nsuffix`;
  const provenanceDocumentation = "stable provenance";
  return { csv: `${qualifiedHeader}\n${rows.join("\n")}`, datasetsDocumentation: gamesDocumentation, provenanceDocumentation };
}

function fixtureContract(fixture: ReturnType<typeof qualificationFixture>) {
  return {
    expected2025Events: 285,
    expected2025Weeks: Array.from({ length: 22 }, (_, index) => index + 1),
    gamesDocumentationSha256: sourceFingerprint("## Games\nstable contract\n"),
    provenanceDocumentationSha256: sourceFingerprint("stable provenance\n"),
  };
}

test("preserves recorded designation and unavailable provenance", () => {
  const rows = parseNflDataMarketCsv(csv);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].sourceDesignation, "source_designated_recorded");
  assert.equal(rows[0].sourceFile, "games.csv");
  assert.equal(rows[0].sportsbook, null);
  assert.equal(rows[0].observedAt, null);
  assert.equal(rows[0].price, 105);
});

test("source qualification validates schema and 2025 coverage without upgrading recorded evidence", () => {
  const fixture = qualificationFixture();
  const result = qualify2025MarketSourceAgainstContract(fixture, fixtureContract(fixture));
  assert.equal(result.eventCount, 285);
  assert.deepEqual(result.weeks, Array.from({ length: 22 }, (_, index) => index + 1));
  assert.equal(result.designation, "source_designated_recorded");
  assert.equal(result.sportsbook, null);
  assert.equal(result.observationTimestamp, null);
  assert.throws(
    () => qualify2025MarketSourceAgainstContract(
      { ...fixture, csv: fixture.csv.replace("away_moneyline,", "") },
      fixtureContract(fixture),
    ),
    /review required.*missing required columns: away_moneyline/,
  );
  assert.throws(
    () => qualify2025MarketSourceAgainstContract(
      { ...fixture, csv: fixture.csv.split("\n").slice(0, -1).join("\n") },
      fixtureContract(fixture),
    ),
    /2025 coverage is 284 events/,
  );
});

test("source qualification fails closed on documentation changes affecting market claims", () => {
  const fixture = qualificationFixture();
  const contract = fixtureContract(fixture);
  assert.throws(
    () => qualify2025MarketSourceAgainstContract(
      { ...fixture, datasetsDocumentation: fixture.datasetsDocumentation.replace("stable contract", "calls lines closing") },
      contract,
    ),
    /review required.*line designation, timing, or source-field semantics/,
  );
  assert.throws(
    () => qualify2025MarketSourceAgainstContract(
      { ...fixture, provenanceDocumentation: "changed licensing terms" },
      contract,
    ),
    /README\.md provenance or licensing context changed/,
  );
  assert.throws(() => qualify2025MarketSource(fixture), /review required/);
  assert.equal(parseNflDataMarketCsv(csv)[0].sourceDesignation, "source_designated_recorded");
});

test("matching rejects aliases and neutral-site games rather than forcing orientation", () => {
  const quote = parseNflDataMarketCsv(csv)[0];
  const matched = matchHistoricalMarketGame(quote, [{
    gameId: "2025_01_MIA_IND",
    season: 2025,
    week: 1,
    kickoffTime: new Date("2025-09-07T17:00:00Z"),
    homeAbbreviation: "IND",
    awayAbbreviation: "MIA",
  }]);
  assert.equal(matched.outcome, "matched");
  const neutral = matchHistoricalMarketGame(quote, [{
    gameId: "2025_01_MIA_IND",
    season: 2025,
    week: 1,
    kickoffTime: null,
    homeAbbreviation: "IND",
    awayAbbreviation: "MIA",
    neutralSite: true,
  }]);
  assert.equal(neutral.outcome, "neutral_site");
  const losAngelesAlias = matchHistoricalMarketGame({ ...quote, awayTeam: "LA", altGameId: "unknown" }, [{
    gameId: "canonical",
    season: 2025,
    week: 1,
    kickoffTime: quote.kickoffTime,
    homeAbbreviation: "IND",
    awayAbbreviation: "LAR",
  }]);
  assert.equal(losAngelesAlias.outcome, "alias");
  assert.equal(losAngelesAlias.matchedGameId, "canonical");
  const orientationMismatch = matchHistoricalMarketGame({ ...quote, homeTeam: "MIA", awayTeam: "IND" }, [{
    gameId: quote.altGameId,
    season: 2025,
    week: 1,
    kickoffTime: quote.kickoffTime,
    homeAbbreviation: "IND",
    awayAbbreviation: "MIA",
  }]);
  assert.equal(orientationMismatch.outcome, "unmatched");
  assert.equal(orientationMismatch.matchedGameId, null);
  const staleExactId = matchHistoricalMarketGame({ ...quote, kickoffTime: new Date("2025-10-07T17:00:00Z") }, [{
    gameId: quote.altGameId,
    season: 2025,
    week: 1,
    kickoffTime: new Date("2025-09-07T17:00:00Z"),
    homeAbbreviation: "IND",
    awayAbbreviation: "MIA",
  }]);
  assert.equal(staleExactId.outcome, "unmatched");
});

test("settlement is orientation-safe and keeps push/no-bet states", () => {
  assert.equal(settleSpread(3, -3, "home"), "push");
  assert.equal(settleSpread(7, -3, "home"), "win");
  assert.equal(settleSpread(7, 3, "away"), "loss");
  assert.equal(settleSpread(7, null, "home"), "no_bet");
  assert.equal(settleTotal(44, 44, "over"), "push");
  assert.equal(settleTotal(45, 44, "over"), "win");
  assert.equal(settleTotal(45, 44, "under"), "loss");
  assert.equal(settlementReturn("win", -110), 100 / 110);
  assert.equal(settlementReturn("loss", 125), -1);
  assert.equal(settlementReturn("push", -110), 0);
  assert.equal(applyMinimumEdgeSettlement("win", 0.99, 1), "no_bet");
  assert.equal(applyMinimumEdgeSettlement("loss", 1, 1), "loss");
});

test("edge summaries expose fixed buckets and confidence intervals", () => {
  const summary = summarizeMarketEdges([
    { edge: 1, settlement: "win", error: 2 },
    { edge: 3, settlement: "loss", error: 4 },
    { edge: 7, settlement: "push", error: 5 },
  ]);
  assert.deepEqual(summary.map((item) => item.bucket), ["<1", "1-1.99", "2-2.99", "3-4.99", "5+"]);
  assert.equal(summary[1].sampleSize, 1);
  assert.equal(summary[1].confidenceInterval95.low !== null, true);
  assert.equal(summary[4].gradedSampleSize, 0);
});

test("price-aware returns and CLV remain unavailable without timestamps", () => {
  const result = pricingAvailability([{
    price: -110,
    observedAt: null,
    sourceTimestamp: null,
  }]);
  assert.equal(result.priceAwareReturns, "available");
  assert.equal(result.trueClv, "unavailable");
});

test("baseline isolation rejects forward seasons and market or personnel features", () => {
  const valid = {
    featureVersion: "pregame-v3",
    vectorFeatureNames: ["last_3.epa_per_play"],
    trainingSeasons: [2021, 2022, 2023, 2024],
    testSeason: 2025,
    chronology: [{
      featureCutoff: new Date("2025-09-06T12:00:00Z"),
      predictionCutoff: new Date("2025-09-07T12:00:00Z"),
      kickoffTime: new Date("2025-09-07T17:00:00Z"),
    }],
  };
  assert.doesNotThrow(() => assert2025BaselineIsolation(valid));
  assert.throws(() => assert2025BaselineIsolation({ ...valid, trainingSeasons: [2024, 2025] }), /through-2024/);
  assert.throws(() => assert2025BaselineIsolation({ ...valid, vectorFeatureNames: ["closing_spread"] }), /cannot enter/);
  assert.throws(() => assert2025BaselineIsolation({ ...valid, vectorFeatureNames: ["sleeper_starter"] }), /cannot enter/);
});

test("duplicate source selections are detected rather than silently selected", () => {
  const quotes = parseNflDataMarketCsv(csv);
  assert.equal(hasDuplicateMarketSelections(quotes), false);
  assert.equal(hasDuplicateMarketSelections([...quotes, quotes[0]]), true);
});

test("evaluation rows canonicalize identically regardless of database order", () => {
  const first = { gameId: "b", kickoffTime: new Date("2025-09-08T00:00:00Z"), homeTeamId: "2", awayTeamId: "1" };
  const second = { gameId: "a", kickoffTime: new Date("2025-09-07T00:00:00Z"), homeTeamId: "4", awayTeamId: "3" };
  assert.deepEqual(canonicalizeBaselineRows([first, second]), canonicalizeBaselineRows([second, first]));
  assert.deepEqual(canonicalizeBaselineRows([first, second]).map((row) => row.gameId), ["a", "b"]);
});