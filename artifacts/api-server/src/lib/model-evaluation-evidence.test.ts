import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { assertCompleteModelEvaluationBundle, getModelEvaluationAudit, persistModelEvaluationBundles, summarizeModelEvaluationEvidence } from "./modeling";

type ConnectCallback = Exclude<Parameters<typeof pool.connect>[0], undefined>;
type PoolClient = NonNullable<Parameters<ConnectCallback>[1]>;

const aggregateInsert = `
  INSERT INTO model_training_runs (
    model_version, family, algorithm, feature_version, training_seasons,
    test_season, sample_policy, recency_weighting, status, sample_size,
    metrics, calibration, feature_importance, notes
  ) VALUES ($1, 'spread', 'linear_regression', 'integration-test', '[2023]'::jsonb,
    2024, 'include_low_sample', 'none', 'challenger', $2,
    $3::jsonb, '{}'::jsonb, '{}'::jsonb, 'transactional evidence integration test')
`;

const evidenceInsert = `
  INSERT INTO model_evaluation_predictions (
    model_version, family, algorithm, feature_version, test_season, week,
    evaluation_stage, game_id, kickoff_time, prediction_cutoff, training_seasons,
    training_cutoff, game_stage, home_feature_source_cutoff,
    away_feature_source_cutoff, low_sample, predicted_value, actual_value,
    actual_home_score, actual_away_score, actual_margin, actual_total,
    actual_home_win, market_sportsbook, market_name, market_selection,
    market_point, market_price, market_observed_at
  ) VALUES (
    $1, 'spread', 'linear_regression', 'integration-test', 2024, 1,
    'season_holdout', $2, $3, $4, '[2023]'::jsonb,
    'through-2023', 'regular', $5, $6, false, 3.5, 7,
    27, 20, 7, 47, 1, $7, $8, $9, $10, $11, $12
  )
`;

type EvidenceOverrides = {
  gameId?: string;
  kickoffTime?: Date;
  predictionCutoff?: Date;
  homeFeatureSourceCutoff?: Date;
  awayFeatureSourceCutoff?: Date;
  marketSportsbook?: string | null;
  marketName?: string | null;
  marketSelection?: string | null;
  marketPoint?: number | null;
  marketPrice?: number | null;
  marketObservedAt?: Date | null;
};

function runVersion(label: string) {
  return `integration-evidence-${label}-${randomUUID()}`;
}

function completenessBundle(modelVersion: string, sampleSize: number, evidenceCount: number) {
  return {
    run: {
      modelVersion,
      family: "spread",
      algorithm: "linear_regression",
      featureVersion: "integration-test",
      trainingSeasons: [2023],
      testSeason: 2024,
      samplePolicy: "include_low_sample",
      sampleSize,
    },
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      modelVersion,
      evaluationRunId: "integration-run",
      family: "spread",
      algorithm: "linear_regression",
      featureVersion: "integration-test",
      trainingSeasons: [2023],
      testSeason: 2024,
      week: 1,
      gameId: `completeness-${index}`,
      homeTeamId: "HOME",
      awayTeamId: "AWAY",
      kickoffTime: new Date("2024-09-08T17:00:00.000Z"),
      predictionCutoff: new Date("2024-09-08T17:00:00.000Z"),
      trainingCutoff: "through-2023",
      gameStage: "regular",
      homeFeatureSourceCutoff: new Date("2024-09-07T17:00:00.000Z"),
      awayFeatureSourceCutoff: new Date("2024-09-07T18:00:00.000Z"),
      lowSample: false,
      predictedValue: 3.5,
      actualValue: 7,
      actualHomeScore: 27,
      actualAwayScore: 20,
      actualMargin: 7,
      actualTotal: 47,
      actualHomeWin: 1,
      projectedMargin: 3.5,
      marketPoint: null as number | null,
      marketSelection: null as string | null,
      marketSide: null as "home" | "away" | "over" | "under" | null,
      marketEvidence: null as Array<{
        sportsbook: string;
        market: string;
        selection: string;
        point: number | null;
        price: number;
        observedAt: string;
      }> | null,
      closingMarketEvidence: null as Array<{
        sportsbook: string;
        market: string;
        selection: string;
        point: number | null;
        price: number;
        observedAt: string;
      }> | null,
    })),
  };
}

