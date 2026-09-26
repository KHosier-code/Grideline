import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPlayerTdFittedReport,
  hashPlayerTdInputs,
  PLAYER_TD_MODEL_VERSION,
  preparePlayerTdExamples,
  runTdEvaluation,
  scoreUpcomingPlayerTdCandidate,
  type PlayerTdEvaluationInput,
  type PlayerTdGame,
} from "./player-td-model";
import { buildQualifiedPlayerTdForecasts } from "./player-td-forecast-readiness";

function makeInput(): PlayerTdEvaluationInput {
  const players: PlayerTdGame[] = [];
  const teamGames: PlayerTdEvaluationInput["teamGames"] = [];
  const redZoneFacts: PlayerTdEvaluationInput["redZoneFacts"] = [];
  const people = [
    { id: "wr-a", name: "Receiver A", position: "WR" as const },
    { id: "wr-b", name: "Receiver B", position: "WR" as const },
    { id: "rb-a", name: "Runner A", position: "RB" as const },
    { id: "qb-a", name: "Quarterback A", position: "QB" as const },
  ];
  for (const season of [2021, 2022, 2023, 2024, 2025]) {
    for (let week = 1; week <= 12; week += 1) {
      const kickoff = new Date(Date.UTC(season, 8, week * 7, 17));
      for (const [index, person] of people.entries()) {
        const isWr = person.position === "WR";
        const team = person.id === "wr-b" ? "MIA" : "BUF";
        const opponent = team === "MIA" ? "BUF" : "MIA";
        const gameId = `${season}-${week}-game`;
        players.push({
          playerId: person.id,
          playerName: person.name,
          position: person.position,
          team,
          opponent,
          season,
          week,
          gameId,
          kickoff,
          targets: isWr ? (person.id === "wr-a" ? 8 + week % 3 : 3) : null,
          carries: person.position === "RB" ? 12 : null,
          rushingTds: person.position === "QB" ? 0 : ((week + index) % 4 === 0 ? 1 : 0),
          receivingTds: isWr ? ((week + index) % 3 === 0 ? 1 : 0) : 0,
          passingTds: person.position === "QB" ? (week % 3 === 0 ? 1 : 0) : null,
        });
        if (!teamGames.some((row) => row.season === season && row.week === week && row.team === team)) {
          teamGames.push({ team, opponent, season, week, gameId, kickoff, score: 17 + week % 10, defensiveEpa: ((week % 5) - 2) / 20 });
        }
        // This verifies that an explicitly joined zero remains an observed
        // value; the missing 2025 facts remain unavailable, never fabricated zero.
        if (season < 2025 && person.id === "wr-a") {
          redZoneFacts.push({
            playerId: person.id,
            team,
            opponent,
            season,
            week,
            gameId,
            zone: 20,
            targets: week % 2 ? 0 : 1,
            carries: 0,
            validJoinedCoverage: true,
          });
        }
      }
    }
  }
  return { players, teamGames, redZoneFacts };
}

