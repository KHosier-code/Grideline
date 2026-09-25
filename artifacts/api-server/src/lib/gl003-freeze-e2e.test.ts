import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

const disposableUrlText = process.env.DATABASE_URL;
let disposableUrl: URL | undefined;
try {
  disposableUrl = disposableUrlText ? new URL(disposableUrlText) : undefined;
} catch {
  disposableUrl = undefined;
}

if (
  process.env.GL003_DISPOSABLE_DB !== "1"
  || disposableUrl?.protocol !== "postgresql:"
  || disposableUrl.hostname !== "127.0.0.1"
  || disposableUrl.port !== "55433"
  || disposableUrl.pathname !== "/gl003"
) {
  throw new Error(
    "GL003 database tests require GL003_DISPOSABLE_DB=1 and DATABASE_URL pointing only to postgresql://127.0.0.1:55433/gl003.",
  );
}

// Importing live-predictions or official-corrections imports @workspace/db.
// Keep both imports below the fail-closed disposable-database guard above.
const [{ db, gamesTable, pool, predictionSnapshotsTable, sportsbookOddsTable, teamsTable }, modeling] =
  await Promise.all([
    import("@workspace/db"),
    import("./modeling"),
  ]);
const { appendOfficialPredictionCorrection } = await import("./official-corrections");
const { freezeOfficialFinalPredictions, gradeCompletedPredictions, isEligiblePredictionSnapshot } = await import("./live-predictions");

const { PHASE6_VECTOR_FEATURE_NAMES, PHASE6_VECTOR_SCHEMA_FINGERPRINT } = modeling;

type Fixture = {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  kickoff: Date;
  cutoff: Date;
  predictionTime: Date;
  snapshotKey: string;
};

function eligibleEvidence(gameId: string, homeTeamId: string, awayTeamId: string, predictionTime: Date) {
  const sourceCutoff = new Date(predictionTime.getTime() - 60 * 60_000).toISOString();
  const generatedAt = new Date(predictionTime.getTime() - 30 * 60_000).toISOString();
  const selectedValues = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 1]));
  const awaySelectedValues = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 0]));
  const vector = [
    ...PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map(() => 1),
    0,
    0,
    0,
  ];
  return {
    inputVector: vector,
    vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
    vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
    inputFeatureCount: vector.length,
    inputMissingFeatureCount: 0,
    inputSourceEvidence: {
      rows: [
        {
          gameId,
          teamId: homeTeamId,
          opponentTeamId: awayTeamId,
          isHome: true,
          sourceCutoff,
          generatedAt,
          selectedValues,
          lowSample: false,
          qbDataConfidence: 0.8,
        },
        {
          gameId,
          teamId: awayTeamId,
          opponentTeamId: homeTeamId,
          isHome: false,
          sourceCutoff,
          generatedAt,
          selectedValues: awaySelectedValues,
          lowSample: false,
          qbDataConfidence: 0.8,
        },
      ],
    },
  };
}

