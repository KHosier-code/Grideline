import assert from "node:assert/strict";
import test from "node:test";
import type { GameAlertEvidence } from "@workspace/db";
import { advanceGameAlertEvidence, detectGameAlerts, sameGameAlertEvidence } from "./game-alert-detection";

const baseline: GameAlertEvidence = {
  projection: { margin: 3, total: 45, homeWinProbability: 0.55 },
  personnel: { "home:qb": "qb1", "away:qb": "qb2" },
  market: { "FanDuel:spread:home": { point: -3, price: -110 } },
};
const at = "2026-09-26T12:00:00.000Z";

test("material changes are categorized without treating small fluctuations as alerts", () => {
  const small: GameAlertEvidence = {
    projection: { margin: 4, total: 45.5, homeWinProbability: 0.57 },
    personnel: baseline.personnel,
    market: { "FanDuel:spread:home": { point: -3.5, price: -115 } },
  };
  assert.deepEqual(detectGameAlerts(baseline, small, at), []);
  const large: GameAlertEvidence = {
    projection: { margin: 5, total: 45, homeWinProbability: 0.55 },
    personnel: { "home:qb": "qb3", "away:qb": "qb2" },
    market: { "FanDuel:spread:home": { point: -4, price: -110 } },
  };
  assert.deepEqual(detectGameAlerts(baseline, large, at).map((event) => event.category), ["projection", "personnel", "market"]);
  assert.deepEqual(detectGameAlerts(large, large, at), []);
});

test("missing evidence does not erase baselines or fabricate changes", () => {
  const missing: GameAlertEvidence = { projection: null, personnel: null, market: null };
  assert.deepEqual(detectGameAlerts(baseline, missing, at), []);
  assert.deepEqual(advanceGameAlertEvidence(baseline, missing, []), baseline);
});

test("small changes accumulate until an alert and then establish a new baseline", () => {
  const small = { ...baseline, projection: { margin: 4, total: 45, homeWinProbability: 0.55 } };
  const retained = advanceGameAlertEvidence(baseline, small, []);
  assert.equal(retained.projection?.margin, 3);
  const later = { ...small, projection: { margin: 5, total: 45, homeWinProbability: 0.55 } };
  const events = detectGameAlerts(retained, later, at);
  assert.equal(events.length, 1);
  assert.equal(advanceGameAlertEvidence(retained, later, events).projection?.margin, 5);
  assert.deepEqual(detectGameAlerts(advanceGameAlertEvidence(retained, later, events), later, at), []);
});

test("JSONB key order cannot cause a write on every alert check", () => {
  assert.equal(sameGameAlertEvidence(baseline, {
    market: { "FanDuel:spread:home": { price: -110, point: -3 } },
    personnel: { "away:qb": "qb2", "home:qb": "qb1" },
    projection: { homeWinProbability: 0.55, total: 45, margin: 3 },
  }), true);
});