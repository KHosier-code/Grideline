import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGradedCharts,
  isUsableGradedChartRow,
  type GradedChartRow,
} from "./consumer-graded-charts";

function row(input: {
  gameId: string;
  season: number;
  week: number;
  kickoff: string;
  predictionTimestamp?: string;
  official?: boolean;
  gameStatus?: string;
  grade?: GradedChartRow["grade"];
}): GradedChartRow {
  const kickoffTime = new Date(input.kickoff);
  return {
    prediction: {
      gameId: input.gameId,
      predictionTimestamp: new Date(input.predictionTimestamp ?? "2025-09-01T12:00:00Z"),
      kickoffTime,
      officialFinalPrediction: input.official ?? true,
    },
    grade: input.grade === undefined ? {
      homeWinCorrect: true,
      marginError: -4,
      totalError: 6,
    } : input.grade,
    game: {
      gameId: input.gameId,
      season: input.season,
      week: input.week,
      kickoffTime,
      gameStatus: input.gameStatus ?? "STATUS_FINAL",
      finalHomeScore: 24,
      finalAwayScore: 20,
    },
  };
}

test("graded chart rows require official, pre-kickoff predictions and final games", () => {
  const valid = row({
    gameId: "valid",
    season: 2025,
    week: 1,
    kickoff: "2025-09-07T17:00:00Z",
  });
  assert.equal(isUsableGradedChartRow(valid), true);
  assert.equal(isUsableGradedChartRow({
    ...valid,
    prediction: { ...valid.prediction, predictionTimestamp: valid.game!.kickoffTime! },
  }), false, "prediction at kickoff is not strictly pre-kickoff");
  assert.equal(isUsableGradedChartRow({
    ...valid,
    prediction: { ...valid.prediction, officialFinalPrediction: false },
  }), false);
  assert.equal(isUsableGradedChartRow({
    ...valid,
    game: { ...valid.game!, gameStatus: "STATUS_SCHEDULED" },
  }), false);
  assert.equal(isUsableGradedChartRow({ ...valid, grade: null }), false);
});

test("graded chart summaries are season-grouped and chronologically cumulative", () => {
  const later = row({
    gameId: "later",
    season: 2025,
    week: 2,
    kickoff: "2025-09-14T17:00:00Z",
    grade: { homeWinCorrect: false, marginError: 2, totalError: null },
  });
  const earlier = row({
    gameId: "earlier",
    season: 2025,
    week: 1,
    kickoff: "2025-09-07T17:00:00Z",
    grade: { homeWinCorrect: true, marginError: -4, totalError: 6 },
  });
  const otherSeason = row({
    gameId: "prior-season",
    season: 2024,
    week: 18,
    kickoff: "2024-12-29T17:00:00Z",
    predictionTimestamp: "2024-12-28T17:00:00Z",
    grade: { homeWinCorrect: null, marginError: null, totalError: 3 },
  });
  const result = aggregateGradedCharts([later, otherSeason, earlier], true);
  assert.equal(result.status, "measured");
  assert.equal(result.truncated, true);
  assert.deepEqual(result.bySeason.map(({ season, graded }) => ({ season, graded })), [
    { season: 2024, graded: 1 },
    { season: 2025, graded: 2 },
  ]);
  assert.deepEqual(result.cumulative.map((item) => [item.gameId, item.graded]), [
    ["prior-season", 1],
    ["earlier", 2],
    ["later", 3],
  ]);
  assert.equal(result.bySeason[1]!.winnerAccuracy, 0.5);
  assert.equal(result.bySeason[1]!.marginMae, 3);
  assert.equal(result.bySeason[1]!.totalMae, 6);
  assert.equal(result.cumulative[2]!.marginMae, 3);
  assert.equal(result.cumulative[2]!.totalGraded, 2);
  assert.equal(result.cumulative[2]!.totalMae, 4.5);
  assert.equal(result.openingClosingAvailable, false);
});

test("empty charts have explicit unavailable metric denominators", () => {
  const result = aggregateGradedCharts([]);
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.bySeason, []);
  assert.deepEqual(result.cumulative, []);
  assert.equal(result.truncated, false);
});