async function createFixture(odds: "complete" | "partial" | "missing" = "complete"): Promise<Fixture> {
  const unique = randomUUID().replaceAll("-", "");
  const gameId = `gl003-e2e-${unique}`;
  const homeTeamId = `gl003-home-${unique}`;
  const awayTeamId = `gl003-away-${unique}`;
  const homeTeamName = `GL003 Home ${unique}`;
  const kickoff = new Date(Date.now() + 5 * 60_000);
  const cutoff = new Date(kickoff.getTime() - 30 * 60_000);
  const predictionTime = new Date(cutoff.getTime() - 60_000);
  const snapshotKey = `${gameId}:input-integrity-v3:${PHASE6_VECTOR_SCHEMA_FINGERPRINT}`;

  await db.insert(teamsTable).values([
    { teamId: homeTeamId, abbreviation: `H${unique.slice(0, 2)}`, teamName: homeTeamName },
    { teamId: awayTeamId, abbreviation: `A${unique.slice(0, 2)}`, teamName: `GL003 Away ${unique}` },
  ]);
  await db.insert(gamesTable).values({
    gameId,
    season: 2030,
    week: 1,
    gameDate: kickoff,
    kickoffTime: kickoff,
    homeTeamId,
    awayTeamId,
    gameStatus: "scheduled",
  });

  const evidence = eligibleEvidence(gameId, homeTeamId, awayTeamId, predictionTime);
  assert.equal(isEligiblePredictionSnapshot({
    gameId,
    snapshotKey,
    predictionTimestamp: predictionTime,
    kickoffTime: kickoff,
    spreadModelVersion: "gl003-e2e-spread",
    moneylineModelVersion: "gl003-e2e-moneyline",
    totalsModelVersion: "gl003-e2e-totals",
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    ...evidence,
  }), true, "the persisted candidate fixture must satisfy isEligiblePredictionSnapshot");
  await db.insert(predictionSnapshotsTable).values({
    snapshotKey,
    gameId,
    predictionTimestamp: predictionTime,
    snapshotLabel: "final-pre-kickoff",
    kickoffTime: kickoff,
    featureVersion: "gl003-e2e-feature",
    spreadModelVersion: "gl003-e2e-spread",
    moneylineModelVersion: "gl003-e2e-moneyline",
    totalsModelVersion: "gl003-e2e-totals",
    trainingCutoff: "gl003-e2e",
    projectedHomeScore: 24,
    projectedAwayScore: 20,
    projectedMargin: 4,
    projectedTotal: 44,
    homeWinProbability: 0.6,
    awayWinProbability: 0.4,
    lowSample: false,
    qbConfidence: 0.8,
    ...evidence,
  });

  if (odds !== "missing") {
    const capturedAt = new Date(cutoff.getTime() - 5 * 60_000);
    const markets = [
      { market: "spread", outcomes: [[homeTeamName, -3.5], [`GL003 Away ${unique}`, -3.5]] },
      { market: "moneyline", outcomes: [[homeTeamName, null], [`GL003 Away ${unique}`, null]] },
      { market: "total", outcomes: [["Over", 44.5], ["Under", 44.5]] },
    ] as const;
    const quoteRows = [];
    for (const { market, outcomes } of markets) {
      for (const sportsbook of ["DraftKings", "FanDuel"]) {
        for (const [selection, point] of outcomes) {
          if (odds === "partial" && market === "total" && sportsbook === "FanDuel" && selection === "Under") continue;
          quoteRows.push({
            gameId,
            sportsbook,
            capturedAt,
            market,
            selection,
            point,
            price: -110,
          });
        }
      }
    }
    await db.insert(sportsbookOddsTable).values(quoteRows);
  }

  return { gameId, homeTeamId, awayTeamId, homeTeamName, kickoff, cutoff, predictionTime, snapshotKey };
}

async function frozenSnapshot(snapshotKey: string) {
  const [snapshot] = await db.select().from(predictionSnapshotsTable)
    .where((await import("drizzle-orm")).eq(predictionSnapshotsTable.snapshotKey, snapshotKey)).limit(1);
  assert.ok(snapshot, `Expected snapshot ${snapshotKey} to exist`);
  return snapshot;
}

