import assert from "node:assert/strict";
import test from "node:test";
import {
  FOOTBALL_TIMEZONE,
  INJURY_WEEKLY_SLOTS,
  ODDS_WEEKLY_SLOTS,
  ADAPTIVE_ODDS_CADENCE,
  nextLeanOddsCapture,
  oddsCaptureMode,
  classifySchedulerAlerts,
  confidenceCaptureOccurrences,
  canonicalPredictionOccurrence,
  adaptiveOddsJobReconciliation,
  nextWeeklyOccurrence,
  groupSundayKickoffWindows,
  shouldRecoverMissedOccurrence,
  shouldRetireFlexedConfidenceOccurrence,
  shouldRearmDynamicOccurrence,
  startDataScheduler,
  stopDataScheduler,
  zonedTimeToUtc,
} from "./scheduler";
import { shouldInsertLatestState } from "./availability";
import { shouldRefreshNflverseSource } from "./nflverse";
import {
  calculatePaidRequestCredits,
  ODDS_EXPECTED_REQUEST_COST,
  oddsCaptureIntervalMinutes,
  oddsCaptureRequestCount,
  oddsCaptureQuotaDecision,
  isPreKickoffCapture,
} from "./odds";

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

test("worker scheduler startup fails closed on preparation and recovery errors, then can retry", async (t) => {
  t.after(stopDataScheduler);
  const environment = { GRIDLINE_SCHEDULER_WORKER: "1" };
  const events: string[] = [];
  const preparedFailure = new Error("isolated preparation failure");
  const recoveryFailure = new Error("isolated recovery failure");
  const prepare = async () => { events.push("prepare"); };
  const recover = async () => { events.push("recover"); };

  await assert.rejects(startDataScheduler({
    environment,
    prepare: async () => { events.push("prepare-failed"); throw preparedFailure; },
    recover,
  }), (error) => error === preparedFailure);
  assert.deepEqual(events, ["prepare-failed"]);

  await assert.rejects(startDataScheduler({
    environment,
    prepare,
    recover: async () => { events.push("recover-failed"); throw recoveryFailure; },
  }), (error) => error === recoveryFailure);
  assert.deepEqual(events, ["prepare-failed", "prepare", "recover-failed"]);

  // If either failed attempt had installed a timer, this retry would return
  // early and never invoke the isolated startup dependencies.
  await startDataScheduler({ environment, prepare, recover });
  assert.deepEqual(events, ["prepare-failed", "prepare", "recover-failed", "prepare", "recover"]);
});

