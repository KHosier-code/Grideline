import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentRosterCaptureTarget, parseEspnTeamRoster } from "./availability";

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