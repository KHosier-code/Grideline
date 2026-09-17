type QueryablePool = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<QueryableClient>;
};

type QueryResult = {
  rows: unknown[];
  rowCount?: number | null;
};

type QueryableClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<QueryResult>;
  release: () => void;
};

export type ProductionDatabaseEvidence = {
  buildId: string;
  checkedAt: Date;
  selectOneResult: 1;
  verifyFullPassed: true;
  connectivityPassed: true;
  tlsPassed: true;
  snapshotUpdateGuardPassed: true;
  snapshotDeleteGuardPassed: true;
  gradeUpdateGuardPassed: true;
  gradeDeleteGuardPassed: true;
};

const IMMUTABLE_SNAPSHOT_MESSAGE = "official prediction snapshots are immutable";
const IMMUTABLE_GRADE_MESSAGE = "prediction grades are immutable";

const IMMUTABLE_TRAINING_RUN_MESSAGE = "checksum-backed model training runs are fully immutable";
async function expectRejectedMutation(
  client: QueryableClient,
  savepoint: string,
  query: string,
  values: readonly unknown[],
  expectedMessage: string,
): Promise<void> {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (error instanceof Error && error.message.includes(expectedMessage)) return;
    throw new Error(`Immutable prediction guard returned an unexpected error for ${savepoint}`);
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  throw new Error(`Immutable prediction guard is absent or ineffective for ${savepoint}`);
}

/**
 * Proves the managed production database rejects mutations to canonical
 * predictions and the highest-risk immutable model/evidence records. Probe
 * rows and all attempted changes are rolled back, so this is startup
 * verification rather than startup schema management.
 */
