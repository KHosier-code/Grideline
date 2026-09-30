import assert from "node:assert/strict";
import test from "node:test";
import { addResult, emptyRecordLine, gradePicks, picksForProjection } from "./pick-grading";

test("home favored by the line but projected to win by less: take the away side", () => {
  // Home -6.5, we project home by 3 -> away covers by our numbers (edge 3.5).
  const picks = picksForProjection({ margin: 3, total: 44, homeWinProbability: 0.6, spreadLine: -6.5, totalLine: 41.5 });
  assert.deepEqual(picks.spread, { side: "away", edge: 3.5 });
  assert.equal(picks.winner, "home");
  assert.deepEqual(picks.total, { side: "over", edge: 2.5 });
});

test("home underdog projected to win outright: take home plus the points", () => {
  const picks = picksForProjection({ margin: 1.7, total: 44.5, homeWinProbability: 0.53, spreadLine: 2.5, totalLine: 38.5 });
  assert.equal(picks.spread?.side, "home");
  assert.equal(Number(picks.spread?.edge.toFixed(1)), 4.2);
  assert.equal(picks.total?.side, "over");
});

test("projection exactly on the line is not a pick", () => {
  const picks = picksForProjection({ margin: 3, total: 44, homeWinProbability: 0.6, spreadLine: -3, totalLine: 44 });
  assert.equal(picks.spread, null);
  assert.equal(picks.total, null);
});

test("missing line or projection means no pick", () => {
  const picks = picksForProjection({ margin: null, total: null, homeWinProbability: 0.4, spreadLine: -3, totalLine: 44 });
  assert.equal(picks.winner, "away");
  assert.equal(picks.spread, null);
  assert.equal(picks.total, null);
});

test("grading: away +6.5 wins when home wins by 3 and loses when home wins by 10", () => {
  const projection = { margin: 3, total: 44, homeWinProbability: 0.6, spreadLine: -6.5, totalLine: 41.5 };
  const picks = picksForProjection(projection);
  assert.deepEqual(gradePicks(picks, projection, 24, 21), { winner: "win", spread: "win", total: "win" });
  assert.deepEqual(gradePicks(picks, projection, 30, 20), { winner: "win", spread: "loss", total: "win" });
  assert.deepEqual(gradePicks(picks, projection, 17, 20), { winner: "loss", spread: "win", total: "loss" });
});

test("grading pushes on whole-number lines", () => {
  const projection = { margin: 5, total: 50, homeWinProbability: 0.65, spreadLine: -3, totalLine: 44 };
  const picks = picksForProjection(projection);
  const grade = gradePicks(picks, projection, 23, 20);
  assert.equal(grade.spread, "push");
  assert.equal(picksForProjection({ ...projection }).total?.side, "over");
  assert.equal(gradePicks(picks, projection, 24, 20).total, "push");
  assert.equal(gradePicks(picks, projection, 20, 20).winner, "push");
});

test("record lines count wins, losses and pushes", () => {
  const line = emptyRecordLine();
  for (const result of ["win", "win", "loss", "push", null] as const) addResult(line, result);
  assert.deepEqual(line, { wins: 2, losses: 1, pushes: 1 });
});
