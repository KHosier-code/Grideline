import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerProjectionScheduleFromTeamGames,
  hashSortedPlayerProjectionInputs,
  PLAYER_PROJECTION_CONFIG,
  PLAYER_PROJECTION_VERSION,
  prepareIndependentProjectionSchedule,
  reconcilePlayerProjectionRows,
  runIndependentPlayerProjectionValidation,
  runPlayerProjectionEvaluation,
  type FrozenPlayerProjectionBaseline,
  type PlayerProjectionObservation,
  type PlayerProjectionTeamGame,
} from "./player-projections";
import { renderIndependentPlayerProjectionMarkdown } from "./player-projections-report";

const positions = [
  { family: "qb", playerId: "qb-1", position: "QB" },
  { family: "rb", playerId: "rb-1", position: "RB" },
  { family: "receiving", playerId: "wr-1", position: "WR" },
  { family: "receptions", playerId: "te-1", position: "TE" },
] as const;

function makeDataset(): { observations: PlayerProjectionObservation[]; teamGames: PlayerProjectionTeamGame[] } {
  const observations: PlayerProjectionObservation[] = [];
  const teamGames: PlayerProjectionTeamGame[] = [];
  for (const player of positions) {
    for (const season of [2021, 2022, 2023, 2024]) {
      for (let week = 1; week <= 5; week += 1) {
        const kickoffTime = new Date(Date.UTC(season, 8, week * 7, 17));
        const base = 18 + week + (season - 2021);
        observations.push({
          playerId: player.playerId,
          playerName: player.family,
          position: player.position,
          season,
          week,
          seasonType: "REG",
          gameId: `${season}-${week}-${player.playerId}`,
          kickoffTime,
          team: "BUF",
          opponent: "NYJ",
          homeAway: "home",
          passingYards: player.position === "QB" ? 190 + base : null,
          rushingYards: player.position === "RB" ? 40 + base : null,
          receivingYards: ["WR", "TE"].includes(player.position) ? 45 + base : null,
          receptions: ["WR", "TE"].includes(player.position) ? 2 + week : null,
          passAttempts: player.position === "QB" ? 25 + week : null,
          carries: player.position === "RB" ? 8 + week : null,
          targets: ["WR", "TE"].includes(player.position) ? 4 + week : null,
        });
        teamGames.push({
          season,
          week,
          gameId: `team-${season}-${week}`,
          kickoffTime,
          team: "BUF",
          opponent: "NYJ",
          passRate: 0.58,
          defensiveEpaAllowedPerPlay: 0.04,
        });
        teamGames.push({
          season,
          week,
          gameId: `opponent-${season}-${week}`,
          kickoffTime,
          team: "NYJ",
          opponent: "BUF",
          passRate: 0.52,
          defensiveEpaAllowedPerPlay: 0.02,
        });
      }
    }
  }
  return { observations, teamGames };
}

function run(observations: PlayerProjectionObservation[], teamGames: PlayerProjectionTeamGame[] = []) {
  return runPlayerProjectionEvaluation({
    observations,
    teamGames,
    generatedAt: new Date("2025-01-01T00:00:00Z"),
    provenance: {
      databaseScope: "development",
      sourceDatasets: ["test fixtures"],
      rawPlayerStatRows: observations.length,
      reconciledPlayerGameRows: observations.length,
      teamGameRows: teamGames.length,
      scheduleGames: 0,
      scheduleTimeMode: "schedule_kickoff",
      matchedScheduleGames: 0,
      unmatchedPlayerStatRows: 0,
      excludedNonFinalScheduleRows: 0,
      excludedUnmatchedOrAmbiguousPlayerRows: 0,
      seasonCoverage: {},
    },
  });
}