test("prior features enforce strict kickoff cutoffs and reject target-game leakage", () => {
  const input = makeInput();
  const target = input.players.find((row) => row.playerId === "wr-a" && row.season === 2024 && row.week === 6)!;
  const prepared = preparePlayerTdExamples(input);
  const original = prepared.examples.find((row) => row.playerId === target.playerId && row.gameId === target.gameId)!;
  assert.equal(original.priorAppearances, 41);

  const changed = makeInput();
  const sameGame = changed.players.find((row) => row.gameId === target.gameId)!;
  sameGame.targets = 9999;
  const later = changed.players.find((row) => row.playerId === "wr-a" && row.season === 2024 && row.week === 7)!;
  later.targets = 8888;
  const changedFeatures = preparePlayerTdExamples(changed).examples.find((row) =>
    row.playerId === target.playerId && row.gameId === target.gameId)!;
  assert.deepEqual(changedFeatures.featureValues, original.featureValues);

  const sameKickoff = makeInput();
  const sameTime = sameKickoff.players.find((row) => row.playerId === "wr-a" && row.season === 2024 && row.week === 5)!;
  sameTime.kickoff = new Date(target.kickoff);
  const strict = preparePlayerTdExamples(sameKickoff).examples.find((row) =>
    row.playerId === target.playerId && row.gameId === target.gameId)!;
  assert.ok(strict.priorAppearances < original.priorAppearances);

  const calendarBoundaryInput = makeInput();
  const dateOnlyPrior = calendarBoundaryInput.players.find((row) =>
    row.playerId === target.playerId && row.season === target.season && row.week === 5)!;
  dateOnlyPrior.kickoff = new Date(target.kickoff);
  dateOnlyPrior.kickoffTimeSource = "calendarDateBoundary";
  const dateOnlyPriorFeatures = preparePlayerTdExamples(calendarBoundaryInput).examples.find((row) =>
    row.playerId === target.playerId && row.gameId === target.gameId)!;
  assert.ok(dateOnlyPriorFeatures.priorAppearances < original.priorAppearances);

  const tradeInput = makeInput();
  for (const row of tradeInput.players.filter((candidate) =>
    candidate.playerId === "wr-a" && candidate.season === 2024)) {
    row.team = "MIA";
    row.opponent = "BUF";
    if (row.week <= 3) row.targets = 0;
  }
  const tradedReceiver = preparePlayerTdExamples(tradeInput).examples.find((row) =>
    row.playerId === "wr-a" && row.season === 2024 && row.week === 4)!;
  assert.equal(tradedReceiver.team, "MIA");
  assert.equal(tradedReceiver.featureValues.wr1Role, 0);

  const noOpponentRoleEvidence = makeInput();
  const unknownDefenseRow = noOpponentRoleEvidence.players.find((row) =>
    row.playerId === "wr-a" && row.season === 2024 && row.week === 6)!;
  unknownDefenseRow.opponent = "NEW";
  const noDefenseEvidence = preparePlayerTdExamples(noOpponentRoleEvidence).examples.find((row) =>
    row.playerId === "wr-a" && row.season === 2024 && row.week === 6)!;
  assert.equal(noDefenseEvidence.featureValues.opponentWr1TdRate, null);
  assert.equal(noDefenseEvidence.featureValues.opponentWr1Samples, 0);
});

test("ambiguous player-game duplicates and unavailable labels are excluded", () => {
  const input = makeInput();
  const duplicate = { ...input.players[10]! };
  input.players.push(duplicate);
  const missingLabel = input.players.find((row) => row.playerId === "wr-a" && row.season === 2024 && row.week === 12)!;
  missingLabel.receivingTds = null;
  const prepared = preparePlayerTdExamples(input);
  assert.equal(prepared.exclusions.excludedDuplicatePlayerRows, 2);
  assert.equal(prepared.examples.some((row) => row.gameId === duplicate.gameId), false);
  assert.ok(prepared.exclusions.excludedUnlabeledRows > 0);
});

test("passing touchdowns never count as player-scored touchdowns for a QB", () => {
  const input = makeInput();
  const qbPassingTd = input.players.find((row) =>
    row.playerId === "qb-a" && row.season === 2021 && row.week === 6)!;
  assert.equal(qbPassingTd.passingTds, 1);
  assert.equal(qbPassingTd.rushingTds, 0);
  assert.equal(qbPassingTd.receivingTds, 0);
  const example = preparePlayerTdExamples(input).examples.find((row) =>
    row.playerId === "qb-a" && row.season === 2021 && row.week === 6)!;
  assert.equal(example.label, 0);
});

test("joined red-zone zero is distinct from missing coverage and evaluation is reproducible", () => {
  const input = makeInput();
  for (const fact of input.redZoneFacts) fact.targets = 0;
  const prepared = preparePlayerTdExamples(input);
  const covered = prepared.examples.find((row) => row.playerId === "wr-a" && row.season === 2024 && row.week === 5)!;
  assert.ok(covered.featureValues.rzCoverage! > 0);
  assert.equal(covered.featureValues.rzTargetShare, 0);
  const unavailableInput = { ...input, redZoneFacts: [] };
  const no2025Coverage = preparePlayerTdExamples(unavailableInput).examples.find((row) =>
    row.playerId === "wr-a" && row.season === 2025 && row.week === 5)!;
  assert.equal(no2025Coverage.featureValues.rzCoverage, null);
  assert.equal(no2025Coverage.featureValues.rzTargetShare, null);

  const first = runTdEvaluation(unavailableInput);
  const second = runTdEvaluation(unavailableInput);
  assert.equal(first.version, PLAYER_TD_MODEL_VERSION);
  assert.equal(first.inputHash, hashPlayerTdInputs(unavailableInput));
  assert.deepEqual(first, second);
  assert.ok(first.cohorts.evaluationRedZoneUnavailableAppearances > 0);
  assert.equal(first.fitting.redZoneTrainingCoveredAppearances, 0);
  assert.deepEqual(first.fitting.excludedFeatureFamilies, ["redZone"]);
  assert.ok(!first.fitting.includedFeatures.includes("rzTargetShare"));
  assert.equal(first.metrics.model.count, first.metrics.baselines.position.count);
  assert.equal(first.metrics.model.count, first.metrics.ablations.withoutRedZone.count);
  assert.ok(first.metrics.model.brierScore !== null);
  assert.ok(first.fitting.calibrationPositiveLabels > 0);
  assert.ok(first.fitting.calibrationNegativeLabels > 0);
  assert.equal(first.fitting.calibrationMetrics.count, first.fitting.calibrationExamples);
  const calibratedMean = first.fitting.calibrationMetrics.reliability.reduce(
    (total, bin) => total + bin.meanPrediction * bin.count, 0,
  ) / first.fitting.calibrationMetrics.count;
  const calibrationPrevalence = first.fitting.calibrationPositiveLabels / first.fitting.calibrationExamples;
  assert.ok(Math.abs(calibratedMean - calibrationPrevalence) < 0.1);
  assert.ok(Object.values(first.fitting.ablationPlatt).every((parameters) => parameters !== null));
  assert.ok(first.predictions.every((row) => Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1));
});

