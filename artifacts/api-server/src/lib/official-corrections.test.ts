import assert from "node:assert/strict";
import test from "node:test";
import { correctionSnapshotKey } from "./official-corrections";

test("post-kickoff corrections have a separate, stable, non-official identity", () => {
  assert.equal(correctionSnapshotKey("game:official", "review-1"),
    "game:official:post-kickoff-correction:review-1");
  assert.equal(correctionSnapshotKey("game:official", "review-1"),
    correctionSnapshotKey("game:official", "review-1"));
  assert.throws(() => correctionSnapshotKey("game:official", "../bad"));
});