test("bundle validation rejects mismatched provenance and leaked market timestamps", () => {
  const provenance = completenessBundle(runVersion("provenance-unit"), 1, 1);
  provenance.evidence[0].family = "totals";
  assert.throws(() => assertCompleteModelEvaluationBundle(provenance), /Inconsistent run provenance/);

  const leaked = completenessBundle(runVersion("leakage-unit"), 1, 1);
  leaked.evidence[0].marketEvidence = [{
    sportsbook: "book",
    market: "spread",
    selection: "HOME",
    point: -3,
    price: -110,
    observedAt: leaked.evidence[0].predictionCutoff.toISOString(),
  }];
  assert.throws(() => assertCompleteModelEvaluationBundle(leaked), /Invalid prediction-time market evidence/);

  const closingAtKickoff = completenessBundle(runVersion("closing-unit"), 1, 1);
  closingAtKickoff.evidence[0].closingMarketEvidence = [{
    sportsbook: "book",
    market: "spread",
    selection: "HOME",
    point: -3,
    price: -110,
    observedAt: closingAtKickoff.evidence[0].kickoffTime.toISOString(),
  }];
  assert.throws(() => assertCompleteModelEvaluationBundle(closingAtKickoff), /Invalid closing market evidence/);
});

test("retained evidence summaries calculate audit math and preserve unavailable edge analysis", () => {
  const base = completenessBundle("summary-model", 2, 2).evidence;
  base[0].predictedValue = 3;
  base[0].actualValue = 7;
  base[0].week = 2;
  base[1].predictedValue = -1;
  base[1].actualValue = 1;
  base[1].week = 1;
  const report = summarizeModelEvaluationEvidence(base as never);
  assert.equal(report.sampleSize, 2);
  assert.equal(report.models[0].mae, 3);
  assert.equal(report.models[0].rmse, Math.sqrt(10));
  assert.deepEqual(report.cumulative.map((row) => row.week), [1, 2]);
  assert.deepEqual(report.cumulative.map((row) => row.metric), ["meanAbsoluteError", "meanAbsoluteError"]);
  assert.deepEqual(report.cumulative.map((row) => row.score), [2, 3]);
  assert.equal(report.models[0].edgeAnalysis.status, "unavailable");
  assert.equal(report.comparison.status, "unavailable");
});

test("model comparison is same-family and game-paired", () => {
  const left = completenessBundle("left-model", 2, 2).evidence;
  const right = completenessBundle("right-model", 1, 1).evidence;
  right[0].gameId = left[0].gameId;
  right[0].predictedValue = 6;
  const report = summarizeModelEvaluationEvidence([...left, ...right] as never);
  assert.equal(report.comparison.status, "measured");
  if (report.comparison.status === "measured") {
    assert.equal(report.comparison.pairs![0].pairedSampleSize, 1);
    assert.equal(report.comparison.pairs![0].metric, "meanAbsoluteError");
    assert.equal(report.comparison.pairs![0].leftScore, 3.5);
    assert.equal(report.comparison.pairs![0].rightScore, 1);
  }
});

test("edge analysis orients home, away, over, and under selections", () => {
  const spreads = completenessBundle("spread-edge", 2, 2).evidence;
  spreads[0].predictedValue = 6;
  spreads[0].marketPoint = -3;
  spreads[0].marketSelection = "DAL";
  spreads[0].marketSide = "home";
  spreads[1].predictedValue = 6;
  spreads[1].marketPoint = 3;
  spreads[1].marketSelection = "PHI";
  spreads[1].marketSide = "away";

  const totals = completenessBundle("totals-edge", 2, 2).evidence;
  totals.forEach((row, index) => {
    row.family = "totals";
    row.gameId = `total-${index}`;
    row.predictedValue = 47;
    row.marketPoint = 44;
  });
  totals[0].marketSelection = "Over";
  totals[0].marketSide = "over";
  totals[1].marketSelection = "Under";
  totals[1].marketSide = "under";

  const report = summarizeModelEvaluationEvidence([...spreads, ...totals] as never);
  for (const model of report.models) {
    assert.equal(model.edgeAnalysis.status, "measured");
    assert.equal(model.edgeAnalysis.sampleSize, 2);
    assert.equal(model.edgeAnalysis.meanEdge, 0);
  }
});

