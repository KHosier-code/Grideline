import test from "node:test";
import assert from "node:assert/strict";
import { cbbRecord, dailyCards, gameDay, gradeCbbPick, type CbbPick } from "./cbb-record";

// 7 PM Eastern on Nov 10 is 00:00 UTC on Nov 11.
const pick = (id: string, side: "home" | "away", line: number, edge = 3, tip = "2026-11-11T00:00:00Z"): CbbPick =>
  ({ id, tip, side, team: side === "home" ? "H" : "A", line, edge, home: "H", away: "A" });
const morning = new Date("2026-11-10T13:00:00Z"); // 8 AM Eastern, Nov 10
const later = new Date("2026-11-11T13:00:00Z");

test("grading against the spread", () => {
  assert.equal(gradeCbbPick(pick("1", "home", -5.5), { id: "1", homePoints: 80, awayPoints: 70 }), "win");
  assert.equal(gradeCbbPick(pick("1", "home", -5.5), { id: "1", homePoints: 75, awayPoints: 70 }), "loss");
  assert.equal(gradeCbbPick(pick("1", "away", 5), { id: "1", homePoints: 75, awayPoints: 70 }), "push");
  assert.equal(gradeCbbPick(pick("1", "away", 7.5), { id: "1", homePoints: 75, awayPoints: 70 }), "win");
  assert.equal(gradeCbbPick(pick("1", "away", 7.5), undefined), "pending");
});

test("game days are Eastern dates: a 10 PM tip stays on its night", () => {
  assert.equal(gameDay("2026-11-11T03:00:00Z"), "2026-11-10");
});

test("the daily card: top 5 gaps between 2 and 6 points, from the first run after 7 AM", () => {
  const cards = dailyCards([
    // Overnight run (before the card opens): ignored.
    { generatedAt: new Date("2026-11-10T07:00:00Z"), picks: [pick("early", "home", -1, 5.9)], results: null },
    { generatedAt: morning, picks: [
      pick("a", "home", -3, 2.1), pick("b", "home", -3, 5.9), pick("c", "away", 4, 4.0), pick("d", "home", -2, 3.0),
      pick("e", "away", 7, 2.5), pick("f", "home", -9, 2.2), pick("huge", "home", -1, 9.0),
    ], results: null },
    // Later the same day: can't add to or change the card.
    { generatedAt: new Date("2026-11-10T21:00:00Z"), picks: [pick("g", "home", -3, 5.5), pick("b", "away", 3, 4)], results: null },
  ]);
  assert.deepEqual([...cards.keys()], ["b", "c", "d", "e", "f"]);
  assert.equal(cards.get("b")!.side, "home");
  assert.equal(cards.get("b")!.postedAt, morning.toISOString());
});

test("record counts only the card, with units and the edge buckets", () => {
  const record = cbbRecord([
    { generatedAt: morning, picks: [pick("1", "home", -2, 2.5), pick("2", "home", -2, 5), pick("3", "home", -2, 3), pick("lean", "home", -2, 1.5)], results: null },
    { generatedAt: later, picks: [], results: [
      { id: "1", homePoints: 80, awayPoints: 70 }, { id: "2", homePoints: 80, awayPoints: 70 }, { id: "3", homePoints: 70, awayPoints: 80 },
      { id: "lean", homePoints: 90, awayPoints: 60 },
    ] },
  ]);
  assert.deepEqual([record.wins, record.losses, record.pending], [2, 1, 0]);
  assert.equal(record.units, 0.82);
  assert.deepEqual(record.byEdge.map((bucket) => [bucket.min, bucket.max, bucket.wins, bucket.losses]), [[2, 4, 1, 1], [4, 6, 1, 0]]);
  assert.deepEqual(record.official, []);
  const open = cbbRecord([{ generatedAt: morning, picks: [pick("9", "away", 3.5, 4)], results: null }]);
  assert.deepEqual(open.official.map((item) => [item.id, item.side, item.line, item.postedAt]), [["9", "away", 3.5, morning.toISOString()]]);
});

test("picks shown only after tip-off never count", () => {
  const record = cbbRecord([{ generatedAt: new Date("2026-11-11T01:00:00Z"), picks: [pick("1", "home", -2, 3)], results: null }]);
  assert.equal(record.recent.length + record.pending, 0);
});
