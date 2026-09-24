import test from "node:test";
import assert from "node:assert/strict";
import { classifyPlayerEligibility } from "./consumer-player-eligibility";

const now = new Date("2026-09-15T12:00:00Z");
const fresh = new Date("2026-09-15T10:00:00Z");

function classify(overrides: Partial<Parameters<typeof classifyPlayerEligibility>[0]> = {}) {
  return classifyPlayerEligibility({
    gameState: "pregame",
    injuryStatus: "Active",
    statusAsOf: fresh,
    now,
    ...overrides,
  });
}

test("confirms active status for a scheduled pregame player", () => {
  assert.deepEqual(classify({ gameState: "scheduled" }), { status: "eligible", reason: null });
  assert.deepEqual(classify({ injuryStatus: "Full Participation" }), { status: "eligible", reason: null });
});

test("fails closed for confirmed unavailable injury and roster statuses", () => {
  for (const status of ["Inactive", "IR", "Suspended", "Released"]) {
    assert.equal(classify({ injuryStatus: status }).status, "ineligible", status);
  }
  assert.equal(classify({ injuryStatus: "Active", rosterStatus: "Injured Reserve" }).status, "ineligible");
});

test("treats completed, live, postponed, and cancelled games as ineligible", () => {
  for (const gameState of ["live", "final", "postponed", "cancelled"] as const) {
    assert.equal(classify({ gameState }).status, "ineligible", gameState);
  }
});

test("returns unknown for absent, ambiguous, or uncertain status evidence", () => {
  assert.equal(classify({ injuryStatus: null }).status, "unknown");
  assert.equal(classify({ injuryStatus: "Questionable" }).status, "unknown");
  assert.equal(classify({ injuryStatus: "Doubtful" }).status, "unknown");
});

test("returns unknown when the status evidence is stale", () => {
  assert.equal(classify({
    statusAsOf: new Date("2026-09-01T12:00:00Z"),
  }).status, "unknown");
});