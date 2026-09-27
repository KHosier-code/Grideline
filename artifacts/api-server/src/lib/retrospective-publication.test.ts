import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db, pool, gamesTable, teamsTable, modelTrainingRunsTable, modelPromotionHistoryTable,
  oddsApiRequestsTable, sportsbookOddsTable, pregameTeamFeaturesTable,
  initialLinePicksTable, initialWeeklyPicksTable, retrospectiveWeeklyReviewsTable,
  predictionSnapshotsTable,
} from "@workspace/db";
import consumerRouter from "../routes/consumer";
import { captureInitialLineOutcome, verifySavedPick, type InitialQuote } from "./initial-line-picks";
import { inspectRetrospectiveWeek } from "./retrospective-weekly-reviews";
import { artifactIdentityFor, PHASE6_SOURCE_FEATURE_NAMES, PHASE6_VECTOR_FEATURE_NAMES,
  PHASE6_VECTOR_SCHEMA_FINGERPRINT, type Algorithm, type Family, type FittedModelArtifact } from "./modeling";
import { PREGAME_FEATURE_VERSION } from "./features";

const confirmation = "I confirm this is retrospective, not an official first-line pick";
const kickoff = new Date("2026-09-20T17:00:00Z");
const requestedAt = new Date("2026-09-19T12:00:00Z");
const observedAt = new Date("2026-09-19T12:00:01Z");
const trainedAt = new Date("2026-09-18T12:00:00Z");
const promotedAt = new Date("2026-09-18T13:00:00Z");

