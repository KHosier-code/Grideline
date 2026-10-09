import assert from "node:assert/strict";
import test from "node:test";
import { dueClockTasks, kickoffClockEnabled, kickoffWindows, upcomingClockPlan } from "./kickoff-clock";

// Sunday Oct 11 2026: 1:00, 4:05, 4:25 and 8:20 PM ET.
const early = new Date("2026-10-11T17:00:00Z");
const late1 = new Date("2026-10-11T20:05:00Z");
const late2 = new Date("2026-10-11T20:25:00Z");
const night = new Date("2026-10-12T00:20:00Z");
const kickoffs = [early, early, late1, late2, night];
const at = (iso: string, done = new Set<string>()) => dueClockTasks(new Date(iso), kickoffs, done).map((task) => task.key);

test("kickoffs within an hour share one window", () => {
  assert.deepEqual(kickoffWindows(kickoffs).map((window) => window.length), [1, 2, 1]);
});

test("each task fires in its window before kickoff", () => {
  assert.deepEqual(at("2026-10-11T15:30:00Z"), []);
  assert.deepEqual(at("2026-10-11T15:45:00Z"), [
    "weather:2026-10-11T17:00:00.000Z", "injuries:2026-10-11T17:00:00.000Z", "picks:2026-10-11T17:00:00.000Z"]);
  assert.deepEqual(at("2026-10-11T16:25:00Z"), [
    "odds:2026-10-11T17:00:00.000Z", "weather:2026-10-11T17:00:00.000Z", "injuries:2026-10-11T17:00:00.000Z"]);
  // The 4:25 game gets its own odds capture but shares the 4:05 picks refresh.
  assert.ok(at("2026-10-11T19:50:00Z").includes("odds:2026-10-11T20:25:00.000Z"));
  assert.ok(!at("2026-10-11T19:20:00Z").some((key) => key === "picks:2026-10-11T20:25:00.000Z"));
});

test("scores refresh every 15 minutes during games, and done tasks never repeat", () => {
  assert.deepEqual(at("2026-10-11T17:31:00Z"), ["scores:2026-10-11T17:30:00.000Z"]);
  assert.deepEqual(at("2026-10-11T17:31:00Z", new Set(["scores:2026-10-11T17:30:00.000Z"])), []);
  assert.deepEqual(at("2026-10-12T05:00:00Z"), []);
});

test("the clock is off in development unless asked for", () => {
  assert.equal(kickoffClockEnabled({ NODE_ENV: "production" }), true);
  assert.equal(kickoffClockEnabled({ NODE_ENV: "development" }), false);
  assert.equal(kickoffClockEnabled({ NODE_ENV: "development", GRIDLINE_KICKOFF_CLOCK: "on" }), true);
  assert.equal(kickoffClockEnabled({ GRIDLINE_KICKOFF_CLOCK: "off" }), false);
});

test("the plan lists each task's start time, soonest first", () => {
  const plan = upcomingClockPlan(new Date("2026-10-11T15:00:00Z"), kickoffs, 5);
  assert.deepEqual(plan.map((item) => `${item.kind}@${item.at.slice(11, 16)}`),
    ["injuries@15:40", "weather@15:40", "picks@15:45", "odds@16:20", "scores@17:00"]);
});