test("reconciles GSIS player rows by season, week, canonical team, and opponent", () => {
  const result = reconcilePlayerProjectionRows({
    teams: [
      { teamId: "team-buf", abbreviation: "BUF" },
      { teamId: "team-lar", abbreviation: "LAR" },
    ],
    schedule: [{
      gameId: "schedule-game",
      season: 2024,
      week: 2,
      kickoffTime: new Date("2024-09-15T17:00:00Z"),
      gameDate: null,
      status: "Final",
      homeTeamId: "team-buf",
      awayTeamId: "team-lar",
      finalHomeScore: 20,
      finalAwayScore: 17,
    }],
    stats: [{
      playerId: "gsis-player",
      playerName: "Example Player",
      position: "QB",
      teamId: "BUF",
      opponentTeamId: "LA",
      season: 2024,
      week: 2,
      seasonType: "REG",
      passingYards: 240,
      rushingYards: null,
      receivingYards: null,
      receptions: null,
      passAttempts: 32,
      carries: null,
      targets: null,
    }],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.gameId, "schedule-game");
  assert.equal(result.rows[0]!.opponent, "LAR");
  assert.equal(result.rows[0]!.homeAway, "home");
});

test("date-only schedule fallback sets a conservative boundary before the game date", () => {
  const teamGames = [{
    season: 2024,
    week: 10,
    gameId: "2024_10_BUF_LAR",
    teamId: "BUF",
    opponentTeamId: "LAR",
    passAttempts: 35,
    rushAttempts: 22,
    defensiveEpaAllowedPerPlay: 0.1,
    gameDate: "2024-11-10",
    isHome: true,
  }, {
    season: 2024,
    week: 10,
    gameId: "2024_10_BUF_LAR",
    teamId: "LAR",
    opponentTeamId: "BUF",
    passAttempts: 30,
    rushAttempts: 28,
    defensiveEpaAllowedPerPlay: 0.2,
    gameDate: "2024-11-10",
    isHome: false,
  }];
  const schedule = buildPlayerProjectionScheduleFromTeamGames({
    teamGames,
    teams: [
      { teamId: "team-buf", abbreviation: "BUF" },
      { teamId: "team-lar", abbreviation: "LAR" },
    ],
  });
  const reconciled = reconcilePlayerProjectionRows({
    schedule,
    teams: [
      { teamId: "team-buf", abbreviation: "BUF" },
      { teamId: "team-lar", abbreviation: "LAR" },
    ],
    stats: [{
      playerId: "gsis-player",
      playerName: "Example Player",
      position: "QB",
      teamId: "BUF",
      opponentTeamId: "LA",
      season: 2024,
      week: 10,
      seasonType: "REG",
      passingYards: 275,
      rushingYards: null,
      receivingYards: null,
      receptions: null,
      passAttempts: 36,
      carries: null,
      targets: null,
    }],
  });
  assert.equal(reconciled.rows.length, 1);
  assert.equal(reconciled.rows[0]!.scheduleTimeSource, "calendarDateBoundary");
  assert.equal(reconciled.rows[0]!.kickoffTime.toISOString(), "2024-11-10T00:00:00.000Z");
});

test("features and projections for a cutoff cannot change when a later game's actual changes", () => {
  const first = makeDataset();
  const baseline = run(first.observations, first.teamGames);
  const changedLater = makeDataset();
  const laterGame = changedLater.observations.find((row) =>
    row.playerId === "qb-1" && row.season === 2024 && row.week === 2)!;
  laterGame.passingYards = 9999;
  const changed = run(changedLater.observations, changedLater.teamGames);
  const firstGameBaseline = baseline.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.week === 1)!;
  const firstGameChanged = changed.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.week === 1)!;
  assert.equal(firstGameChanged.projectedStatistic, firstGameBaseline.projectedStatistic);
  assert.deepEqual(firstGameChanged.featureValues, firstGameBaseline.featureValues);
  assert.equal(firstGameBaseline.calculationTimestamp, "2024-09-07T16:59:59.999Z");
  assert.ok(firstGameBaseline.historicalSampleQuality.priorAppearances >= 3);
});

