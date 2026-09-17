import assert from "node:assert/strict";
import test from "node:test";
import { USAGE_ANALYTICS_RETENTION_DAYS } from "@workspace/db";
import { usageAnalyticsRetentionCutoff } from "./usage-analytics-retention";

test("keeps the Usage Lab report window inside the documented retention period", () => {
  assert.equal(USAGE_ANALYTICS_RETENTION_DAYS, 30);
  const now = new Date("2026-09-17T12:00:00.000Z");
  assert.equal(
    usageAnalyticsRetentionCutoff(now).toISOString(),
    "2026-08-18T12:00:00.000Z",
  );
});

test("retention cutoff preserves the exact timestamp boundary", () => {
  const now = new Date("2026-09-17T12:00:00.123Z");
  const cutoff = usageAnalyticsRetentionCutoff(now);
  assert.equal(cutoff.getUTCMilliseconds(), 123);
  assert.equal(cutoff.getTime(), now.getTime() - 30 * 24 * 60 * 60 * 1000);
});
