import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateMarketBaselineArchive } from "./market-baseline-archive-check";

const RUN = "phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4";
const SHA = "bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8";
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v) ?? "null";

function fixture() {
  const events: any[] = [], quotes: any[] = [], predictions: any[] = [], games: any[] = [], raw: any[] = [];
  for (let i = 0; i < 285; i++) {
    const id = `src-${i}`, gameId = i < 277 ? `game-${i}` : null;
    const outcome = i < 258 ? "matched" : i < 277 ? "alias" : "neutral_site";
    events.push({ run_id: RUN, source_game_id: id, alt_game_id: id, outcome, reason: "fixture",
      candidate_game_ids: [], matched_game_id: gameId, alias_used: outcome === "alias" });
    for (const [family, sides, point] of [
      ["spread", ["home", "away"], 3], ["moneyline", ["home", "away"], null], ["totals", ["over", "under"], 40],
    ] as const) for (const side of sides) {
      const price = -110;
      const value = { sourceGameId: id, altGameId: id, family, side,
        point: family === "spread" && side === "home" ? -3 : point, price, sourceOutcome: null };
      raw.push(value);
      quotes.push({ run_id: RUN, source_game_id: id, alt_game_id: id, matched_game_id: gameId, source_file: "games.csv",
        family, side, point: value.point, price, source_designation: "source_designated_recorded", sportsbook: null,
        observed_at: null, source_timestamp: null, source_outcome: null });
    }
    if (!gameId) continue;
    games.push({ game_id: gameId, season: 2025, week: i % 22 + 1, kickoff_time: "2025-09-10T20:00:00Z",
      home_team_id: "H", away_team_id: "A", final_home_score: 20, final_away_score: 17 });
    for (const [family, prediction] of [["spread", 2], ["moneyline", .6], ...(i < 230 ? [["totals", 35]] : [])] as [string, number][]) {
      predictions.push({ evaluation_run_id: RUN, model_version: `fixture-${family}`, family,
        algorithm: { spread: "linear_regression", moneyline: "logistic_regression", totals: "gradient_boosting" }[family as "spread"],
        feature_version: "pregame-v3", test_season: 2025, week: i % 22 + 1, evaluation_stage: "season_holdout",
        game_id: gameId, kickoff_time: "2025-09-10T20:00:00Z", prediction_cutoff: "2025-09-10T18:00:00Z",
        training_seasons: [2021, 2022, 2023, 2024], training_cutoff: "through-2024",
        home_team_id: "H", away_team_id: "A",
        home_feature_source_cutoff: "2025-09-10T17:00:00Z", away_feature_source_cutoff: "2025-09-10T17:00:00Z",
        low_sample: false, predicted_value: prediction, actual_value: family === "spread" ? 3 : family === "totals" ? 37 : 1,
        actual_home_score: 20, actual_away_score: 17, actual_margin: 3, actual_total: 37, actual_home_win: 1,
        projected_home_win_probability: family === "moneyline" ? prediction : null,
        projected_away_win_probability: family === "moneyline" ? 1 - prediction : null,
        projected_margin: family === "spread" ? prediction : null, projected_total: family === "totals" ? prediction : null,
        market_sportsbook: null, market_name: null, market_selection: null, market_side: null, market_point: null,
        market_price: null, market_observed_at: null, market_evidence: null, closing_market_evidence: null });
    }
  }
  const models: any[] = [], references: any[] = [];
  for (const [family, algorithm, policy, count, metrics] of [
    ["spread", "linear_regression", "include_low_sample", 277, { sampleSize: 277, mae: 1, rmse: 1 }],
    ["moneyline", "logistic_regression", "include_low_sample", 277,
      { sampleSize: 277, accuracy: 1, brierScore: .16, logLoss: -Math.log(.6) }],
    ["totals", "gradient_boosting", "exclude_low_sample", 230, { sampleSize: 230, mae: 2, rmse: 2 }],
  ] as const) {
    const payload = { version: 1, algorithm, centers: [], scales: [], model: {} };
    const invariant = { family, algorithm, featureVersion: "pregame-v3", vectorFeatureNames: ["x"],
      vectorSchemaFingerprint: "schema", trainingSeasons: [2021, 2022, 2023, 2024], trainingCutoff: "through-2024",
      samplePolicy: policy, hyperparameters: family === "spread" ? { ridgeLambda: 1 } : family === "moneyline"
        ? { epochs: 350, learningRate: .08, coefficientRegularization: .02 }
        : { rounds: 8, depth: 2, learningRate: .08, minLeafSamples: 5 } };
    const checksum = createHash("sha256").update(canonical({ ...payload, metadata: invariant })).digest("hex");
    models.push({ model_version: `fixture-${family}`, family, algorithm, feature_version: "pregame-v3",
      training_seasons: [2021, 2022, 2023, 2024], test_season: 2025, sample_policy: policy,
      status: "evaluation_baseline", sample_size: count, metrics, vector_feature_names: ["x"],
      vector_schema_fingerprint: "schema", model_artifact: { ...payload, metadata: { ...invariant, artifactChecksum: checksum } } });
    const recordedMarketAccuracy = family === "spread" ? { sampleSize: count, mae: 0, rmse: 0 }
      : family === "totals" ? { sampleSize: count, mae: 3, rmse: 3 }
        : { sampleSize: count, accuracy: 1, brierScore: .25, logLoss: Math.log(2) };
    references.push({ family, modelVersion: `fixture-${family}`, artifactChecksum: checksum, sampleSize: count, metrics,
      market: { recordedMarketAccuracy } });
  }
  const archive = { tables: { market_baseline_runs: [{ run_id: RUN, season: 2025, status: "complete",
    source: "nflverse/nfldata", source_url: "https://github.com/nflverse/nfldata", source_files: ["games.csv"],
    source_fingerprints: { "games.csv": SHA }, metadata: { matchContractVersion: 4,
      evaluationInputFingerprint: "f289a18f99c4" + "0".repeat(52), minimumRecordedLineEdge: 1,
      eventCount: 285, quoteCount: 1710, closingStatus: "unavailable", timestampStatus: "unavailable",
      sportsbookStatus: "unavailable" } }], market_baseline_events: events, market_baseline_quotes: quotes,
    model_training_runs: models, model_evaluation_predictions: predictions, games } };
  const report = { evaluationRunId: RUN, coverage: { sourceEvents: 285, quotes: 1710,
    matchingOutcomes: { matched: 258, alias: 19, neutral_site: 8 } }, models: references };
  return { archive, report, raw };
}

test("complete linked archive can pass read-only checks", () => {
  const { archive, report, raw } = fixture();
  assert.deepEqual(validateMarketBaselineArchive(archive, report, raw).status, "verified");
});

test("missing raw source stays blocked and does not assert recovery", () => {
  const { archive, report } = fixture();
  const result = validateMarketBaselineArchive(archive, report);
  assert.equal(result.status, "blocked");
  assert.match(result.warnings.join(" "), /Source bytes/);
});

test("tampered quote, score, checksum, missing schema, and foreign run all report mismatches", () => {
  const { archive, report, raw } = fixture();
  archive.tables.market_baseline_quotes[0].price = 999;
  archive.tables.games[0].final_home_score = 99;
  archive.tables.model_training_runs[0].model_artifact.centers = [1];
  delete archive.tables.market_baseline_events[0].source_game_id;
  archive.tables.market_baseline_runs[0].run_id = "forged";
  const result = validateMarketBaselineArchive(archive, report, raw);
  assert.equal(result.status, "blocked");
  for (const word of ["Quote differs", "score differs", "artifact checksum differs", "missing columns", "Run identity"]) {
    assert.match(result.mismatches.join("\n"), new RegExp(word));
  }
});