test("independent database input checksums ignore source query row ordering", () => {
  const first = {
    stats: [{ id: "b" }, { id: "a" }],
    schedule: [{ gameId: "z" }, { gameId: "x" }],
    teamGames: [{ team: "NYJ" }, { team: "BUF" }],
    teams: [{ teamId: "2" }, { teamId: "1" }],
  };
  const reordered = {
    stats: [...first.stats].reverse(),
    schedule: [...first.schedule].reverse(),
    teamGames: [...first.teamGames].reverse(),
    teams: [...first.teams].reverse(),
  };
  assert.equal(hashSortedPlayerProjectionInputs(first), hashSortedPlayerProjectionInputs(reordered));
  assert.notEqual(hashSortedPlayerProjectionInputs(first), hashSortedPlayerProjectionInputs({
    ...reordered,
    stats: [{ id: "changed" }, ...reordered.stats.slice(1)],
  }));
});

test("all four independent families train on 2021-23 and evaluate only 2024", () => {
  const data = makeDataset();
  const report = run(data.observations, data.teamGames);
  assert.equal(Object.keys(report.families).length, 4);
  for (const result of Object.values(report.families)) {
    assert.ok(result.trainingSamples > 0);
    assert.ok(result.eligiblePredictions > 0);
    assert.equal(result.eligiblePredictions, result.evaluationCandidates);
    assert.equal(result.metrics.sampleSize, result.eligiblePredictions);
  }
  assert.ok(report.predictions.every((row) => row.season === 2024));
  assert.ok(report.predictions.every((row) => new Date(row.calculationTimestamp) < new Date(row.gameDate)));
});

test("baseline metrics are scored against the model on matching availability cohorts", () => {
  const data = makeDataset();
  const shortHistoryRows = data.observations
    .filter((row) => row.playerId === "qb-1"
      && ((row.season === 2023 && row.week >= 3) || row.season === 2024))
    .map((row) => ({ ...row, playerId: "qb-short-history", playerName: "Short History QB" }));
  const report = run([...data.observations, ...shortHistoryRows], data.teamGames);
  const family = report.families.qbPassingYards;

  assert.equal(family.metrics.sampleSize, 10);
  assert.equal(family.baselines.last3AppearanceMean.baseline.sampleSize, 10);
  assert.equal(family.baselines.last5AppearanceMean.baseline.sampleSize, 8);
  assert.equal(family.baselines.seasonToDateMean.baseline.sampleSize, 8);

  const comparisons = [
    {
      result: family.baselines.last3AppearanceMean,
      value: (row: (typeof report.predictions)[number]) => row.last3Baseline,
    },
    {
      result: family.baselines.last5AppearanceMean,
      value: (row: (typeof report.predictions)[number]) => row.last5Baseline,
    },
    {
      result: family.baselines.seasonToDateMean,
      value: (row: (typeof report.predictions)[number]) => row.seasonToDateBaseline,
    },
  ];
  for (const comparison of comparisons) {
    const rows = report.predictions.filter((row) =>
      row.family === "qbPassingYards" && comparison.value(row) !== null);
    const baselineMae = rows.reduce((sum, row) =>
      sum + Math.abs(comparison.value(row)! - row.actualStatistic), 0) / rows.length;
    const modelMae = rows.reduce((sum, row) =>
      sum + Math.abs(row.projectedStatistic - row.actualStatistic), 0) / rows.length;
    assert.equal(comparison.result.baseline.sampleSize, rows.length);
    assert.equal(comparison.result.modelOnSameCohort.sampleSize, rows.length);
    assert.ok(Math.abs(comparison.result.baseline.meanAbsoluteError! - baselineMae) < 1e-10);
    assert.ok(Math.abs(comparison.result.modelOnSameCohort.meanAbsoluteError! - modelMae) < 1e-10);
  }
});