test("qualified scoring can rank a future matchup, but missing source approval withholds it", () => {
  const history = makeInput();
  const frozenReport = runTdEvaluation(history);
  const asOf = new Date("2026-09-06T12:00:00Z");
  const candidate = {
    playerId: "wr-a", playerName: "Receiver A", position: "WR" as const,
    team: "BUF", opponent: "MIA", season: 2026, week: 1, gameId: "2026-week-1",
    kickoff: new Date("2026-09-06T17:00:00Z"), kickoffTimeSource: "scheduledKickoff" as const,
  };
  const input = {
    asOf, upcomingGames: 1, history, frozenReport,
    candidates: [{
      candidate, rosterTeamVerifiedAt: new Date("2026-09-06T08:00:00Z"),
      availabilityVerifiedAt: new Date("2026-09-06T08:00:00Z"),
      starterVerifiedAt: new Date("2026-09-06T08:00:00Z"),
      confirmedAvailable: true, confirmedStarter: true,
    }],
    sourceReleaseArchiveVerified: false, modelEvaluationApproved: true, sharedBlockers: [],
  };
  const blocked = buildQualifiedPlayerTdForecasts(input);
  assert.equal(blocked.status, "unavailable");
  assert.deepEqual(blocked.forecasts, []);
  const ready = buildQualifiedPlayerTdForecasts({ ...input, sourceReleaseArchiveVerified: true });
  assert.equal(ready.status, "forecasts");
  assert.equal(ready.forecasts.length, 1);
  assert.ok(ready.forecasts[0]!.probability >= 0 && ready.forecasts[0]!.probability <= 1);
  assert.equal(ready.forecasts[0]!.redZoneOpportunities, null);
  assert.equal(ready.withheld.length, 0);
});

test("frozen upcoming scoring requires the exact historical hash and valid calibration", () => {
  const history = { ...makeInput(), redZoneFacts: [] };
  const report = runTdEvaluation(history);
  const candidate = {
    playerId: "wr-a",
    playerName: "Receiver A",
    position: "WR" as const,
    team: "BUF",
    opponent: "MIA",
    season: 2026,
    week: 1,
    gameId: "2026-upcoming-game",
    kickoff: new Date("2026-09-13T17:00:00.000Z"),
    kickoffTimeSource: "scheduledKickoff" as const,
  };
  const scored = scoreUpcomingPlayerTdCandidate({ history, candidate, frozenReport: report });
  assert.equal(scored.version, PLAYER_TD_MODEL_VERSION);
  assert.equal(scored.inputHash, report.inputHash);
  assert.equal(report.fittingHash, hashPlayerTdFittedReport(report));
  assert.ok(Number.isFinite(scored.probability) && scored.probability >= 0 && scored.probability <= 1);
  assert.equal(scored.featureValues.rzCoverage, null);
  assert.throws(() => scoreUpcomingPlayerTdCandidate({
    history: { ...history, players: history.players.slice(1) },
    candidate,
    frozenReport: report,
  }), /input hash/);
  assert.throws(() => scoreUpcomingPlayerTdCandidate({
    history,
    candidate: { ...candidate, kickoff: new Date("2025-10-01T17:00:00.000Z") },
    frozenReport: report,
  }), /post-kickoff evidence/);
  const alteredReport = structuredClone(report);
  alteredReport.fitting.fittedModel.intercept += 1;
  assert.throws(() => scoreUpcomingPlayerTdCandidate({
    history, candidate, frozenReport: alteredReport,
  }), /fitted parameters or calibration hash/);
});