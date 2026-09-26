import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db, pool, schedulerJobsTable, dataSyncRunsTable, gamesTable,
  teamsTable, predictionSnapshotsTable, modelTrainingRunsTable,
  modelPromotionHistoryTable, pregameTeamFeaturesTable, oddsApiRequestsTable,
  sportsbookOddsTable, initialLinePicksTable, initialWeeklyPicksTable,
} from "@workspace/db";
import { captureInitialLineOutcome, selectInitialWeeklyPick, readInitialWeeklyPick } from "./initial-line-picks";
import {
  artifactIdentityFor, PHASE6_VECTOR_FEATURE_NAMES, PHASE6_VECTOR_SCHEMA_FINGERPRINT,
  type FittedModelArtifact,
} from "./modeling";
import {
  generateLivePredictions, getLatestValidPredictionSnapshots,
  freezeOfficialFinalPredictions, isEligiblePredictionSnapshot,
} from "./live-predictions";

const NOW = new Date("2026-09-26T02:09:54Z");
const PAST = new Date("2026-09-17T18:20:00Z");
const FUTURE = new Date("2026-09-27T17:00:00Z");
const futureId = "rehearsal-future-1";
const date = (value: Date) => value.toISOString();
type Job = typeof schedulerJobsTable.$inferInsert;

function overdueJobs(): Job[] {
  const jobs: Job[] = [];
  const add = (jobKey: string, kind: string, provider: string, due = PAST) =>
    jobs.push({ jobKey, kind, provider, cadence: "sanitized report occurrence", nextRunAt: due });
  add("espn-schedule", "schedule", "espn-schedule");
  add("pregame-v3-future-repair", "pregame-feature-repair", "pregame-features");
  add("pregame-v4-personnel-context", "personnel-context", "phase7-personnel-context");
  for (const key of ["thursday-afternoon", "friday-morning", "friday-afternoon", "saturday",
    "sunday-morning", "sunday-late-morning", "tuesday", "wednesday", "thursday-morning"])
    add(`injury-${key}`, "injury", "espn-injuries");
  add("odds-adaptive", "odds-adaptive", "odds-api");
  for (let id = 401872933; id <= 401872948; id++) {
    for (const offset of ["24h", "6h", "75m"])
      add(`confidence-${offset}-${id}`, "confidence-capture", "gridline-confidence");
  }
  add("confidence-75m-401872932", "confidence-capture", "gridline-confidence");
  for (let id = 401872932; id <= 401872948; id++) {
    // The due timestamp is a sanitized representative, not a copied live row.
    add(`prediction-freeze-${id}`, "prediction-freeze", "gridline-model",
      new Date(Date.UTC(2026, 8, id === 401872948 ? 25 : 18, 0, 15)));
  }
  add("sleeper-players", "sleeper-players", "sleeper-players");
  for (const key of ["friday", "saturday", "sunday", "tuesday", "thursday"])
    add(`predictions-${key}`, "prediction", "gridline-model");
  for (const window of ["early", "late", "snf"])
    add(`injury-sunday-window-2026-09-20-${window}`, "injury-kickoff", "espn-injuries");
  add("predictions-grade", "prediction-grade", "gridline-model");
  add("injury-monday-final", "injury-dynamic", "espn-injuries");
  add("nflverse-completed-window", "nflverse", "nflverse");
  add("models-challenger-weekly", "model-challenger", "gridline-model");
  assert.equal(jobs.length, 92);
  assert.equal(new Set(jobs.map((job) => job.jobKey)).size, 92);
  return jobs;
}

