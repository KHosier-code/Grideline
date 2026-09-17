import assert from "node:assert/strict";
import test from "node:test";
import {
  FOOTBALL_TIMEZONE,
  INJURY_WEEKLY_SLOTS,
  ODDS_WEEKLY_SLOTS,
  classifySchedulerAlerts,
  confidenceCaptureOccurrences,
  nextWeeklyOccurrence,
  groupSundayKickoffWindows,
  shouldRecoverMissedOccurrence,
  shouldRetireFlexedConfidenceOccurrence,
  shouldRearmDynamicOccurrence,
  zonedTimeToUtc,
} from "./scheduler";
import { shouldInsertLatestState } from "./availability";
import { shouldRefreshNflverseSource } from "./nflverse";
import { calculatePaidRequestCredits, ODDS_EXPECTED_REQUEST_COST } from "./odds";

test("football wall-clock conversion follows DST", () => {
  const summer = zonedTimeToUtc(
    { year: 2025, month: 7, day: 1, hour: 10, minute: 0 },
    FOOTBALL_TIMEZONE,
  );
  const winter = zonedTimeToUtc(
    { year: 2025, month: 1, day: 7, hour: 10, minute: 0 },
    FOOTBALL_TIMEZONE,
  );
  assert.equal(summer.toISOString(), "2025-07-01T14:00:00.000Z");
  assert.equal(winter.toISOString(), "2025-01-07T15:00:00.000Z");
});

test("weekly scheduler slots are strictly future and timezone-aware", () => {
  const now = new Date("2025-03-09T13:30:00.000Z");
  const next = nextWeeklyOccurrence(now, 2, 10, 0, FOOTBALL_TIMEZONE);
  assert.equal(next.toISOString(), "2025-03-11T14:00:00.000Z");
  assert.ok(next.getTime() > now.getTime());
});

test("startup recovery is separate from normal due execution", () => {
  const now = new Date("2025-09-07T12:00:00.000Z");
  assert.equal(shouldRecoverMissedOccurrence(new Date("2025-09-07T11:59:00.000Z"), null, now), true);
  assert.equal(shouldRecoverMissedOccurrence(new Date("2025-09-07T12:01:00.000Z"), null, now), false);
  assert.equal(shouldRecoverMissedOccurrence(new Date("2025-09-07T11:59:00.000Z"), new Date("2025-09-07T12:05:00.000Z"), now), false);
});

test("a flexed kickoff rearms only a genuinely new future window", () => {
  const now = new Date("2025-09-07T12:00:00.000Z");
  const previousRun = new Date("2025-09-07T10:00:00.000Z");
  assert.equal(
    shouldRearmDynamicOccurrence(
      new Date("2025-09-07T13:00:00.000Z"),
      new Date("2025-09-14T12:00:00.000Z"),
      previousRun,
      now,
    ),
    true,
  );
  assert.equal(
    shouldRearmDynamicOccurrence(
      new Date("2025-09-07T09:00:00.000Z"),
      new Date("2025-09-14T12:00:00.000Z"),
      previousRun,
      now,
    ),
    false,
  );
});

test("odds cadence has exactly seven weekly slots", () => {
  assert.equal(ODDS_WEEKLY_SLOTS.length, 7);
  assert.equal(new Set(ODDS_WEEKLY_SLOTS.map((slot) => slot.jobKey)).size, 7);
  assert.deepEqual(
    ODDS_WEEKLY_SLOTS.map((slot) => slot.jobKey),
    [
      "odds-tuesday",
      "odds-thursday",
      "odds-saturday",
      "odds-sunday-morning",
      "odds-sunday-late-morning",
      "odds-sunday-final",
      "odds-monday-final",
    ],
  );
});

test("injury cadence includes all free-feed windows and kickoff-relative Monday", () => {
  assert.deepEqual(
    INJURY_WEEKLY_SLOTS.map((slot) => slot.jobKey),
    [
      "injury-tuesday",
      "injury-wednesday",
      "injury-thursday-morning",
      "injury-thursday-afternoon",
      "injury-friday-morning",
      "injury-friday-afternoon",
      "injury-saturday",
      "injury-sunday-morning",
      "injury-sunday-late-morning",
      "injury-monday-final",
    ],
  );
});

test("Sunday injury windows dedupe same kickoff and retain late/SNF windows", () => {
  const windows = groupSundayKickoffWindows([
    { gameId: "early-a", kickoffTime: new Date("2025-09-07T17:00:00.000Z") },
    { gameId: "early-b", kickoffTime: new Date("2025-09-07T17:00:00.000Z") },
    { gameId: "late", kickoffTime: new Date("2025-09-07T20:25:00.000Z") },
    { gameId: "snf", kickoffTime: new Date("2025-09-08T00:20:00.000Z") },
  ]);
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((window) => window.bucket), ["early", "late", "snf"]);
  assert.deepEqual(windows[0].gameIds, ["early-a", "early-b"]);
});