test("rejects post-2024 rows rather than silently using future training data", () => {
  const data = makeDataset();
  data.observations.push({
    ...data.observations[0]!,
    season: 2025,
    week: 1,
    gameId: "future-game",
    kickoffTime: new Date("2025-09-07T17:00:00Z"),
  });
  assert.throws(() => run(data.observations, data.teamGames), /only 2021–2024 regular-season rows/);
});

const frozenFeatureNames = [
  "intercept",
  "priorLast3TargetMean:z", "priorLast3TargetMean:missing",
  "priorLast5TargetMean:z", "priorLast5TargetMean:missing",
  "priorLast8TargetMean:z", "priorLast8TargetMean:missing",
  "seasonToDateTargetMean:z", "seasonToDateTargetMean:missing",
  "priorLast3VolumeMean:z", "priorLast3VolumeMean:missing",
  "priorLast8VolumeMean:z", "priorLast8VolumeMean:missing",
  "priorLast3Efficiency:z", "priorLast3Efficiency:missing",
  "priorLast8Efficiency:z", "priorLast8Efficiency:missing",
  "teamSeasonPassRate:z", "teamSeasonPassRate:missing",
  "opponentSeasonDefensiveEpaAllowed:z", "opponentSeasonDefensiveEpaAllowed:missing",
  "teamRestDays:z", "teamRestDays:missing",
];
const frozenHash = "a".repeat(64);

function makeFrozenBaseline(nonzeroFeatureCoefficients = false): FrozenPlayerProjectionBaseline {
  const families = Object.fromEntries(
    (["qbPassingYards", "rbRushingYards", "receiverReceivingYards", "receiverReceptions"] as const).map((family) => [
      family,
      {
        modelVersion: `${PLAYER_PROJECTION_VERSION}-${family}-${frozenHash.slice(0, 16)}`,
        eligiblePredictions: 0,
        metrics: {
          sampleSize: 0,
          meanAbsoluteError: null,
          meanAbsoluteError95CI: null,
          rootMeanSquaredError: null,
          rootMeanSquaredError95CI: null,
          meanBias: null,
          meanBias95CI: null,
        },
        fittedArtifact: {
          featureNames: frozenFeatureNames,
          standardizedMeans: Array(11).fill(0),
          standardizedScales: Array(11).fill(1),
          coefficients: [
            50,
            ...Array.from({ length: 22 }, (_, index) =>
              nonzeroFeatureCoefficients && [0, 16, 18].includes(index) ? 0.1 : 0),
          ],
          ridgePenalty: PLAYER_PROJECTION_CONFIG.ridgePenalty,
          trainingExamplesSha256: frozenHash,
          trainingUsageVolumeTertiles: [5, 10] as [number, number],
        },
      },
    ]),
  ) as unknown as FrozenPlayerProjectionBaseline["families"];
  return {
    version: PLAYER_PROJECTION_VERSION,
    config: PLAYER_PROJECTION_CONFIG,
    modelMethod: {
      name: "frozen original model",
      description: "test fixture",
      featureNames: frozenFeatureNames,
      baselineDefinitions: {},
      limitations: [],
    },
    families,
  };
}