test("GL003: disposable PostgreSQL end-to-end official prediction freeze", async (t) => {
  await t.test("freezes eligible predictions on time with complete odds and is idempotent", async () => {
    const fixture = await createFixture("complete");
    const freezeAt = new Date();
    const first = await freezeOfficialFinalPredictions(freezeAt, { gameId: fixture.gameId });
    assert.equal(first.frozen, 1);
    assert.equal(first.pendingMarketEvidence, 0);
    assert.equal(first.canonicalCutoffAt, fixture.cutoff.toISOString());

    const second = await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId });
    assert.equal(second.frozen, 0);
    const snapshot = await frozenSnapshot(fixture.snapshotKey);
    assert.equal(snapshot.officialFinalPrediction, true);
    assert.equal(snapshot.evaluationCutoffAt?.toISOString(), fixture.cutoff.toISOString());
    assert.ok(snapshot.frozenAt);
  });

  await t.test("freezes on time with partial odds and reports incomplete market evidence", async () => {
    const fixture = await createFixture("partial");
    const result = await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId });
    assert.equal(result.frozen, 1);
    assert.equal(result.pendingMarketEvidence, 1);
    assert.equal((await frozenSnapshot(fixture.snapshotKey)).officialFinalPrediction, true);
  });

  await t.test("freezes on time with missing odds and reports incomplete market evidence", async () => {
    const fixture = await createFixture("missing");
    const result = await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId });
    assert.equal(result.frozen, 1);
    assert.equal(result.pendingMarketEvidence, 1);
    assert.equal((await frozenSnapshot(fixture.snapshotKey)).officialFinalPrediction, true);
  });

  await t.test("does not freeze an otherwise eligible prediction after kickoff", async () => {
    const fixture = await createFixture("complete");
    const afterKickoff = new Date(fixture.kickoff.getTime() + 1_000);
    const result = await freezeOfficialFinalPredictions(afterKickoff, { gameId: fixture.gameId });
    assert.equal(result.frozen, 0);
    assert.equal((await frozenSnapshot(fixture.snapshotKey)).officialFinalPrediction, false);
  });

  await t.test("appendOfficialPredictionCorrection writes a separately labeled nonofficial row after kickoff", async () => {
    const fixture = await createFixture("complete");
    const freezeResult = await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId });
    assert.equal(freezeResult.frozen, 1);

    const result = await appendOfficialPredictionCorrection({
      officialSnapshotKey: fixture.snapshotKey,
      correctionId: `review-${randomUUID().replaceAll("-", "")}`,
      reason: "Post-game audit correction fixture",
      recordedBy: "GL003 disposable end-to-end test",
      corrected: {
        projectedHomeScore: 25,
        projectedAwayScore: 20,
        projectedMargin: 5,
        projectedTotal: 45,
        homeWinProbability: 0.62,
        awayWinProbability: 0.38,
      },
      now: new Date(fixture.kickoff.getTime() + 1_000),
    });
    assert.equal(result.created, true);
    assert.equal(result.label, "post-kickoff-correction");
    const correction = await frozenSnapshot(result.snapshotKey);
    assert.equal(correction.snapshotLabel, "post-kickoff-correction");
    assert.equal(correction.officialFinalPrediction, false);
    assert.equal(correction.predictionTimestamp.toISOString(), new Date(fixture.kickoff.getTime() + 1_000).toISOString());
    assert.equal((await frozenSnapshot(fixture.snapshotKey)).officialFinalPrediction, true);
  });

  await t.test("database guards reject UPDATE and DELETE of the official frozen row", async () => {
    const fixture = await createFixture("complete");
    const freezeResult = await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId });
    assert.equal(freezeResult.frozen, 1);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SAVEPOINT gl003_update_guard");
      await assert.rejects(
        client.query("UPDATE prediction_snapshots SET snapshot_label = 'changed' WHERE snapshot_key = $1", [
          fixture.snapshotKey,
        ]),
        /immutable/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT gl003_update_guard");

      await client.query("SAVEPOINT gl003_delete_guard");
      await assert.rejects(
        client.query("DELETE FROM prediction_snapshots WHERE snapshot_key = $1", [fixture.snapshotKey]),
        /immutable/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT gl003_delete_guard");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.equal((await frozenSnapshot(fixture.snapshotKey)).officialFinalPrediction, true);
  });

  await t.test("database unique index rejects a second official row for the same game", async () => {
    const fixture = await createFixture("complete");
    assert.equal((await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId })).frozen, 1);
    const client = await pool.connect();
    try {
      const secondKey = `${fixture.snapshotKey}:duplicate`;
      await client.query(
        `INSERT INTO prediction_snapshots
          (snapshot_key, game_id, prediction_timestamp, kickoff_time,
           snapshot_label, feature_version, training_cutoff)
         VALUES ($1, $2, $3, $4, 'duplicate-fixture', 'fixture', 'fixture')`,
        [secondKey, fixture.gameId, fixture.predictionTime, fixture.kickoff],
      );
      await assert.rejects(
        client.query(
          `UPDATE prediction_snapshots
           SET official_final_prediction=true, evaluation_cutoff_at=$1, frozen_at=now()
           WHERE snapshot_key=$2`,
          [fixture.cutoff, secondKey],
        ),
        (error: any) => error.code === "23505",
      );
    } finally {
      client.release();
    }
  });

  await t.test("database rejects an official INSERT even when it is the first row for a game", async () => {
    const fixture = await createFixture("missing");
    const client = await pool.connect();
    try {
      await assert.rejects(
        client.query(
          `INSERT INTO prediction_snapshots
            (snapshot_key, game_id, prediction_timestamp, kickoff_time,
             snapshot_label, feature_version, training_cutoff, official_final_prediction,
             evaluation_cutoff_at, frozen_at)
           VALUES ($1, $2, $3, $4, 'direct-official', 'fixture', 'fixture', true, $5, now())`,
          [`${fixture.snapshotKey}:direct`, fixture.gameId, fixture.predictionTime, fixture.kickoff, fixture.cutoff],
        ),
        /validated pending-to-official freeze/i,
      );
    } finally {
      client.release();
    }
  });

  await t.test("GL-002-style on-time transition works, but a late first freeze fails closed", async () => {
    const onTime = await createFixture("missing");
    const late = await createFixture("missing");
    const client = await pool.connect();
    try {
      // The published GL-002 code uses the same pending-to-official UPDATE shape.
      const transition = await client.query(
        `UPDATE prediction_snapshots
         SET official_final_prediction=true, evaluation_cutoff_at=$1, frozen_at=now()
         WHERE snapshot_key=$2 AND official_final_prediction=false RETURNING id`,
        [onTime.cutoff, onTime.snapshotKey],
      );
      assert.equal(transition.rowCount, 1);
      const grade = await client.query(
        "INSERT INTO prediction_grades(prediction_id) VALUES ($1) RETURNING id",
        [transition.rows[0].id],
      );
      assert.equal(grade.rowCount, 1);
      // GL-002 can try to freeze an ineligible candidate after kickoff; 0034
      // rejects the transition, rather than making it an official record.
      await assert.rejects(client.query(
        `UPDATE prediction_snapshots
         SET official_final_prediction=true, evaluation_cutoff_at=$1, frozen_at=$2
         WHERE snapshot_key=$3 AND official_final_prediction=false`,
        [late.cutoff, new Date(late.kickoff.getTime() + 1_000), late.snapshotKey],
      ), /pre-kickoff freeze/i);
      assert.equal((await frozenSnapshot(late.snapshotKey)).officialFinalPrediction, false);
    } finally {
      client.release();
    }
  });

  await t.test("grading keeps model errors separate and grade UPDATE/DELETE are rejected", async () => {
    const fixture = await createFixture("missing");
    assert.equal((await freezeOfficialFinalPredictions(new Date(), { gameId: fixture.gameId })).frozen, 1);
    const [official] = await db.select().from(predictionSnapshotsTable)
      .where((await import("drizzle-orm")).eq(predictionSnapshotsTable.snapshotKey, fixture.snapshotKey)).limit(1);
    assert.ok(official);
    const client = await pool.connect();
    try {
      // The grading worker only grades final games. The official prediction itself remains immutable.
      await client.query(
        "UPDATE games SET game_status='final', final_home_score=27, final_away_score=20 WHERE game_id=$1",
        [fixture.gameId],
      );
      const result = await gradeCompletedPredictions(new Date(fixture.kickoff.getTime() + 60_000));
      assert.ok(result.graded >= 1);
      const { rows } = await client.query<{ id: number; market_results: Record<string, any> }>(
        "SELECT id,market_results FROM prediction_grades WHERE prediction_id=$1", [official.id],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].market_results.projectionError.marginError, -3);
      assert.equal(rows[0].market_results.spread.status, "unavailable");
      assert.equal(rows[0].market_results.moneyline.status, "unavailable");
      assert.equal(rows[0].market_results.totals.status, "unavailable");
      await client.query("BEGIN");
      await client.query("SAVEPOINT gl003_grade_update");
      await assert.rejects(
        client.query("UPDATE prediction_grades SET actual_home_score=0 WHERE id=$1", [rows[0].id]),
        /immutable/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT gl003_grade_update");
      await client.query("SAVEPOINT gl003_grade_delete");
      await assert.rejects(
        client.query("DELETE FROM prediction_grades WHERE id=$1", [rows[0].id]),
        /immutable/i,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});