test("bundle validation rejects mixed evaluation run identities", () => {
  const bundle = completenessBundle(runVersion("mixed-run"), 2, 2);
  bundle.evidence[1].evaluationRunId = "different-run";
  assert.throws(() => assertCompleteModelEvaluationBundle(bundle), /Inconsistent evaluation run identity/);
});

test("evaluation batches reject bundles from different run identities", async () => {
  const first = completenessBundle(runVersion("batch-a"), 1, 1);
  const second = completenessBundle(runVersion("batch-b"), 1, 1);
  second.evidence[0].evaluationRunId = "different-run";
  await assert.rejects(
    () => persistModelEvaluationBundles([first, second]),
    /must share one evaluation run identity/,
  );
});

test("moneyline calibration accounts for probabilities below and above one half", () => {
  const rows = completenessBundle("moneyline-summary", 2, 2).evidence;
  rows.forEach((row) => {
    row.family = "moneyline";
    (row as { projectedMargin: number | null }).projectedMargin = null;
  });
  rows[0].predictedValue = 0.2;
  rows[0].actualValue = 0;
  rows[1].predictedValue = 0.8;
  rows[1].actualValue = 1;
  const report = summarizeModelEvaluationEvidence(rows as never);
  const model = report.models[0];
  assert.equal(model.family, "moneyline");
  assert.equal(model.calibration!.reduce((sum, bucket) => sum + bucket.predictions, 0), 2);
  assert.deepEqual(report.cumulative.map((row) => row.metric), ["brierScore", "brierScore"]);
  for (const row of report.cumulative) assert.ok(Math.abs(row.score - 0.04) < 1e-12);
});

test("evaluation audit pagination remains bounded", async () => {
  const page = await getModelEvaluationAudit({ limit: -10 });
  assert.ok(page.rows.length <= 1);
  assert.equal(page.nextCursor === null || page.nextCursor === undefined || page.nextCursor > 0, true);
});

test("a later bundle failure rolls back every run in the evaluation transaction", async () => {
  const firstVersion = runVersion("atomic-first");
  const first = completenessBundle(firstVersion, 1, 1);
  const duplicate = completenessBundle(firstVersion, 1, 1);
  duplicate.evidence[0].gameId = "other-game";
  await assert.rejects(() => persistModelEvaluationBundles([first, duplicate]), /Failed query/i);
  const result = await pool.query(
    "SELECT count(*)::integer AS count FROM model_training_runs WHERE model_version = $1",
    [firstVersion],
  );
  assert.equal(result.rows[0].count, 0);
});

async function insertAggregate(client: PoolClient, modelVersion: string, sampleSize: number) {
  await client.query(aggregateInsert, [
    modelVersion,
    sampleSize,
    JSON.stringify({ sampleSize }),
  ]);
}

async function insertEvidence(
  client: PoolClient,
  modelVersion: string,
  overrides: EvidenceOverrides = {},
) {
  const kickoffTime = overrides.kickoffTime ?? new Date("2024-09-08T17:00:00.000Z");
  const predictionCutoff = overrides.predictionCutoff ?? kickoffTime;
  await client.query(evidenceInsert, [
    modelVersion,
    overrides.gameId ?? `game-${randomUUID()}`,
    kickoffTime,
    predictionCutoff,
    overrides.homeFeatureSourceCutoff ?? new Date("2024-09-07T17:00:00.000Z"),
    overrides.awayFeatureSourceCutoff ?? new Date("2024-09-07T18:00:00.000Z"),
    overrides.marketSportsbook ?? null,
    overrides.marketName ?? null,
    overrides.marketSelection ?? null,
    overrides.marketPoint ?? null,
    overrides.marketPrice ?? null,
    overrides.marketObservedAt ?? null,
  ]);
}