function independentProvenance(observations: PlayerProjectionObservation[], teamGames: PlayerProjectionTeamGame[]) {
  return {
    databaseScope: "development" as const,
    sourceDatasets: ["test fixtures"],
    sourceLedger: {
      playerStats: ([2025, 2026] as const).map((season) => ({
        season,
        sourceUrl: `https://example.test/player_stats_${season}.csv.gz`,
        status: "success",
        rowCount: 20,
        fileSizeBytes: 1024,
        completedAt: "2026-09-01T00:00:00.000Z",
        upstreamFileContentSha256: null,
      })),
      espnScheduleRecovery: [
        {
          jobKey: "development-historical-schedule-recovery" as const,
          runId: 17,
          status: "success",
          recordsProcessed: 304,
          completedAt: "2026-09-02T00:00:00.000Z",
        },
        {
          jobKey: "development-historical-schedule-week3-atl-gb" as const,
          runId: 18,
          status: "success",
          recordsProcessed: 1,
          completedAt: "2026-09-03T00:00:00.000Z",
        },
      ],
    },
    rawPlayerStatRows: observations.length,
    reconciledPlayerGameRows: observations.length,
    teamGameRows: teamGames.length,
    scheduleGames: observations.length,
    matchedScheduleGames: observations.length,
    unmatchedPlayerStatRows: 0,
    excludedNonFinalScheduleRows: 0,
    excludedUnmatchedOrAmbiguousPlayerRows: 0,
    rawSeasonCoverage: Object.fromEntries([2021, 2022, 2023, 2024, 2025, 2026].map((season) => [
      String(season), observations.filter((row) => row.season === season).length,
    ])),
    seasonCoverage: Object.fromEntries([2021, 2022, 2023, 2024, 2025, 2026].map((season) => [
      String(season), observations.filter((row) => row.season === season).length,
    ])),
    scheduleTimeModeBySeason: {},
    finalScheduleGamesBySeasonWeek: { "2025:1": 1, "2025:19": 2, "2026:1": 1 },
    validKickoffGamesBySeasonWeek: { "2025:1": 1, "2025:19": 2, "2026:1": 1 },
    matchedPlayerRowsBySeasonWeek: { "2025:1": 4, "2025:19": 0, "2026:1": 4 },
    checksumSha256: frozenHash,
    historicalTimestampCaveat: "Test fixture; source publication timestamps are not verified.",
  };
}

function makeIndependentDataset() {
  const observations: PlayerProjectionObservation[] = [];
  const teamGames: PlayerProjectionTeamGame[] = [];
  for (const player of positions) {
    for (const season of [2021, 2022, 2023, 2024, 2025, 2026]) {
      for (let week = 1; week <= 5; week += 1) {
        const kickoffTime = new Date(Date.UTC(season, 8, week * 7, 17));
        const base = 15 + week + season - 2021;
        observations.push({
          playerId: player.playerId,
          playerName: player.family,
          position: player.position,
          season,
          week,
          seasonType: "REG",
          gameId: `${season}-${week}-${player.playerId}`,
          kickoffTime,
          gameDate: kickoffTime,
          scheduleTimeSource: "scheduledKickoff",
          team: "BUF",
          opponent: "NYJ",
          homeAway: "home",
          passingYards: player.position === "QB" ? 180 + base : null,
          rushingYards: player.position === "RB" ? 35 + base : null,
          receivingYards: ["WR", "TE"].includes(player.position) ? 40 + base : null,
          receptions: ["WR", "TE"].includes(player.position) ? 2 + week : null,
          passAttempts: player.position === "QB" ? 20 + week : null,
          carries: player.position === "RB" ? 5 + week : null,
          targets: ["WR", "TE"].includes(player.position) ? 3 + week : null,
        });
        teamGames.push({
          season, week, gameId: `team-${season}-${week}`, kickoffTime,
          team: "BUF", opponent: "NYJ", passRate: 0.57, defensiveEpaAllowedPerPlay: 0.02,
        });
        teamGames.push({
          season, week, gameId: `opp-${season}-${week}`, kickoffTime,
          team: "NYJ", opponent: "BUF", passRate: 0.53, defensiveEpaAllowedPerPlay: 0.03,
        });
      }
    }
  }
  return { observations, teamGames };
}

function runIndependent(
  observations: PlayerProjectionObservation[],
  teamGames: PlayerProjectionTeamGame[] = [],
  baseline = makeFrozenBaseline(),
) {
  return runIndependentPlayerProjectionValidation({
    observations,
    teamGames,
    baseline,
    baselineReportSha256: "b".repeat(64),
    provenance: independentProvenance(observations, teamGames),
    generatedAt: new Date("2027-01-01T00:00:00Z"),
  });
}

