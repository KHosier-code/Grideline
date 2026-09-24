import assert from "node:assert/strict";
import test from "node:test";
import { assessConsumerSource, type ConsumerSourceStatus } from "./consumer-source-health";

const now = new Date("2026-10-12T18:00:00.000Z");
const assessment = (overrides: Partial<Parameters<typeof assessConsumerSource>[0]> = {}) =>
  assessConsumerSource({
    lastAttemptAt: new Date("2026-10-12T17:55:00.000Z"),
    lastSuccessAt: new Date("2026-10-12T17:50:00.000Z"),
    sourceTimestamp: new Date("2026-10-12T17:50:00.000Z"),
    lastAttemptStatus: "success",
    hasSource: true,
    staleAfterMinutes: 60,
    now,
    ...overrides,
  });

test("source is stale after its configured freshness window", () => {
  const source = assessment({
    lastSuccessAt: new Date("2026-10-12T15:00:00.000Z"),
    sourceTimestamp: new Date("2026-10-12T15:00:00.000Z"),
  });
  assert.equal(source.status, "stale");
  assert.match(source.message ?? "", /freshness threshold/);
});

test("failed latest attempt remains visible despite an earlier success", () => {
  const succeededAt = new Date("2026-10-12T17:00:00.000Z");
  const attemptedAt = new Date("2026-10-12T17:55:00.000Z");
  const source = assessment({
    lastAttemptAt: attemptedAt,
    lastSuccessAt: succeededAt,
    lastAttemptStatus: "failed",
  });
  assert.equal(source.status, "partial");
  assert.equal(source.lastAttemptAt, attemptedAt.toISOString());
  assert.equal(source.lastSuccessAt, succeededAt.toISOString());
  assert.equal(source.lastAttemptStatus, "failed");
});

test("partial synchronization is reported even when source data is fresh", () => {
  const source = assessment({
    lastAttemptStatus: "partial",
    partialMessage: "One or more source components were missing.",
  });
  assert.equal(source.status, "partial");
  assert.equal(source.message, "One or more source components were missing.");
});

test("an old successful observation remains stale despite a newer failed attempt", () => {
  const source = assessment({
    lastSuccessAt: new Date("2026-10-12T14:00:00Z"),
    sourceTimestamp: new Date("2026-10-12T14:00:00Z"),
    lastAttemptStatus: "failed",
  });
  assert.equal(source.status, "stale");
  assert.equal(source.lastAttemptStatus, "failed");
});

test("a successful empty fetch cannot make the feed healthy", () => {
  assert.equal(assessment({ hasSource: false }).status, "unavailable");
});

test("a zero-record successful odds request cannot refresh an old quote", () => {
  const source = assessment({
    observationRequired: true,
    lastSuccessAt: now,
    sourceTimestamp: new Date("2026-10-12T16:00:00Z"),
    staleAfterMinutes: 15,
  });
  assert.equal(source.status, "stale");
});

test("source without rows or a recorded attempt is unavailable", () => {
  const source = assessment({
    lastAttemptAt: null,
    lastSuccessAt: null,
    sourceTimestamp: null,
    lastAttemptStatus: null,
    hasSource: false,
  });
  assert.equal(source.status, "unavailable");
  assert.equal(source.lastSuccessAt, null);
  assert.match(source.message ?? "", /No source records/);
});

test("attempt status alone never manufactures a successful timestamp", () => {
  const source = assessment({
    lastAttemptAt: new Date("2026-10-12T17:55:00.000Z"),
    lastSuccessAt: null,
    sourceTimestamp: null,
    lastAttemptStatus: "failed",
    hasSource: false,
  });
  assert.equal(source.status, "unavailable");
  assert.equal(source.lastSuccessAt, null);
  assert.equal(source.lastAttemptStatus, "failed");
});

test("consumer source status vocabulary remains constrained", () => {
  const allowed: ConsumerSourceStatus[] = ["healthy", "partial", "stale", "unavailable"];
  assert.ok(allowed.includes(assessment().status));
});