test("authenticated Week 3 retrospective publication is atomic, separate from official picks, and public", async (t) => {
  if (process.env.GRIDLINE_RETROSPECTIVE_FIXTURE !== "1" || process.env.NODE_ENV !== "development"
    || process.env.REPLIT_DEPLOYMENT) throw new Error("Use the disposable retrospective runner only.");
  const identity = await pool.query(`select current_database() as database, current_user as role,
    pg_is_in_recovery() as replica, inet_server_addr()::text as address`);
  assert.deepEqual(identity.rows[0], {
    database: "gridline_retrospective_fixture", role: new URL(process.env.DATABASE_URL!).username,
    replica: false, address: "127.0.0.1/32",
  });
  t.after(() => pool.end());

  const families: Array<{ family: Family; algorithm: Algorithm; value: number }> = [
    { family: "spread", algorithm: "linear_regression", value: 3 },
    { family: "moneyline", algorithm: "logistic_regression", value: 1.4 },
    { family: "totals", algorithm: "linear_regression", value: 44 },
  ];
  for (const { family, algorithm, value } of families) {
    const artifact: FittedModelArtifact = {
      version: 1, algorithm, centers: PHASE6_VECTOR_FEATURE_NAMES.map(() => 0),
      scales: PHASE6_VECTOR_FEATURE_NAMES.map(() => 1),
      model: { kind: algorithm === "logistic_regression" ? "logistic" : "linear",
        coefficients: [value, ...PHASE6_VECTOR_FEATURE_NAMES.map(() => 0)] },
    };
    const trainingCutoff = "2026-W2";
    artifact.metadata = artifactIdentityFor(artifact, {
      family, algorithm, featureVersion: PREGAME_FEATURE_VERSION,
      vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      trainingSeasons: [2025], trainingCutoff, samplePolicy: "include_low_sample",
      hyperparameters: {}, randomSeed: null, trainingSampleCount: 2,
    });
    const modelVersion = `fixture-${family}`;
    await db.insert(modelTrainingRunsTable).values({
      modelVersion, family, algorithm, featureVersion: PREGAME_FEATURE_VERSION,
      trainingSeasons: [2025], testSeason: 2026, samplePolicy: "include_low_sample",
      sampleSize: 2, vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
      vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT, modelArtifact: artifact, trainedAt,
    });
    await db.insert(modelPromotionHistoryTable).values({
      family, modelVersion, algorithm, featureVersion: PREGAME_FEATURE_VERSION,
      trainingCutoff, role: "production", promotedAt, promotedBy: "fixture",
    });
  }
  const [request] = await db.insert(oddsApiRequestsTable).values({ requestedAt, status: "success" })
    .returning({ id: oddsApiRequestsTable.id });
  const games = [
    { gameId: "fixture-week3-a", home: "HMA", away: "AWA" },
    { gameId: "fixture-week3-b", home: "HMB", away: "AWB" },
  ];
  for (const game of games) {
    await db.insert(teamsTable).values([
      { teamId: game.home, abbreviation: game.home, teamName: `Home ${game.home}` },
      { teamId: game.away, abbreviation: game.away, teamName: `Away ${game.away}` },
    ]);
    await db.insert(gamesTable).values({
      gameId: game.gameId, season: 2026, week: 3, gameDate: kickoff,
      kickoffTime: kickoff, homeTeamId: game.home, awayTeamId: game.away, gameStatus: "final",
    });
    await db.insert(pregameTeamFeaturesTable).values([true, false].map((isHome) => ({
      featureVersion: PREGAME_FEATURE_VERSION, gameId: game.gameId,
      teamId: isHome ? game.home : game.away, opponentTeamId: isHome ? game.away : game.home,
      season: 2026, week: 3, kickoffTime: kickoff, isHome,
      sourceCutoff: new Date("2026-09-18T10:00:00Z"), generatedAt: new Date("2026-09-18T11:00:00Z"),
      lowSample: false,
      features: { ...Object.fromEntries(PHASE6_SOURCE_FEATURE_NAMES.map((name) => [name, 0])),
        qb_data_confidence: 0.8 },
    })));
    const quotes: InitialQuote[] = [
      { sportsbook: "DraftKings", market: "moneyline", selection: game.home, point: null, price: -135, sourceTimestamp: null },
      { sportsbook: "DraftKings", market: "moneyline", selection: game.away, point: null, price: 115, sourceTimestamp: null },
      { sportsbook: "DraftKings", market: "spread", selection: game.home, point: -2.5, price: -110, sourceTimestamp: null },
      { sportsbook: "DraftKings", market: "spread", selection: game.away, point: 2.5, price: -110, sourceTimestamp: null },
    ];
    await db.insert(sportsbookOddsTable).values(quotes.map((quote) => ({
      ...quote, gameId: game.gameId, capturedAt: observedAt,
    })));
    assert.equal(await captureInitialLineOutcome({
      gameId: game.gameId, requestId: request!.id, requestedAt, observedAt, quotes,
    }), true);
    const [saved] = await db.select().from(initialLinePicksTable).where(eq(initialLinePicksTable.gameId, game.gameId));
    assert.equal(saved?.status, "locked");
    assert.equal(await verifySavedPick(saved!), true);
  }
  // A separate official first-line selection already exists. The retrospective
  // algorithm ranks the other game, and publication must not replace either row.
  await db.insert(initialWeeklyPicksTable).values({ season: 2026, week: 3, gameId: games[1]!.gameId });
  const before = await inspectRetrospectiveWeek(2026, 3);
  assert.equal(before.reason, null);
  assert.equal(before.candidate?.gameId, games[0]!.gameId, "equal probabilities rank by game ID");
  assert.equal(before.review, null);
  assert.equal(before.officialExists, true);
  const officialOutcomesBefore = await db.select().from(initialLinePicksTable);
  const officialWeeklyBefore = await db.select().from(initialWeeklyPicksTable);

  const app = express();
  app.use(express.json());
  // Authenticate the in-process test request without a Clerk tenant or network call.
  app.use((req, _res, next) => {
    const userId = req.header("x-fixture-user");
    const auth = (() => ({ tokenType: "session_token", userId: userId ?? null,
      sessionClaims: { role: userId === "fixture-admin" ? "admin" : "member" } })) as
      (() => { tokenType: string; userId: string | null; sessionClaims: { role: string } }) & { [key: symbol]: boolean };
    auth[Symbol.for("@clerk/express.auth")] = true;
    Object.assign(req, { auth });
    req.log = { error() {}, warn() {} } as unknown as typeof req.log;
    next();
  });
  app.use(consumerRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (user: string | null, evidenceId: string) => fetch(`${base}/admin/retrospective-weekly-review`, {
    method: "POST", headers: { "content-type": "application/json", ...(user ? { "x-fixture-user": user } : {}) },
    body: JSON.stringify({ season: 2026, week: 3, evidenceId, confirm: confirmation }),
  });
  assert.equal((await post(null, before.candidate!.evidenceId)).status, 401);
  assert.equal((await post("fixture-member", before.candidate!.evidenceId)).status, 403);
  const stale = await post("fixture-admin", "0".repeat(64));
  assert.equal(stale.status, 409);
  assert.match(((await stale.json()) as { error: string }).error, /changed/i);
  assert.equal((await db.select().from(retrospectiveWeeklyReviewsTable)).length, 0);

  const responses = await Promise.all([post("fixture-admin", before.candidate!.evidenceId),
    post("fixture-admin", before.candidate!.evidenceId)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const successful = (await responses.find((response) => response.status === 201)!.json()) as {
    review: { status: string; evidenceId: string; gameId: string; publishedAt: string };
    officialExists: boolean;
  };
  assert.equal(successful.review.status, "published");
  assert.equal(successful.review.evidenceId, before.candidate!.evidenceId);
  assert.equal(successful.review.gameId, before.candidate!.gameId);
  assert.ok(successful.review.publishedAt);
  assert.equal(successful.officialExists, true);
  const [review] = await db.select().from(retrospectiveWeeklyReviewsTable);
  assert.equal(review?.reviewerId, "fixture-admin");
  assert.equal(review?.status, "published");
  assert.equal((await db.select().from(retrospectiveWeeklyReviewsTable)).length, 1);
  assert.equal((await post("fixture-admin", "f".repeat(64))).status, 409);

  const archiveResponse = await fetch(`${base}/consumer/weekly-picks?season=2026`);
  assert.equal(archiveResponse.status, 200);
  const archive = (await archiveResponse.json()) as { weeks: Array<{
    week: number; pick: { gameId: string } | null; reason: string | null;
    retrospective: { status: string; label: string; choice: { gameId: string; evidenceId: string } };
  }> };
  const week = archive.weeks.find((item: { week: number }) => item.week === 3);
  assert.ok(week, "the completed fixture slate must appear in the public archive");
  assert.equal(week.pick?.gameId, games[1]!.gameId);
  assert.equal(week.reason, null);
  assert.equal(week.retrospective.status, "published");
  assert.equal(week.retrospective.choice.gameId, before.candidate!.gameId);
  assert.equal(week.retrospective.choice.evidenceId, before.candidate!.evidenceId);
  assert.match(week.retrospective.label, /manually published retrospective/);
  assert.deepEqual(await db.select().from(initialWeeklyPicksTable), officialWeeklyBefore);
  assert.equal((await db.select().from(predictionSnapshotsTable)).length, 0);
  assert.deepEqual(await db.select().from(initialLinePicksTable), officialOutcomesBefore);
  await assert.rejects(db.update(retrospectiveWeeklyReviewsTable).set({ status: "unavailable" })
    .where(eq(retrospectiveWeeklyReviewsTable.week, 3)),
    (error: unknown) => /immutable/i.test(String((error as { cause?: Error }).cause?.message)));
});