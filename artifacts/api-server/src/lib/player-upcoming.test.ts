import assert from "node:assert/strict";
import { test } from "node:test";
import { assessUpcomingEvidence } from "./player-upcoming";

const asOf = new Date("2026-09-26T19:00:00.000Z");
const retrieved = new Date("2026-09-26T18:58:02.183Z");
const base = {
  asOf,
  sourceRetrievedAt: retrieved,
  sleeperTeam: "WAS",
  currentTeam: "WSH",
  injuryStatus: null,
  injuryObservedAt: null,
  rosterStatus: null,
  rosterObservedAt: null,
};

test("a current canonical Sleeper team supports conditional inference, not confirmed participation", () => {
  assert.deepEqual(assessUpcomingEvidence(base), {
    allowed: true, reason: "participation_unconfirmed", injuryStatus: null, uncertain: true,
  });
});

test("stale, missing, or conflicting roster evidence fails closed", () => {
  assert.equal(assessUpcomingEvidence({ ...base, sourceRetrievedAt: new Date("2026-09-23T12:00:00Z") }).reason, "stale_sleeper_retrieval");
  assert.equal(assessUpcomingEvidence({ ...base, sourceRetrievedAt: new Date("2026-09-27T12:00:00Z") }).reason, "stale_sleeper_retrieval");
  assert.equal(assessUpcomingEvidence({ ...base, sleeperTeam: null }).reason, "missing_team");
  assert.equal(assessUpcomingEvidence({ ...base, currentTeam: "NYG" }).reason, "conflicting_team");
});

test("recent out status suppresses, old out status is not mistaken for current health", () => {
  const out = { ...base, injuryStatus: "Out", injuryObservedAt: retrieved };
  assert.equal(assessUpcomingEvidence(out).reason, "reported_unavailable");
  const old = assessUpcomingEvidence({ ...out, injuryObservedAt: new Date("2026-09-17T18:00:00Z") });
  assert.equal(old.allowed, true);
  assert.equal(old.injuryStatus, null);
  assert.equal(old.uncertain, true);
});

test("a new unavailable roster status suppresses even with a recent injury record", () => {
  const result = assessUpcomingEvidence({
    ...base, injuryStatus: "Active", injuryObservedAt: retrieved,
    rosterStatus: "Inactive", rosterObservedAt: retrieved,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "reported_unavailable");
});

test("a missing injury entry does not become healthy just because a roster status is active", () => {
  const result = assessUpcomingEvidence({ ...base, rosterStatus: "Active", rosterObservedAt: retrieved });
  assert.equal(result.allowed, true);
  assert.equal(result.uncertain, true);
});

test("two recent Active labels still cannot confirm future participation", () => {
  const result = assessUpcomingEvidence({
    ...base, rosterStatus: "Active", rosterObservedAt: retrieved,
    injuryStatus: "Active", injuryObservedAt: retrieved,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.injuryStatus, "Active");
  assert.equal(result.uncertain, true);
});