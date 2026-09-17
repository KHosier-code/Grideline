import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, verifiedDepthEvidenceTable } from "@workspace/db";
import { validateVerifiedDepthImport } from "./verified-depth-import";

const valid = {
  teamId: "DET", playerId: "p1", playerName: "Player One", position: "RB", role: "RB1", depthRank: 1,
  evidenceState: "verified", availability: "available", source: "manual_authoritative",
  sourceUrl: "https://example.com/depth", observedAt: "2026-09-17T10:00:00Z", verifiedAt: "2026-09-17T11:00:00Z",
  verificationMethod: "two_person_review", provenance: { reviewer: "admin" },
  sourceHash: "a".repeat(64), confidence: 95,
};

test("validated verified depth import accepts complete provenance", () => {
  assert.equal(validateVerifiedDepthImport(valid).evidenceState, "verified");
  assert.equal(validateVerifiedDepthImport({
    ...valid, position: "WR", role: "WR1", depthRank: 2,
  }).depthRank, 2);
});

test("validated import rejects chronology, unsafe URLs, and invalid states", () => {
  assert.throws(() => validateVerifiedDepthImport({ ...valid, observedAt: "2026-09-18T00:00:00Z" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, verifiedAt: "2999-01-01T00:00:00Z" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, sourceUrl: "javascript:alert(1)" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, evidenceState: "maybe" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, sourceHash: "not-a-hash" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, role: "RB3" }));
  assert.throws(() => validateVerifiedDepthImport({ ...valid, position: "WR" }));
});

test("tombstones require role lineage but may omit a player", () => {
  const row = validateVerifiedDepthImport({
    ...valid, playerId: null, playerName: null, depthRank: null,
    evidenceState: "unavailable", availability: "unknown",
  });
  assert.equal(row.playerId, null);
  assert.equal(row.evidenceState, "unavailable");
});

test("database trigger rejects update and delete while failed transactions leave no test evidence", async () => {
  const attemptMutation = async (mutation: "update" | "delete") => {
    await assert.rejects(db.transaction(async (tx) => {
      const [inserted] = await tx.insert(verifiedDepthEvidenceTable).values({
        teamId: "__APPEND_ONLY_TEST__",
        position: "RB",
        role: "RB1",
        evidenceState: "unavailable",
        availability: "unknown",
        source: "automated_contract_test",
        sourceUrl: "https://example.com/append-only-test",
        observedAt: new Date("2026-09-17T10:00:00Z"),
        verifiedAt: new Date("2026-09-17T10:01:00Z"),
        verificationMethod: "automated_contract_test",
        provenance: { test: true },
        sourceHash: `${mutation === "update" ? "b" : "c"}`.repeat(64),
      }).returning();
      if (mutation === "update") {
        await tx.update(verifiedDepthEvidenceTable)
          .set({ availability: "available" })
          .where(eq(verifiedDepthEvidenceTable.id, inserted!.id));
      } else {
        await tx.delete(verifiedDepthEvidenceTable)
          .where(eq(verifiedDepthEvidenceTable.id, inserted!.id));
      }
    }), (error: unknown) => {
      const cause = error instanceof Error && "cause" in error
        ? (error as Error & { cause?: unknown }).cause
        : null;
      return /append-only/i.test(cause instanceof Error ? cause.message : String(error));
    });
  };
  await attemptMutation("update");
  await attemptMutation("delete");
});