test("confidence captures use documented kickoff-relative windows", () => {
  const kickoff = new Date("2026-09-20T17:00:00.000Z");
  assert.deepEqual(
    confidenceCaptureOccurrences("game-1", kickoff).map((occurrence) => ({
      jobKey: occurrence.jobKey,
      scheduledFor: occurrence.scheduledFor.toISOString(),
    })),
    [
      { jobKey: "confidence-24h-game-1", scheduledFor: "2026-09-19T17:00:00.000Z" },
      { jobKey: "confidence-6h-game-1", scheduledFor: "2026-09-20T11:00:00.000Z" },
      { jobKey: "confidence-75m-game-1", scheduledFor: "2026-09-20T15:45:00.000Z" },
    ],
  );
});

test("normal due confidence jobs remain claimable while earlier kickoff flexes retire stale slots", () => {
  const now = new Date("2026-09-20T11:01:00.000Z");
  const normalOccurrence = new Date("2026-09-20T11:00:00.000Z");
  assert.equal(shouldRetireFlexedConfidenceOccurrence(normalOccurrence, normalOccurrence, now), false);
  assert.equal(
    shouldRetireFlexedConfidenceOccurrence(
      new Date("2026-09-20T12:00:00.000Z"),
      new Date("2026-09-20T11:00:00.000Z"),
      now,
    ),
    true,
  );
});

test("latest-state injury dedupe preserves A-B-A history", () => {
  assert.equal(shouldInsertLatestState(null, "A"), true);
  assert.equal(shouldInsertLatestState("A", "B"), true);
  assert.equal(shouldInsertLatestState("B", "A"), true);
  assert.equal(shouldInsertLatestState("A", "A"), false);
});

test("automatic NFLverse refresh bypasses cache only when explicitly requested", () => {
  assert.equal(shouldRefreshNflverseSource(), false);
  assert.equal(shouldRefreshNflverseSource({ refresh: false }), false);
  assert.equal(shouldRefreshNflverseSource({ refresh: true }), true);
});

test("quota counters prefer per-call cost and otherwise derive a positive delta", () => {
  assert.equal(ODDS_EXPECTED_REQUEST_COST, 3);
  assert.equal(calculatePaidRequestCredits(1, 101, 100), 1);
  assert.equal(calculatePaidRequestCredits(null, 101, 100), 1);
  assert.equal(calculatePaidRequestCredits(null, 99, 100), null);
  assert.equal(calculatePaidRequestCredits(null, null, null), null);
});

test("scheduler health identifies overdue jobs, expired locks, and repeated failures without executing work", () => {
  const now = new Date("2025-09-07T12:00:00.000Z");
  const alerts = classifySchedulerAlerts([
    {
      jobKey: "overdue",
      enabled: true,
      nextRunAt: new Date("2025-09-07T11:50:00.000Z"),
      lockOwner: null,
      lockUntil: null,
    },
    {
      jobKey: "expired",
      enabled: true,
      nextRunAt: new Date("2025-09-07T11:30:00.000Z"),
      lockOwner: "worker-a",
      lockUntil: new Date("2025-09-07T11:59:00.000Z"),
    },
    {
      jobKey: "failing",
      enabled: true,
      nextRunAt: new Date("2025-09-07T13:00:00.000Z"),
      lockOwner: null,
      lockUntil: null,
    },
    {
      jobKey: "disabled",
      enabled: false,
      nextRunAt: new Date("2025-09-01T00:00:00.000Z"),
      lockOwner: "old-worker",
      lockUntil: new Date("2025-09-02T00:00:00.000Z"),
    },
    {
      jobKey: "failed-one-shot",
      enabled: false,
      nextRunAt: null,
      lockOwner: null,
      lockUntil: null,
    },
  ], [
    { jobKey: "failed-one-shot", status: "failed" },
    { jobKey: "failing", status: "failed" },
    { jobKey: "failing", status: "failed" },
    { jobKey: "failing", status: "failed" },
    { jobKey: "overdue", status: "success" },
  ], now);

  assert.ok(alerts.some((alert) => alert.jobKey === "overdue" && alert.code === "overdue"));
  assert.ok(alerts.some((alert) => alert.jobKey === "expired" && alert.code === "expired_lock"));
  assert.ok(alerts.some((alert) => alert.jobKey === "failing" && alert.code === "repeated_failures"));
  assert.equal(alerts.some((alert) => alert.jobKey === "disabled"), false);
  assert.ok(alerts.some((alert) => alert.jobKey === "failed-one-shot" && alert.code === "last_run_failed"));
});

test("scheduler health distinguishes a still-valid overdue lock", () => {
  const alerts = classifySchedulerAlerts([{
    jobKey: "running-long",
    enabled: true,
    nextRunAt: new Date("2025-09-07T11:50:00.000Z"),
    lockOwner: "worker-a",
    lockUntil: new Date("2025-09-07T13:00:00.000Z"),
  }], [], new Date("2025-09-07T12:00:00.000Z"));
  assert.deepEqual(alerts.map((alert) => alert.code), ["overdue_locked"]);
});
