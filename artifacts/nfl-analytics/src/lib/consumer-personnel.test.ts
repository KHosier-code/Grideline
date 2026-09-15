import test from "node:test";
import assert from "node:assert/strict";
import { getConsumerPersonnelContent } from "./consumer-personnel";

test("successful empty context cannot produce unsupported injury claims", () => {
  const content = getConsumerPersonnelContent({ drivers: [], message: null });

  assert.deepEqual(content.drivers, []);
  assert.equal(content.message, "No supported personnel drivers are available for this matchup.");
  assert.doesNotMatch(JSON.stringify(content), /cluster injuries|continuity remains intact/i);
});

test("only persisted consumer-safe drivers are shown", () => {
  const content = getConsumerPersonnelContent({
    drivers: ["Away defense has elevated injury impact."],
    message: null,
  });

  assert.deepEqual(content.drivers, ["Away defense has elevated injury impact."]);
  assert.equal(content.message, null);
});