test("API role does not prepare or recover worker scheduler jobs", async () => {
  await startDataScheduler({
    environment: { GRIDLINE_SCHEDULER_WORKER: undefined },
    prepare: async () => { throw new Error("API must not prepare scheduler jobs"); },
    recover: async () => { throw new Error("API must not recover scheduler jobs"); },
  });
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

test("adaptive odds cadence tightens only as kickoff approaches", () => {
  assert.equal(oddsCaptureIntervalMinutes(12), 0);
  assert.equal(oddsCaptureIntervalMinutes(6), 12);
  assert.equal(oddsCaptureIntervalMinutes(1), 5);
  assert.equal(oddsCaptureIntervalMinutes(0.25), 5);
});

test("adaptive odds quota budgets every remaining game-window capture", () => {
  assert.equal(oddsCaptureRequestCount(0), 0);
  assert.equal(oddsCaptureRequestCount(1), 12);
  assert.equal(oddsCaptureRequestCount(6), 37);
  assert.deepEqual(oddsCaptureQuotaDecision(29, ODDS_EXPECTED_REQUEST_COST, 37), {
    safe: false,
    expectedCost: ODDS_EXPECTED_REQUEST_COST,
    requiredRequestCount: 37,
    requiredCredits: ODDS_EXPECTED_REQUEST_COST * 37,
    creditsRemaining: 29,
    reason: `Insufficient Odds API credits (29 remaining; ${ODDS_EXPECTED_REQUEST_COST * 37} required for 37 requests).`,
  });
  assert.deepEqual(oddsCaptureQuotaDecision(null, ODDS_EXPECTED_REQUEST_COST, 12), {
    safe: false,
    expectedCost: ODDS_EXPECTED_REQUEST_COST,
    requiredRequestCount: 12,
    requiredCredits: 36,
    creditsRemaining: null,
    reason: "Odds API remaining credits are unknown; 36 known credits are required before intensified capture.",
  });
});

test("adaptive job persistence reactivates null schedules and follows kickoff changes", () => {
  const now = new Date("2026-09-17T17:00:00.000Z");
  const next = new Date("2026-09-17T18:15:00.000Z");
  const dormant = {
    enabled: false,
    nextRunAt: null,
    lockUntil: null,
    cadence: "adaptive: hourly >6h",
  };
  assert.deepEqual(adaptiveOddsJobReconciliation(dormant, next, now), {
    enabled: true,
    nextRunAt: next,
    cadence: ADAPTIVE_ODDS_CADENCE,
  });
  const obsolete = { ...dormant, enabled: true, nextRunAt: new Date("2026-09-19T14:00:00.000Z") };
  assert.equal(adaptiveOddsJobReconciliation(obsolete, next, now)?.nextRunAt, next);
});

test("adaptive job persistence does not move an active lease", () => {
  const now = new Date("2026-09-17T23:30:00.000Z");
  assert.equal(adaptiveOddsJobReconciliation({
    enabled: true,
    nextRunAt: new Date("2026-09-17T23:35:00.000Z"),
    lockUntil: new Date("2026-09-17T23:31:00.000Z"),
    cadence: ADAPTIVE_ODDS_CADENCE,
  }, new Date("2026-09-17T23:35:00.000Z"), now), null);
});

test("adaptive job persistence keeps a due final-hour occurrence claimable on restart", () => {
  const now = new Date("2026-09-17T23:40:30.000Z");
  const due = new Date("2026-09-17T23:40:00.000Z");
  assert.equal(adaptiveOddsJobReconciliation({
    enabled: true,
    nextRunAt: due,
    lockUntil: null,
    cadence: ADAPTIVE_ODDS_CADENCE,
  }, new Date("2026-09-17T23:45:30.000Z"), now), null);
});

test("paid odds admission exposes quota blocks without spending credits", () => {
  assert.deepEqual(oddsCaptureQuotaDecision(ODDS_EXPECTED_REQUEST_COST - 1), {
    safe: false,
    expectedCost: ODDS_EXPECTED_REQUEST_COST,
    creditsRemaining: ODDS_EXPECTED_REQUEST_COST - 1,
    reason: `Insufficient Odds API credits (${ODDS_EXPECTED_REQUEST_COST - 1} remaining; ${ODDS_EXPECTED_REQUEST_COST} required).`,
  });
  assert.equal(oddsCaptureQuotaDecision(null).safe, true);
});

test("final pre-kickoff evidence excludes observations at kickoff", () => {
  const kickoff = new Date("2026-09-20T17:00:00Z");
  assert.equal(isPreKickoffCapture(new Date("2026-09-20T16:59:59Z"), kickoff), true);
  assert.equal(isPreKickoffCapture(kickoff, kickoff), false);
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

test("canonical prediction occurrence is exactly 30 minutes before kickoff", () => {
  const occurrence = canonicalPredictionOccurrence("game-1", new Date("2026-09-20T17:00:00.000Z"));
  assert.equal(occurrence.jobKey, "prediction-canonical-game-1");
  assert.equal(occurrence.cutoffMinutes, 30);
  assert.equal(occurrence.scheduledFor.toISOString(), "2026-09-20T16:30:00.000Z");
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

test("odds capture defaults to lean mode unless intensive is requested", () => {
  assert.equal(oddsCaptureMode(undefined), "lean");
  assert.equal(oddsCaptureMode(""), "lean");
  assert.equal(oddsCaptureMode("Intensive"), "intensive");
  assert.equal(oddsCaptureMode("frequent"), "lean");
});

test("lean odds capture takes one snapshot 40 minutes before each distinct kickoff", () => {
  const now = new Date("2026-09-20T16:30:00.000Z");
  const early = new Date("2026-09-20T17:00:00.000Z");
  const late = new Date("2026-09-20T20:25:00.000Z");
  const slot = new Date("2026-09-22T14:00:00.000Z");
  // Early kickoff capture (16:20) has passed, so the late window is next.
  assert.deepEqual(nextLeanOddsCapture(now, [early, early, late], [slot]), new Date("2026-09-20T19:45:00.000Z"));
  assert.deepEqual(nextLeanOddsCapture(new Date("2026-09-20T21:00:00.000Z"), [late], [slot]), slot);
  assert.equal(nextLeanOddsCapture(now, [], []), null);
});
