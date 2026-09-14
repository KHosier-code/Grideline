import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { assertCompleteModelEvaluationBundle } from "./modeling";

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
      family: "spread",
      algorithm: "linear_regression",
      featureVersion: "integration-test",
      testSeason: 2024,
      week: 1,
      gameId: `completeness-${index}`,
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
    })),
  };
}

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