async function seed() {
  const existing = await db.select({ jobKey: schedulerJobsTable.jobKey }).from(schedulerJobsTable).limit(1);
  assert.equal(existing.length, 0, "fixture database must be empty");
  await db.insert(teamsTable).values([
    { teamId: "rehearsal-home", teamName: "Fixture Home", abbreviation: "FHO" },
    { teamId: "rehearsal-away", teamName: "Fixture Away", abbreviation: "FAW" },
  ]);
  await db.insert(gamesTable).values([
    ...Array.from({ length: 17 }, (_, index) => ({
      gameId: String(401872932 + index), season: 2026, week: 2,
      gameDate: new Date("2026-09-18T00:45:00Z"),
      kickoffTime: new Date("2026-09-18T00:45:00Z"),
      gameStatus: "final", homeTeamId: "rehearsal-home", awayTeamId: "rehearsal-away",
    })),
    { gameId: futureId, season: 2026, week: 3, gameDate: FUTURE, kickoffTime: FUTURE,
      gameStatus: "scheduled", homeTeamId: "rehearsal-home", awayTeamId: "rehearsal-away" },
  ]);
  const homeValues = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 2]));
  const awayValues = Object.fromEntries(PHASE6_VECTOR_FEATURE_NAMES.slice(0, -3).map((name) => [name, 1]));
  const evidence = (teamId: string, opponentTeamId: string, isHome: boolean) => ({
    gameId: "401872932", teamId, opponentTeamId, isHome,
    sourceCutoff: "2026-09-17T20:00:00.000Z", generatedAt: "2026-09-17T20:30:00.000Z",
    lowSample: false, qbDataConfidence: isHome ? 1 : 0.5,
    selectedValues: isHome ? homeValues : awayValues,
  });
  const oldSnapshot = {
    snapshotKey: `401872932:fixture:spread-old:moneyline-old:totals-old:input-integrity-v3:${PHASE6_VECTOR_SCHEMA_FINGERPRINT}`,
    gameId: "401872932", predictionTimestamp: new Date("2026-09-17T21:00:00Z"),
    kickoffTime: new Date("2026-09-18T00:45:00Z"),
    snapshotLabel: "historical", featureVersion: "pregame-v3", trainingCutoff: "fixture",
    spreadModelVersion: "spread-old", moneylineModelVersion: "moneyline-old",
    totalsModelVersion: "totals-old", projectedHomeScore: 24, projectedAwayScore: 20,
    projectedMargin: 4, projectedTotal: 44, homeWinProbability: 0.6, awayWinProbability: 0.4,
    inputFeatureCount: 27, inputMissingFeatureCount: 0,
    inputVector: [...Array(24).fill(1), 0, 0, 0.5],
    vectorFeatureNames: [...PHASE6_VECTOR_FEATURE_NAMES],
    vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
    inputSourceEvidence: { rows: [
      evidence("rehearsal-home", "rehearsal-away", true),
      evidence("rehearsal-away", "rehearsal-home", false),
    ] },
    marketSnapshot: { fixture: "preserved" }, marketComparison: { fixture: "preserved" },
  };
  assert.equal(isEligiblePredictionSnapshot(oldSnapshot), true);
  await db.insert(predictionSnapshotsTable).values(oldSnapshot);
  await db.insert(schedulerJobsTable).values([
    ...overdueJobs(),
    { jobKey: "fixture-future", kind: "fixture-future", provider: "fixture",
      cadence: "future untouched", nextRunAt: FUTURE },
  ]);
  return { seededOverdue: 92, representativeFuture: 1, historicalFreezeIds:
    Array.from({ length: 17 }, (_, index) => String(401872932 + index)) };
}

async function audit() {
  const jobs = await db.select().from(schedulerJobsTable);
  const runs = await db.select().from(dataSyncRunsTable);
  const baseline = new Set(overdueJobs().map((job) => job.jobKey));
  const itemized = jobs.sort((a, b) => a.jobKey.localeCompare(b.jobKey)).map((job) => {
    const matching = runs.filter((run) => run.jobKey === job.jobKey);
    return {
      key: job.jobKey, kind: job.kind, originalOverdue: baseline.has(job.jobKey),
      enabled: job.enabled, nextRunAt: job.nextRunAt && date(job.nextRunAt),
      outcome: matching.length ? job.enabled ? "skipped_rearmed" : "skipped_disabled"
        : baseline.has(job.jobKey)
          ? job.lastError && (job.nextRunAt === null || job.nextRunAt > NOW)
            ? job.enabled ? "reconciled_rearmed_before_recovery" : "reconciled_disabled_before_recovery"
            : "pending"
          : "newly_reconciled_or_future",
      wouldExecuteLater: job.enabled && Boolean(job.nextRunAt && job.nextRunAt > NOW),
      runStatus: matching.map((run) => run.status),
      skipReason: matching.map((run) => run.skipReason),
    };
  });
  const byKind: Record<string, typeof itemized> = {};
  for (const row of itemized.filter((item) => item.originalOverdue))
    (byKind[row.kind] ??= []).push(row);
  const historical = itemized.filter((row) => row.key.startsWith("prediction-freeze-"));
  const [preserved] = await db.select().from(predictionSnapshotsTable)
    .where(eq(predictionSnapshotsTable.gameId, "401872932"));
  assert.ok(preserved && isEligiblePredictionSnapshot(preserved));
  assert.equal(preserved.officialFinalPrediction, false);
  assert.deepEqual(preserved.marketSnapshot, { fixture: "preserved" });
  assert.deepEqual(preserved.marketComparison, { fixture: "preserved" });
  if (runs.length) {
    assert.equal(runs.filter((row) => baseline.has(row.jobKey ?? "")).length, 92);
    assert.ok(runs.filter((row) => baseline.has(row.jobKey ?? "")).every((row) => row.status === "skipped"));
    assert.equal(historical.length, 17);
    assert.ok(historical.every((row) => row.outcome === "skipped_disabled" && row.nextRunAt === null));
    assert.equal((await db.select().from(predictionSnapshotsTable)).length, 1);
  }
  return {
    clock: date(NOW), originalOverdue: 92, schedulerRuns: runs.length,
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, rows]) => [kind, {
      original: rows?.length, skipped: rows?.filter((row) => row.runStatus.includes("skipped")).length,
      disabled: rows?.filter((row) => !row.enabled).length,
      rearmed: rows?.filter((row) => row.outcome === "skipped_rearmed").length,
      wouldExecuteLater: rows?.filter((row) => row.wouldExecuteLater).length,
    }])),
    newlyReconciled: itemized.filter((row) => !row.originalOverdue && row.key !== "fixture-future"),
    historicalFreezes: historical, itemized,
    preservedPregameSnapshot: { gameId: preserved.gameId, snapshotKey: preserved.snapshotKey,
      inputValid: true, marketEvidenceUnchanged: true, officialFinalPrediction: false },
    providerContacts: 0, scheduledExecutions: 0, retentionDeletions: 0,
    liveDatabaseWrites: 0,
  };
}

