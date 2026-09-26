import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayerProjectionScheduleFromTeamGames,
  reconcilePlayerProjectionRows,
  runPlayerProjectionEvaluation,
  type PlayerProjectionObservation,
  type PlayerProjectionTeamGame,
} from "./player-projections";

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