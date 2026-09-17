import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPersonnelChronology,
  buildPersonnelComparisonReport,
  pairedUncertainty,
  personnelVector,
} from "./personnel-comparison";

test("personnel vectors are home-away differences and reject post-kickoff evidence", () => {
  const row = {
    gameId: "g",
    kickoffTime: new Date("2025-09-07T17:00:00Z"),
    sourceCutoff: new Date("2025-09-07T16:00:00Z"),
    homeTeamId: "home",
    awayTeamId: "away",
    personnel: {
      "personnel.data_confidence": 80,
      "personnel.home.starter_count": 14,
      "personnel.away.starter_count": 12,
      "personnel.home.personnel_completeness": 90,
      "personnel.away.personnel_completeness": 70,
    },
  };
   const vector = personnelVector(row);
   assert.equal(vector[2], 2);
   assert.equal(vector[4], 20);
  assert.throws(() => assertPersonnelChronology([{ kickoffTime: row.kickoffTime, sourceCutoff: new Date("2025-09-08") }]), /strictly before kickoff/);
});

test("paired report keeps exact game set and exposes uncertainty without threshold advice", () => {
  const date = new Date("2025-09-07T17:00:00Z");
  const predictions = ["a", "b"].map((gameId, index) => ({
    gameId,
    week: index + 1,
    family: "spread" as const,
    kickoffTime: date,
    personnelSourceCutoff: new Date("2025-09-07T16:00:00Z"),
    actual: 3,
    baseline: 1,
    challenger: 2,
  }));
  const report = buildPersonnelComparisonReport({
    baselineRunId: "baseline",
    eligibleGameIds: ["a", "b"],
    minimumRecordedLineEdge: 1,
    predictions,
  });
  assert.equal(report.gameSet.exactMatch, true);
  assert.equal(
    (report.models[0]!.pairedDelta as { mae: { sampleSize: number } }).mae.sampleSize,
    2,
  );
  assert.match(report.suitability.reason, /no pre-registered threshold/);
  assert.equal(pairedUncertainty([1]).status, "insufficient_sample");
});