async function writer() {
  const names = [...PHASE6_VECTOR_FEATURE_NAMES];
  const familyVersions: Record<string, string> = {};
  for (const family of ["spread", "moneyline", "totals"] as const) {
    const config = {
      family, algorithm: "linear_regression" as const, featureVersion: "pregame-v3",
      vectorFeatureNames: names, vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      trainingSeasons: [2024, 2025], trainingCutoff: "2025-12-31",
      samplePolicy: "include_low_sample" as const, hyperparameters: {}, randomSeed: null, trainingSampleCount: 2,
    };
    const value = family === "spread" ? 4 : family === "totals" ? 44 : 0.6;
    const artifact: FittedModelArtifact = {
      version: 1, algorithm: "linear_regression",
      centers: Array(27).fill(0), scales: Array(27).fill(1),
      model: { kind: "linear", coefficients: [value, ...Array(27).fill(0)] },
    };
    artifact.metadata = artifactIdentityFor(artifact, config);
    const version = `fixture-${family}-${artifact.metadata.artifactChecksum.slice(0, 12)}`;
    familyVersions[family] = version;
    await db.insert(modelTrainingRunsTable).values({
      modelVersion: version, family, algorithm: "linear_regression",
      featureVersion: "pregame-v3", trainingSeasons: [2024, 2025],
      testSeason: 2026, samplePolicy: "include_low_sample", sampleSize: 2,
      trainedAt: new Date("2026-09-25T00:00:00Z"),
      vectorFeatureNames: names, vectorSchemaFingerprint: PHASE6_VECTOR_SCHEMA_FINGERPRINT,
      modelArtifact: artifact,
    });
    await db.insert(modelPromotionHistoryTable).values({
      modelVersion: version, family, algorithm: "linear_regression", featureVersion: "pregame-v3",
      trainingCutoff: "2025-12-31", promotedBy: "disposable-fixture",
      promotedAt: new Date("2026-09-25T01:00:00Z"),
    });
  }
  const selected = names.slice(0, -3);
  for (const [teamId, opponentTeamId, isHome] of [
    ["rehearsal-home", "rehearsal-away", true],
    ["rehearsal-away", "rehearsal-home", false],
  ] as const) {
    await db.insert(pregameTeamFeaturesTable).values({
      featureVersion: "pregame-v3", gameId: futureId, teamId, opponentTeamId,
      season: 2026, week: 3, kickoffTime: FUTURE, isHome,
      sourceCutoff: new Date("2026-09-26T01:00:00Z"),
      generatedAt: new Date("2026-09-26T01:30:00Z"), lowSample: false,
      features: { ...Object.fromEntries(selected.map((name) => [name, isHome ? 2 : 1])),
        qb_data_confidence: isHome ? 1 : 0.5 },
    });
  }
  const result = await generateLivePredictions(NOW);
  assert.equal(result.snapshotsCreated, 1, JSON.stringify(result));
  const [saved] = await db.select().from(predictionSnapshotsTable).where(eq(predictionSnapshotsTable.gameId, futureId));
  const selectedSnapshot = (await getLatestValidPredictionSnapshots([futureId],
    { preKickoffOnly: true, authoritativeGameKickoff: true })).get(futureId);
  assert.equal(selectedSnapshot?.id, saved.id);
  assert.equal(saved.inputVector?.length, 27);
  assert.ok(saved.inputVector?.every(Number.isFinite));
  assert.deepEqual(saved.vectorFeatureNames, names);
  assert.equal(saved.vectorSchemaFingerprint, PHASE6_VECTOR_SCHEMA_FINGERPRINT);
  assert.deepEqual([saved.spreadModelVersion, saved.moneylineModelVersion, saved.totalsModelVersion],
    ["spread", "moneyline", "totals"].map((family) => familyVersions[family]));
  assert.equal((saved.inputSourceEvidence?.rows as unknown[])?.length, 2);
  const negative = {
    missingVector: { ...saved, inputVector: null },
    missingNames: { ...saved, vectorFeatureNames: null },
    missingSchema: { ...saved, vectorSchemaFingerprint: null },
    missingSource: { ...saved, inputSourceEvidence: null },
    missingCount: { ...saved, inputFeatureCount: 0 },
    nonzeroMissingCount: { ...saved, inputMissingFeatureCount: 1 },
    missingSpreadVersion: { ...saved, spreadModelVersion: null },
    missingMoneylineVersion: { ...saved, moneylineModelVersion: null },
    missingTotalsVersion: { ...saved, totalsModelVersion: null },
    wrongSchema: { ...saved, vectorSchemaFingerprint: "wrong" },
    wrongNamesOrder: { ...saved, vectorFeatureNames: [...names].reverse() },
    missingEvidenceRow: { ...saved, inputSourceEvidence: { rows: [] } },
    wrongPromotion: { ...saved, spreadModelVersion: "old-spread" },
    wrongChronology: { ...saved, inputSourceEvidence: {
      rows: (saved.inputSourceEvidence?.rows as Record<string, unknown>[]).map((row) => ({
        ...row, sourceCutoff: FUTURE.toISOString(),
      })),
    } },
    postKickoff: { ...saved, predictionTimestamp: new Date(FUTURE.getTime() + 60_000) },
  };
  const negativeIds: string[] = [];
  for (const [name, candidate] of Object.entries(negative)) {
    if (name !== "wrongPromotion" && name !== "postKickoff")
      assert.equal(isEligiblePredictionSnapshot(candidate), false, name);
    const gameId = `rehearsal-negative-${name}`;
    negativeIds.push(gameId);
    await db.insert(gamesTable).values({
      gameId, season: 2026, week: 3, gameDate: FUTURE, kickoffTime: FUTURE,
      homeTeamId: "rehearsal-home", awayTeamId: "rehearsal-away", gameStatus: "scheduled",
    });
    const { id: _id, ...row } = candidate;
    await db.insert(predictionSnapshotsTable).values({
      ...row, gameId, snapshotKey: `${candidate.snapshotKey}:${name}`,
      inputSourceEvidence: candidate.inputSourceEvidence
        ? { rows: (candidate.inputSourceEvidence.rows as Record<string, unknown>[]).map((evidence) =>
          ({ ...evidence, gameId })) } : null,
    });
  }
  assert.equal((await getLatestValidPredictionSnapshots(negativeIds,
    { authoritativeGameKickoff: true })).size, 0, "negative persisted rows must not select");
  // Database selector must not return a mismatched promotion or a late row.
  await db.insert(modelPromotionHistoryTable).values({
    modelVersion: "mismatch", family: "spread", algorithm: "linear_regression",
    featureVersion: "pregame-v3", trainingCutoff: "2025-12-31",
    promotedBy: "disposable-fixture", promotedAt: new Date("2026-09-26T03:00:00Z"),
  });
  assert.equal((await getLatestValidPredictionSnapshots([futureId],
    { authoritativeGameKickoff: true })).size, 0);
  await db.delete(modelPromotionHistoryTable).where(eq(modelPromotionHistoryTable.modelVersion, "mismatch"));
  const late = await freezeOfficialFinalPredictions(new Date("2026-09-28T00:00:00Z"),
    { gameId: futureId });
  assert.equal(late.frozen, 0);
  const [unchanged] = await db.select().from(predictionSnapshotsTable).where(eq(predictionSnapshotsTable.id, saved.id));
  assert.deepEqual(unchanged.marketSnapshot, saved.marketSnapshot);
  assert.equal(unchanged.officialFinalPrediction, false);
  // Model a future *successful* scheduled request, not an upstream call. Its
  // quotes are already persisted, exactly as the normal odds adapter does
  // before deciding the first line. An older quote can never be relabeled.
  const requestedAt = new Date("2026-09-26T02:15:00Z");
  const observedAt = new Date("2026-09-26T02:15:02Z");
  const [request] = await db.insert(oddsApiRequestsTable).values({
    requestedAt, status: "success", intentKey: "odds-adaptive:disposable-future-slot",
    metadata: { jobKey: "odds-adaptive", scheduledFor: requestedAt.toISOString() },
  }).returning({ id: oddsApiRequestsTable.id });
  const quotes = [
    { sportsbook: "DraftKings", market: "moneyline", selection: "FHO", point: null, price: -135, sourceTimestamp: null },
    { sportsbook: "DraftKings", market: "moneyline", selection: "FAW", point: null, price: 115, sourceTimestamp: null },
    { sportsbook: "DraftKings", market: "spread", selection: "FHO", point: -2.5, price: -110, sourceTimestamp: null },
    { sportsbook: "DraftKings", market: "spread", selection: "FAW", point: 2.5, price: -110, sourceTimestamp: null },
  ];
  const legacyId = "rehearsal-legacy", emptyId = "rehearsal-no-line";
  await db.insert(gamesTable).values([legacyId, emptyId].map((gameId) => ({
    gameId, season: 2026, week: 3, gameDate: FUTURE, kickoffTime: FUTURE,
    homeTeamId: "rehearsal-home", awayTeamId: "rehearsal-away", gameStatus: "scheduled",
  })));
  await db.insert(sportsbookOddsTable).values([
    ...[futureId, legacyId].flatMap((gameId) => quotes.map((quote) => ({
      ...quote, gameId, capturedAt: observedAt,
    }))),
    { ...quotes[0]!, gameId: legacyId, capturedAt: new Date(requestedAt.getTime() - 60_000) },
  ]);
  const first = { requestId: request!.id, requestedAt, observedAt, quotes };
  assert.equal(await captureInitialLineOutcome({ ...first, gameId: futureId }), true);
  assert.equal(await captureInitialLineOutcome({ ...first, gameId: legacyId }), true);
  assert.equal(await captureInitialLineOutcome({ ...first, gameId: emptyId, quotes: [] }), true);
  const decisions = await db.select().from(initialLinePicksTable);
  const statuses = Object.fromEntries(decisions.map((row) => [row.gameId, row.status]));
  assert.equal(statuses[futureId], "locked");
  assert.equal(statuses[legacyId], "legacy_unattributed");
  assert.equal(statuses[emptyId], "no_line");
  assert.equal(await captureInitialLineOutcome({ ...first, gameId: emptyId }), false);
  assert.equal(await captureInitialLineOutcome({ ...first, gameId: legacyId }), false);
  await selectInitialWeeklyPick(2026, 3, observedAt);
  const [weekly] = await db.select().from(initialWeeklyPicksTable);
  assert.equal(weekly?.gameId, futureId);
  assert.equal((await readInitialWeeklyPick(observedAt)).pick?.gameId, futureId);
  return {
    writer: result, selectedId: saved.id, versions: familyVersions,
    featureCount: saved.inputFeatureCount, missingCount: saved.inputMissingFeatureCount,
    vectorFinite: saved.inputVector?.every(Number.isFinite), orderedNames: saved.vectorFeatureNames,
    schemaFingerprint: saved.vectorSchemaFingerprint,
    sourceRows: (saved.inputSourceEvidence?.rows as unknown[]).length,
    negativeCases: Object.keys(negative), promotionMismatchExcluded: true,
    persistedNegativeRowsRejected: negativeIds.length,
    lateFreezeRejected: true,
    firstObservation: { requestBound: true, outcomes: statuses,
      laterObservationsImmutable: true, selectedGameId: weekly.gameId,
      providerContacts: 0, liveDatabaseWrites: 0 },
  };
}

export async function runFixture(action: string) {
  if (process.env.GRIDLINE_REHEARSAL_NOW !== date(NOW))
    throw new Error("Fixture requires its controlled clock");
  if (action === "seed") return seed();
  if (action === "audit") return audit();
  if (action === "writer") return writer();
  throw new Error("Expected seed, audit or writer");
}