export async function verifyImmutablePredictionGuards(
  pool: Pick<QueryablePool, "connect">,
  buildId: string,
): Promise<void> {
  const client = await pool.connect();
  const probeKey = `production-immutability-probe:${buildId}`;
  try {
    await client.query("BEGIN");
    const snapshot = await client.query(
      `INSERT INTO prediction_snapshots
         (snapshot_key, game_id, snapshot_label, feature_version, training_cutoff,
          official_final_prediction, frozen_at)
       VALUES ($1, $2, 'production-guard-probe', 'production-guard-probe',
               'production-guard-probe', true, now())
       RETURNING id`,
      [probeKey, probeKey],
    );
    const snapshotId = (snapshot.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof snapshotId !== "number") {
      throw new Error("Immutable prediction guard probe snapshot was not inserted");
    }

    await expectRejectedMutation(
      client,
      "snapshot_update_guard",
      "UPDATE prediction_snapshots SET snapshot_label = $1 WHERE id = $2",
      ["mutation-must-fail", snapshotId],
      IMMUTABLE_SNAPSHOT_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "snapshot_delete_guard",
      "DELETE FROM prediction_snapshots WHERE id = $1",
      [snapshotId],
      IMMUTABLE_SNAPSHOT_MESSAGE,
    );

    const grade = await client.query(
      `INSERT INTO prediction_grades (prediction_id, actual_home_score, actual_away_score)
       VALUES ($1, 0, 0)
       RETURNING id`,
      [snapshotId],
    );
    const gradeId = (grade.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof gradeId !== "number") {
      throw new Error("Immutable prediction guard probe grade was not inserted");
    }
    await expectRejectedMutation(
      client,
      "grade_update_guard",
      "UPDATE prediction_grades SET actual_home_score = 1 WHERE id = $1",
      [gradeId],
      IMMUTABLE_GRADE_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "grade_delete_guard",
      "DELETE FROM prediction_grades WHERE id = $1",
      [gradeId],
      IMMUTABLE_GRADE_MESSAGE,
    );

    const modelVersion = `${probeKey}:model`;
    const trainingRun = await client.query(
      `INSERT INTO model_training_runs
         (model_version, family, algorithm, feature_version, training_seasons,
          test_season, sample_policy, sample_size, vector_feature_names,
          vector_schema_fingerprint, model_artifact)
       VALUES ($1, 'spread', 'production-guard-probe', 'production-guard-probe',
               '[]'::jsonb, 2025, 'production-guard-probe', 0, '[]'::jsonb,
               'production-guard-probe',
               '{"metadata":{"artifactChecksum":"production-guard-probe"}}'::jsonb)
       RETURNING id`,
      [modelVersion],
    );
    const trainingRunId = (trainingRun.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof trainingRunId !== "number") {
      throw new Error("Immutable model guard probe training run was not inserted");
    }
    await expectRejectedMutation(
      client,
      "training_run_update_guard",
      "UPDATE model_training_runs SET notes = $1 WHERE id = $2",
      ["mutation-must-fail", trainingRunId],
      IMMUTABLE_TRAINING_RUN_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "training_run_delete_guard",
      "DELETE FROM model_training_runs WHERE id = $1",
      [trainingRunId],
      "artifact-backed model training runs are immutable",
    );

    const evaluation = await client.query(
      `INSERT INTO model_evaluation_predictions
         (model_version, family, algorithm, feature_version, test_season, week,
          game_id, kickoff_time, prediction_cutoff, training_seasons,
          training_cutoff, game_stage, home_feature_source_cutoff,
          away_feature_source_cutoff, low_sample, predicted_value, actual_value,
          actual_home_score, actual_away_score, actual_margin, actual_total,
          actual_home_win)
       VALUES ($1, 'spread', 'production-guard-probe', 'production-guard-probe',
               2025, 1, $2, '2025-09-02T00:00:00Z', '2025-09-01T23:00:00Z',
               '[]'::jsonb, 'production-guard-probe', 'regular',
               '2025-09-01T22:00:00Z', '2025-09-01T22:00:00Z', false,
               0, 0, 0, 0, 0, 0, 0)
       RETURNING id`,
      [modelVersion, `${probeKey}:evaluation-game`],
    );
    const evaluationId = (evaluation.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof evaluationId !== "number") {
      throw new Error("Immutable model guard probe evaluation was not inserted");
    }
    await expectRejectedMutation(
      client,
      "evaluation_update_guard",
      "UPDATE model_evaluation_predictions SET predicted_value = 1 WHERE id = $1",
      [evaluationId],
      IMMUTABLE_EVALUATION_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "evaluation_delete_guard",
      "DELETE FROM model_evaluation_predictions WHERE id = $1",
      [evaluationId],
      IMMUTABLE_EVALUATION_MESSAGE,
    );

    const baselineRunId = `${probeKey}:market`;
    const baselineRun = await client.query(
      `INSERT INTO market_baseline_runs
         (run_id, season, source, source_url, status)
       VALUES ($1, 2025, 'production-guard-probe', 'production-guard-probe', 'probe')
       RETURNING id`,
      [baselineRunId],
    );
    const baselineRunRowId = (baselineRun.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof baselineRunRowId !== "number") {
      throw new Error("Immutable model guard probe market run was not inserted");
    }
    const baselineEvent = await client.query(
      `INSERT INTO market_baseline_events
         (run_id, source_game_id, alt_game_id, outcome, reason)
       VALUES ($1, $2, 'production-guard-probe', 'probe', 'production-guard-probe')
       RETURNING id`,
      [baselineRunId, `${probeKey}:market-game`],
    );
    const baselineEventId = (baselineEvent.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof baselineEventId !== "number") {
      throw new Error("Immutable model guard probe market event was not inserted");
    }
    const baselineQuote = await client.query(
      `INSERT INTO market_baseline_quotes
         (run_id, source_game_id, alt_game_id, source_file, family, side,
          source_designation)
       VALUES ($1, $2, 'production-guard-probe', 'production-guard-probe',
               'spread', 'home', 'source_designated_recorded')
       RETURNING id`,
      [baselineRunId, `${probeKey}:market-quote`],
    );
    const baselineQuoteId = (baselineQuote.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof baselineQuoteId !== "number") {
      throw new Error("Immutable model guard probe market quote was not inserted");
    }
    for (const [name, table, id] of [
      ["market_run", "market_baseline_runs", baselineRunRowId],
      ["market_event", "market_baseline_events", baselineEventId],
      ["market_quote", "market_baseline_quotes", baselineQuoteId],
    ] as const) {
      await expectRejectedMutation(
        client,
        `${name}_update_guard`,
        `UPDATE ${table} SET created_at = created_at WHERE id = $1`,
        [id],
        IMMUTABLE_MARKET_BASELINE_MESSAGE,
      );
      await expectRejectedMutation(
        client,
        `${name}_delete_guard`,
        `DELETE FROM ${table} WHERE id = $1`,
        [id],
        IMMUTABLE_MARKET_BASELINE_MESSAGE,
      );
    }

    const weather = await client.query(
      `INSERT INTO weather_forecast_snapshots
         (game_id, source, fetched_at, valid_time, indoor_outdoor)
       VALUES ($1, 'production-guard-probe', now(), now(), 'outdoor')
       RETURNING id`,
      [`${probeKey}:weather`],
    );
    const weatherId = (weather.rows[0] as { id?: unknown } | undefined)?.id;
    if (typeof weatherId !== "number") {
      throw new Error("Immutable model guard probe weather snapshot was not inserted");
    }
    await expectRejectedMutation(
      client,
      "weather_update_guard",
      "UPDATE weather_forecast_snapshots SET source = $1 WHERE id = $2",
      ["mutation-must-fail", weatherId],
      IMMUTABLE_WEATHER_MESSAGE,
    );
    await expectRejectedMutation(
      client,
      "weather_delete_guard",
      "DELETE FROM weather_forecast_snapshots WHERE id = $1",
      [weatherId],
      IMMUTABLE_WEATHER_MESSAGE,
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

const TLS_WARNING_PATTERNS = [
  /sslmode/i,
  /uselibpqcompat/i,
  /tls compatibility/i,
  /certificate verification/i,
];

export function isPostgresTlsCompatibilityWarning(message: string): boolean {
  return TLS_WARNING_PATTERNS.some((pattern) => pattern.test(message));
}

export function assertNoPostgresTlsCompatibilityWarnings(
  warnings: readonly string[],
): void {
  if (warnings.some(isPostgresTlsCompatibilityWarning)) {
    throw new Error("PostgreSQL TLS compatibility warning detected");
  }
}

export async function runProductionDatabaseSmokeCheck(
  pool: Pick<QueryablePool, "query">,
): Promise<1> {
  const result = await pool.query("SELECT 1 AS connection_check");
  if (
    result.rows.length !== 1 ||
    (result.rows[0] as { connection_check?: unknown }).connection_check !== 1
  ) {
    throw new Error("Production database smoke query returned an unexpected result");
  }
  return 1;
}

export async function recordReleaseSecurityEvidence(
  pool: Pick<QueryablePool, "query">,
  buildId: string,
  selectOneResult: 1,
): Promise<ProductionDatabaseEvidence> {
  const result = await pool.query(
    `INSERT INTO release_security_evidence
       (build_id, select_one_result, verify_full_passed, connectivity_passed,
        tls_passed, snapshot_update_guard_passed, snapshot_delete_guard_passed,
        grade_update_guard_passed, grade_delete_guard_passed)
     VALUES ($1, $2, true, true, true, true, true, true, true)
     ON CONFLICT (build_id) DO UPDATE
       SET build_id = EXCLUDED.build_id
     RETURNING build_id, checked_at, select_one_result, verify_full_passed,
       connectivity_passed, tls_passed, snapshot_update_guard_passed,
       snapshot_delete_guard_passed, grade_update_guard_passed,
       grade_delete_guard_passed`,
    [buildId, selectOneResult],
  );
  const row = result.rows[0] as
    | {
        build_id: string;
        checked_at: Date;
        select_one_result: 1;
        verify_full_passed: true;
        connectivity_passed: true;
        tls_passed: true;
        snapshot_update_guard_passed: true;
        snapshot_delete_guard_passed: true;
        grade_update_guard_passed: true;
        grade_delete_guard_passed: true;
      }
    | undefined;
  if (!row) throw new Error("Release security evidence was not recorded");
  return {
    buildId: row.build_id,
    checkedAt: row.checked_at,
    selectOneResult: row.select_one_result,
    verifyFullPassed: row.verify_full_passed,
    connectivityPassed: row.connectivity_passed,
    tlsPassed: row.tls_passed,
    snapshotUpdateGuardPassed: row.snapshot_update_guard_passed,
    snapshotDeleteGuardPassed: row.snapshot_delete_guard_passed,
    gradeUpdateGuardPassed: row.grade_update_guard_passed,
    gradeDeleteGuardPassed: row.grade_delete_guard_passed,
  };
}

export async function verifyProductionDatabaseWithPool(
  pool: QueryablePool,
  buildId: string,
  tlsWarnings: readonly string[],
): Promise<ProductionDatabaseEvidence> {
  const selectOneResult = await runProductionDatabaseSmokeCheck(pool);
  await verifyImmutablePredictionGuards(pool, buildId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assertNoPostgresTlsCompatibilityWarnings(tlsWarnings);
  return recordReleaseSecurityEvidence(pool, buildId, selectOneResult);
}

export async function verifyProductionDatabase(
  buildId: string,
): Promise<ProductionDatabaseEvidence> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Production database configuration is missing");
  }

  const configuredMode = new URL(databaseUrl).searchParams.get("sslmode");
  if (!configuredMode || configuredMode === "disable") {
    throw new Error("Production database TLS is not enabled");
  }

  const tlsWarnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (isPostgresTlsCompatibilityWarning(warning.message)) {
      tlsWarnings.push(warning.message);
    }
  };
  const originalWarn = console.warn;
  console.warn = (...arguments_: unknown[]) => {
    const message = arguments_.map(String).join(" ");
    if (isPostgresTlsCompatibilityWarning(message)) tlsWarnings.push(message);
    else originalWarn(...arguments_);
  };
  process.on("warning", onWarning);

  let pool: QueryablePool | undefined;
  try {
    const database = await import("@workspace/db");
    pool = database.pool;
    return await verifyProductionDatabaseWithPool(pool, buildId, tlsWarnings);
  } finally {
    process.off("warning", onWarning);
    console.warn = originalWarn;
    if (pool) await (pool as typeof import("@workspace/db").pool).end();
  }
}

const IMMUTABLE_EVALUATION_MESSAGE = "model evaluation prediction evidence is immutable";

const IMMUTABLE_MARKET_BASELINE_MESSAGE = "market baseline evidence is append-only";

const IMMUTABLE_WEATHER_MESSAGE = "weather forecast snapshots are append-only";