async function expectAtomicEvidenceFailure(
  label: string,
  writeEvidence: (client: PoolClient, modelVersion: string) => Promise<void>,
  expectedError: RegExp,
) {
  const modelVersion = runVersion(label);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertAggregate(client, modelVersion, 1);
    await assert.rejects(() => writeEvidence(client, modelVersion), expectedError);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const result = await pool.query(
    "SELECT count(*)::integer AS count FROM model_training_runs WHERE model_version = $1",
    [modelVersion],
  );
  assert.equal(result.rows[0].count, 0, "failed evidence must roll back its aggregate run");
}

test("aggregate sample size equals the immutable game evidence count", async () => {
  const modelVersion = runVersion("complete");
  assert.doesNotThrow(() =>
    assertCompleteModelEvaluationBundle(completenessBundle(modelVersion, 2, 2)),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertAggregate(client, modelVersion, 2);
    await insertEvidence(client, modelVersion);
    await insertEvidence(client, modelVersion);

    const result = await client.query(
      `SELECT runs.sample_size, count(evidence.id)::integer AS evidence_count
       FROM model_training_runs runs
       LEFT JOIN model_evaluation_predictions evidence
         ON evidence.model_version = runs.model_version
       WHERE runs.model_version = $1
       GROUP BY runs.sample_size`,
      [modelVersion],
    );
    assert.deepEqual(result.rows, [{ sample_size: 2, evidence_count: 2 }]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

for (const [label, evidenceCount] of [["zero", 0], ["partial", 1]] as const) {
  test(`${label} game evidence is rejected before its aggregate run is accepted`, async () => {
    const modelVersion = runVersion(label);
    assert.throws(
      () => assertCompleteModelEvaluationBundle(completenessBundle(modelVersion, 2, evidenceCount)),
      /Incomplete model evaluation evidence.*expected 2, received (0|1)/,
    );

    const result = await pool.query(
      "SELECT count(*)::integer AS count FROM model_training_runs WHERE model_version = $1",
      [modelVersion],
    );
    assert.equal(result.rows[0].count, 0);
  });
}

test("duplicate game evidence rejects and rolls back the aggregate run", async () => {
  const gameId = `duplicate-${randomUUID()}`;
  await expectAtomicEvidenceFailure(
    "duplicate",
    async (client, modelVersion) => {
      await insertEvidence(client, modelVersion, { gameId });
      await insertEvidence(client, modelVersion, { gameId });
    },
    /model_evaluation_prediction_version_game_unique|duplicate key/i,
  );
});

test("invalid feature chronology rejects and rolls back the aggregate run", async () => {
  const cutoff = new Date("2024-09-08T17:00:00.000Z");
  await expectAtomicEvidenceFailure(
    "chronology",
    (client, modelVersion) =>
      insertEvidence(client, modelVersion, {
        predictionCutoff: cutoff,
        homeFeatureSourceCutoff: cutoff,
      }),
    /model_evaluation_home_feature_chronology_check/i,
  );
});

test("incomplete market provenance rejects and rolls back the aggregate run", async () => {
  await expectAtomicEvidenceFailure(
    "provenance",
    (client, modelVersion) =>
      insertEvidence(client, modelVersion, {
        marketSportsbook: "integration-book",
      }),
    /model_evaluation_market_provenance_check/i,
  );
});

for (const mutation of ["UPDATE", "DELETE"] as const) {
  test(`${mutation} remains blocked for evaluation evidence`, async () => {
    const modelVersion = runVersion(mutation.toLowerCase());
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertAggregate(client, modelVersion, 1);
      await insertEvidence(client, modelVersion);

      const statement = mutation === "UPDATE"
        ? "UPDATE model_evaluation_predictions SET predicted_value = 4 WHERE model_version = $1"
        : "DELETE FROM model_evaluation_predictions WHERE model_version = $1";
      await assert.rejects(
        () => client.query(statement, [modelVersion]),
        /model evaluation prediction evidence is immutable/i,
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
}

after(async () => {
  await pool.end();
});