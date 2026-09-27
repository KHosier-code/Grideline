import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentRosterCaptureTarget, parseEspnTeamRoster } from "./availability";
import { qualifyPlayerEligibility, type PlayerEligibilityEvidence } from "./availability-roster";

test("parses position-grouped ESPN roster identities without inferring missing players", () => {
  assert.deepEqual(parseEspnTeamRoster({ athletes: [
    { position: { abbreviation: "QB" }, items: [
      { id: "123", displayName: "Example QB", status: { name: "Active" } },
    ] },
    { position: { abbreviation: "RB" }, items: [
      { id: "456", displayName: "Example RB" },
    ] },
  ] }, "1"), [
    { playerId: "123", playerName: "Example QB", position: "QB", activeStatus: "Active" },
    { playerId: "456", playerName: "Example RB", position: "RB", activeStatus: null },
  ]);
  assert.throws(() => parseEspnTeamRoster({ athletes: [] }, "1"), /Incomplete/);
  assert.throws(() => parseEspnTeamRoster({ athletes: [{ items: [] }] }, "1"), /Incomplete/);
  assert.throws(() => parseEspnTeamRoster({ athletes: [{ items: [{ displayName: "No ID" }] }] }, "1"), /Invalid/);
  assert.throws(() => parseEspnTeamRoster({ athletes: [{ items: [
    { id: "1", displayName: "First" }, { id: "1", displayName: "Duplicate" },
  ] }] }, "1"), /duplicate/);
});

test("manual roster capture rejects missing confirmation before inspecting the database", async () => {
  await assert.rejects(assertDevelopmentRosterCaptureTarget(""), /explicit development confirmation/);
});

const asOf = new Date("2026-09-26T12:00:00Z");
const observedAt = new Date("2026-09-26T11:00:00Z");
const base = (): PlayerEligibilityEvidence => ({
  playerId: "00-01", team: "PIT", opponent: "CIN", gameId: "game",
  asOf, kickoff: new Date("2026-09-27T18:00:00Z"),
  identity: { gsisId: "00-01", providerId: "123", observedAt },
  roster: { providerId: "123", team: "PIT", status: "active", observedAt, complete: true },
  gameRoster: { providerId: "123", team: "PIT", gameId: "game", status: "active", observedAt, complete: true },
  injury: { providerId: "123", team: "PIT", status: "cleared", observedAt, publicationAt: observedAt, complete: true },
});

test("only independently affirmative current evidence can qualify a player", () => {
  assert.equal(qualifyPlayerEligibility(base()).eligible, true);
  for (const field of ["identity", "roster", "gameRoster", "injury"] as const) {
    assert.equal(qualifyPlayerEligibility({ ...base(), [field]: null }).eligible, false, field);
  }
  assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, complete: false } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), roster: { ...base().roster!, team: "CIN" } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), gameRoster: { ...base().gameRoster!, gameId: "other" } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, status: "questionable" } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), roster: { ...base().roster!, status: "active - injured reserve" } }).eligible, false);
});

test("stale and future observations or publications cannot qualify a player", () => {
  const old = new Date("2026-09-23T11:00:00Z");
  const future = new Date("2026-09-27T19:00:00Z");
  for (const at of [old, future]) {
    assert.equal(qualifyPlayerEligibility({ ...base(), identity: { ...base().identity!, observedAt: at } }).eligible, false);
    assert.equal(qualifyPlayerEligibility({ ...base(), roster: { ...base().roster!, observedAt: at } }).eligible, false);
    assert.equal(qualifyPlayerEligibility({ ...base(), gameRoster: { ...base().gameRoster!, observedAt: at } }).eligible, false);
    assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, publicationAt: at } }).eligible, false);
  }
  assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, publicationAt: null } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), asOf: new Date("2026-09-28T00:00:00Z") }).eligible, false);
});