test("independent validation applies frozen parameters to separate 2025 and 2026 holdouts", () => {
  const { observations, teamGames } = makeIndependentDataset();
  const report = runIndependent(observations, teamGames);
  assert.equal(report.evaluationKind, "frozen_model_independent_validation");
  assert.equal(report.baseline.reportSha256, "b".repeat(64));
  assert.equal(report.families.qbPassingYards.evaluations["2025"].eligiblePredictions, 5);
  assert.equal(report.families.qbPassingYards.evaluations["2026"].eligiblePredictions, 5);
  assert.ok(report.predictions.every((row) => row.projectedStatistic === 50));
  assert.ok(report.predictions.every((row) => row.season === 2025 || row.season === 2026));
  assert.ok(Object.values(report.leakageChecks).every(Boolean));
  const markdown = renderIndependentPlayerProjectionMarkdown(report);
  assert.match(markdown, /structural game-time chronology/);
  assert.match(markdown, /do not prove when the original stat or schedule sources were published/);
  assert.match(markdown, /development-historical-schedule-recovery; run 17 \| success \| 304 records/);
  assert.match(markdown, /development-historical-schedule-week3-atl-gb; run 18 \| success \| 1 record/);
  assert.match(markdown, /2025:1 \| 1 \| 1 \| 4/);
  assert.doesNotMatch(markdown, /2025:19/);
  assert.match(markdown, /No upstream NFLverse file-content digest was available/);
});

test("later player and team context changes exact later features but cannot change earlier projections", () => {
  const original = makeIndependentDataset();
  const baseline = makeFrozenBaseline(true);
  const before = runIndependent(original.observations, original.teamGames, baseline);
  const changed = makeIndependentDataset();
  const laterPlayerRow = changed.observations.find((row) =>
    row.playerId === "qb-1" && row.season === 2026 && row.week === 4)!;
  laterPlayerRow.passingYards = 1000;
  const laterTeamContext = changed.teamGames.find((row) =>
    row.season === 2026 && row.week === 4 && row.team === "BUF")!;
  laterTeamContext.passRate = 0.99;
  const laterOpponentContext = changed.teamGames.find((row) =>
    row.season === 2026 && row.week === 4 && row.team === "NYJ")!;
  laterOpponentContext.defensiveEpaAllowedPerPlay = 0.99;
  const after = runIndependent(changed.observations, changed.teamGames, baseline);
  const beforeEarly = before.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.season === 2026 && row.week === 2)!;
  const afterEarly = after.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.season === 2026 && row.week === 2)!;
  const beforeLate = before.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.season === 2026 && row.week === 5)!;
  const afterLate = after.predictions.find((row) =>
    row.family === "qbPassingYards" && row.playerId === "qb-1" && row.season === 2026 && row.week === 5)!;
  assert.equal(afterEarly.projectedStatistic, beforeEarly.projectedStatistic);
  assert.deepEqual(afterEarly.featureValues, beforeEarly.featureValues);
  assert.equal(afterLate.featureValues.priorLast3TargetMean, (202 + 203 + 1000) / 3);
  assert.equal(afterLate.featureValues.priorLast5TargetMean, beforeLate.featureValues.priorLast5TargetMean! + 796 / 5);
  assert.equal(afterLate.featureValues.priorLast8TargetMean, beforeLate.featureValues.priorLast8TargetMean! + 796 / 8);
  assert.equal(afterLate.featureValues.seasonToDateTargetMean, (201 + 202 + 203 + 1000) / 4);
  assert.equal(afterLate.featureValues.priorLast3Efficiency, ((202 + 203 + 1000) / 3) / 23);
  assert.ok(Math.abs(afterLate.featureValues.teamSeasonPassRate! - (0.57 * 15 + 0.99) / 16) < 1e-12);
  assert.ok(Math.abs(afterLate.featureValues.opponentSeasonDefensiveEpaAllowed! - (0.03 * 15 + 0.99) / 16) < 1e-12);
  assert.equal(afterLate.featureValues.teamRestDays, beforeLate.featureValues.teamRestDays);
  assert.notEqual(afterLate.projectedStatistic, beforeLate.projectedStatistic);
});

