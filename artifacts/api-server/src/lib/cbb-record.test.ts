import test from "node:test";
import assert from "node:assert/strict";
import { cbbRecord, gradeCbbPick, type CbbPick } from "./cbb-record";

const pick = (id: string, side: "home" | "away", line: number, edge = 3, tip = "2026-11-10T00:00:00Z"): CbbPick =>
  ({ id, tip, side, team: side === "home" ? "H" : "A", line, edge, home: "H", away: "A" });

test("grading against the spread", () => {
  assert.equal(gradeCbbPick(pick("1", "home", -5.5), { id: "1", homePoints: 80, awayPoints: 70 }), "win");
  assert.equal(gradeCbbPick(pick("1", "home", -5.5), { id: "1", homePoints: 75, awayPoints: 70 }), "loss");
  assert.equal(gradeCbbPick(pick("1", "away", 5), { id: "1", homePoints: 75, awayPoints: 70 }), "push");
  assert.equal(gradeCbbPick(pick("1", "away", 7.5), { id: "1", homePoints: 75, awayPoints: 70 }), "win");
  assert.equal(gradeCbbPick(pick("1", "away", 7.5), undefined), "pending");
});

test("a pick locks at its first showing before tip, at that line", () => {
  const record = cbbRecord([
    // Later run moves the line and flips the side: ignored.
    { generatedAt: new Date("2026-11-09T21:00:00Z"), picks: [pick("1", "away", 3)], results: null },
    { generatedAt: new Date("2026-11-09T13:00:00Z"), picks: [pick("1", "home", -4)], results: null },
    // Shown only after tip-off: never counts.
    { generatedAt: new Date("2026-11-10T01:00:00Z"), picks: [pick("2", "home", -1)], results: null },
    { generatedAt: new Date("2026-11-11T13:00:00Z"), picks: null, results: [
      { id: "1", homePoints: 70, awayPoints: 68 }, { id: "2", homePoints: 90, awayPoints: 60 },
    ] },
  ]);
  assert.equal(record.recent.length, 1);
  assert.equal(record.recent[0].side, "home");
  assert.equal(record.recent[0].line, -4);
  assert.equal(record.recent[0].postedAt, "2026-11-09T13:00:00.000Z");
  assert.deepEqual([record.wins, record.losses, record.pushes, record.pending], [0, 1, 0, 0]);
  assert.equal(record.units, -1);
});

test("totals, units and edge buckets", () => {
  const at = new Date("2026-11-09T13:00:00Z");
  const record = cbbRecord([
    { generatedAt: at, picks: [pick("1", "home", -2, 2.5), pick("2", "home", -2, 5), pick("3", "home", -2, 7), pick("4", "home", -2, 3)], results: null },
    { generatedAt: new Date("2026-11-11T13:00:00Z"), picks: [], results: [
      { id: "1", homePoints: 80, awayPoints: 70 }, { id: "2", homePoints: 80, awayPoints: 70 }, { id: "3", homePoints: 70, awayPoints: 80 },
    ] },
  ]);
  assert.deepEqual([record.wins, record.losses, record.pending], [2, 1, 1]);
  assert.equal(record.units, 0.82);
  assert.deepEqual(record.byEdge.map((bucket) => [bucket.min, bucket.max, bucket.wins, bucket.losses]), [[2, 4, 1, 0], [4, 6, 1, 0], [6, null, 0, 1]]);
});
