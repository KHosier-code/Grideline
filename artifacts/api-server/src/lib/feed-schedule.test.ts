import { test } from "node:test";
import assert from "node:assert/strict";
import { footballTime, latestFeedSlot, nextFeedUpdate, shouldAttempt } from "./feed-schedule";

test("Thursday injuries refresh every three hours in Eastern time", () => {
  assert.equal(latestFeedSlot("injuries", new Date("2026-09-17T23:15:00Z")).toISOString(), "2026-09-17T22:00:00.000Z");
});
test("Monday night UTC rollover remains Monday Eastern", () => {
  assert.equal(latestFeedSlot("injuries", new Date("2026-09-15T02:30:00Z")).toISOString(), "2026-09-15T01:00:00.000Z");
  assert.equal(latestFeedSlot("nflverse", new Date("2026-09-15T17:59:00Z")).toISOString(), "2026-09-09T18:00:00.000Z");
  assert.equal(latestFeedSlot("nflverse", new Date("2026-09-15T18:00:00Z")).toISOString(), "2026-09-15T18:00:00.000Z");
});
test("playoffs, bye weeks, Saturday and Sunday games keep full cadence", () => {
  for (const date of ["2027-01-16T23:00:00Z", "2027-01-17T23:00:00Z", "2026-10-18T22:00:00Z"]) {
    assert.equal(latestFeedSlot("injuries", new Date(date)).getTime(), new Date(date).getTime());
  }
  assert.equal(footballTime(new Date("2027-02-08T01:00:00Z")).season, 2026);
});
test("offseason uses weekly slots and previous season; August advances season", () => {
  assert.equal(latestFeedSlot("injuries", new Date("2027-06-18T00:00:00Z")).toISOString(), "2027-06-16T16:00:00.000Z");
  assert.equal(latestFeedSlot("nflverse", new Date("2027-06-18T00:00:00Z")).toISOString(), "2027-06-15T18:00:00.000Z");
  assert.equal(footballTime(new Date("2027-07-31T20:00:00Z")).season, 2026);
  assert.equal(footballTime(new Date("2027-08-01T20:00:00Z")).season, 2027);
});
test("DST uses valid Eastern instants", () => {
  assert.equal(latestFeedSlot("injuries", new Date("2026-11-01T08:10:00Z")).toISOString(), "2026-11-01T08:00:00.000Z");
  assert.equal(latestFeedSlot("nflverse", new Date("2027-03-16T18:00:00Z")).toISOString(), "2027-03-16T18:00:00.000Z");
});
test("actual kickoff dates increase cadence for Wednesday and Friday games", () => {
  for (const date of ["2026-11-27T20:00:00Z", "2026-12-23T20:00:00Z"]) {
    const now = new Date(date);
    assert.equal(latestFeedSlot("injuries", now, new Set([footballTime(now).dateKey])).getTime(), +now);
    assert.notEqual(latestFeedSlot("injuries", now).getTime(), +now);
  }
});
test("retries are bounded at four attempts with 5/15/45 minute backoff", () => {
  const completedAt = new Date("2026-09-17T12:00:00Z");
  const failed = { status: "failed", startedAt: completedAt, completedAt };
  assert.equal(shouldAttempt([], completedAt), true);
  for (const [count, minutes] of [[1, 5], [2, 15], [3, 45]]) {
    const attempts = Array(count).fill(failed);
    assert.equal(shouldAttempt(attempts, new Date(+completedAt + minutes * 60000 - 1)), false);
    assert.equal(shouldAttempt(attempts, new Date(+completedAt + minutes * 60000)), true);
  }
  assert.equal(shouldAttempt(Array(4).fill(failed), new Date("2026-09-18")), false);
  assert.equal(shouldAttempt([{ ...failed, status: "success" }], new Date("2026-09-18")), false);
});
test("health reports pending, retry, running and next-slot times", () => {
  const now = new Date("2026-09-17T22:01:00Z");
  const startedAt = new Date("2026-09-17T22:00:00Z");
  const failed = { status: "failed", startedAt, completedAt: now };
  assert.equal(+nextFeedUpdate("injuries", now, [])!, +now);
  assert.equal(nextFeedUpdate("injuries", now, [failed])?.toISOString(), "2026-09-17T22:06:00.000Z");
  assert.equal(nextFeedUpdate("injuries", now, [{ ...failed, status: "running" }]), null);
  assert.equal(nextFeedUpdate("injuries", now, [{ ...failed, status: "success" }])?.toISOString(), "2026-09-18T01:00:00.000Z");
  assert.equal(nextFeedUpdate("injuries", now, Array(4).fill(failed))?.toISOString(), "2026-09-18T01:00:00.000Z");
});
test("a missing current-season NFLverse dataset waits for the next normal slot", () => {
  const now = new Date("2026-09-24T23:50:00Z");
  const failed = {
    status: "failed",
    startedAt: new Date("2026-09-24T23:44:00Z"),
    completedAt: new Date("2026-09-24T23:46:00Z"),
    errorMessage: "Attempt 1/4: Source returned partial: player_stats 2026: source contains no usable rows for the requested season",
  };
  assert.equal(shouldAttempt([failed], now, "nflverse"), false);
  assert.equal(shouldAttempt([failed], now, "injuries"), false); // ordinary backoff still applies
  assert.equal(shouldAttempt([failed], new Date("2026-09-25T00:00:00Z"), "injuries"), true);
  assert.equal(nextFeedUpdate("nflverse", now, [failed])?.toISOString(), "2026-09-29T18:00:00.000Z");
});