test("independent validation rejects date-only holdout games and corrupted frozen hashes", () => {
  const { observations, teamGames } = makeIndependentDataset();
  observations.find((row) => row.season === 2025)!.scheduleTimeSource = "calendarDateBoundary";
  assert.throws(() => runIndependent(observations, teamGames), /scheduled UTC kickoff/);
  const clean = makeIndependentDataset();
  const baseline = makeFrozenBaseline();
  baseline.families.qbPassingYards.modelVersion += "-changed";
  assert.throws(() => runIndependentPlayerProjectionValidation({
    observations: clean.observations,
    teamGames: clean.teamGames,
    baseline,
    baselineReportSha256: "b".repeat(64),
    provenance: independentProvenance(clean.observations, clean.teamGames),
  }), /training hash assertion/);
  const badConfig = makeFrozenBaseline() as unknown as {
    version: string;
    config: Omit<typeof PLAYER_PROJECTION_CONFIG, "ridgePenalty"> & { ridgePenalty: number };
    modelMethod: { featureNames: string[] };
    families: FrozenPlayerProjectionBaseline["families"];
  };
  badConfig.config = { ...PLAYER_PROJECTION_CONFIG, ridgePenalty: 3 };
  assert.throws(() => runIndependentPlayerProjectionValidation({
    observations: clean.observations,
    teamGames: clean.teamGames,
    baseline: badConfig as FrozenPlayerProjectionBaseline,
    baselineReportSha256: "b".repeat(64),
    provenance: independentProvenance(clean.observations, clean.teamGames),
  }), /configuration/);
  assert.throws(() => runIndependentPlayerProjectionValidation({
    observations: clean.observations,
    teamGames: clean.teamGames,
    baseline: makeFrozenBaseline(),
    baselineReportSha256: "invalid",
    provenance: independentProvenance(clean.observations, clean.teamGames),
  }), /report SHA-256/);
});

test("independent schedule finality requires explicit status, not scores or 0-0 fields", () => {
  const teams = [
    { teamId: "buf", abbreviation: "BUF" },
    { teamId: "nyj", abbreviation: "NYJ" },
  ];
  const sourceRows = [
    {
      gameId: "unfinished-zero-zero", season: 2025, week: 1,
      kickoffTime: new Date("2025-09-07T17:00:00Z"), gameDate: null,
      status: "In Progress", homeTeamId: "buf", awayTeamId: "nyj",
      finalHomeScore: 0, finalAwayScore: 0,
    },
    {
      gameId: "unfinished-with-scores", season: 2025, week: 2,
      kickoffTime: new Date("2025-09-14T17:00:00Z"), gameDate: null,
      status: "Scheduled", homeTeamId: "buf", awayTeamId: "nyj",
      finalHomeScore: 24, finalAwayScore: 20,
    },
    {
      gameId: "explicit-final", season: 2025, week: 3,
      kickoffTime: new Date("2025-09-21T17:00:00Z"), gameDate: null,
      status: "Final", homeTeamId: "buf", awayTeamId: "nyj",
      finalHomeScore: 0, finalAwayScore: 0,
    },
  ];
  const stats = sourceRows.map((game) => ({
    playerId: game.gameId,
    playerName: "Example QB",
    position: "QB",
    teamId: "BUF",
    opponentTeamId: "NYJ",
    season: game.season,
    week: game.week,
    seasonType: "REG",
    passingYards: 200,
    rushingYards: null,
    receivingYards: null,
    receptions: null,
    passAttempts: 30,
    carries: null,
    targets: null,
  }));
  const result = reconcilePlayerProjectionRows({
    stats,
    schedule: prepareIndependentProjectionSchedule(sourceRows),
    teams,
  });
  assert.deepEqual(result.rows.map((row) => row.gameId), ["explicit-final"]);
  assert.equal(result.excludedNonFinalScheduleRows, 2);
});