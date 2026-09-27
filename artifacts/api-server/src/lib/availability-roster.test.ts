import test from "node:test";
import assert from "node:assert/strict";
import { assertDevelopmentRosterCaptureTarget, parseEspnTeamRoster } from "./availability";
import { qualifyPlayerEligibility, type PlayerEligibilityEvidence } from "./availability-roster";
import { verifyPublishedAvailability, type AvailabilityCapture } from "./availability-source";

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
  asOf, kickoff: new Date("2026-09-26T18:00:00Z"),
  identity: { gsisId: "00-01", providerId: "123", observedAt },
  roster: { providerId: "123", team: "PIT", status: "active", observedAt, complete: true },
  gameRoster: { providerId: "123", team: "PIT", gameId: "game", status: "active", observedAt,
    publicationAt: observedAt, sourceUrl: "https://www.nfl.com/news/active", sourceHash: "abc", complete: true },
  injury: { providerId: "123", team: "PIT", status: "cleared", observedAt, publicationAt: observedAt,
    sourceUrl: "https://www.nfl.com/news/cleared", sourceHash: "def", complete: true },
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
  assert.equal(qualifyPlayerEligibility({ ...base(), injuryConflict: true }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, sourceUrl: base().gameRoster!.sourceUrl } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), injury: { ...base().injury!, sourceHash: base().gameRoster!.sourceHash } }).eligible, false);
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
  assert.equal(qualifyPlayerEligibility({ ...base(), gameRoster: { ...base().gameRoster!, publicationAt: future } }).eligible, false);
  assert.equal(qualifyPlayerEligibility({ ...base(), asOf: new Date("2026-09-28T00:00:00Z") }).eligible, false);
});

const capture: AvailabilityCapture = {
  kind: "game-roster", sourceUrl: "https://www.nfl.com/news/gameday-active",
  gameId: "game", team: "PIT", playerId: "00-01", playerName: "Example QB",
  gameExcerpt: "Pittsburgh Steelers vs Cincinnati Bengals",
  playerExcerpt: "Example QB is active for today's game",
};
const html = `<html><meta property="article:published_time" content="2026-09-26T10:00:00Z">
  <article>Pittsburgh Steelers vs Cincinnati Bengals. Example QB is active for today's game.</article></html>`;
const context = { home: "Pittsburgh Steelers", away: "Cincinnati Bengals",
  kickoff: new Date("2026-09-27T10:00:00Z"), providerId: "123" };
test("archives only explicit publisher-dated, game-bound affirmative material", () => {
  const row = verifyPublishedAvailability(capture, html, observedAt, context);
  assert.equal(row.publisher, "NFL");
  assert.equal(row.sourceBody, html);
  assert.equal(row.providerId, "123");
  assert.equal(row.assertion, "active");
  for (const altered of [
    { ...capture, playerExcerpt: "Example QB is questionable" },
    { ...capture, gameExcerpt: "Pittsburgh Steelers" },
    { ...capture, sourceUrl: "https://www.nfl.com/injuries/league/2026/reg3" },
    { ...capture, sourceUrl: "https://site.api.espn.com/news/gameday-active" },
  ]) assert.throws(() => verifyPublishedAvailability(altered, html, observedAt, context));
  assert.throws(() => verifyPublishedAvailability(capture, html.replace(/<meta[^>]*>/, ""), observedAt, context));
  assert.throws(() => verifyPublishedAvailability(capture, html, context.kickoff, context));
  assert.throws(() => verifyPublishedAvailability(capture, html, new Date("2026-09-30"), context));
});