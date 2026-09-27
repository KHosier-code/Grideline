import test from "node:test";
import assert from "node:assert/strict";
import { assertRetrospectiveReviewReady, retrospectiveReviewReadinessQuery, type RetrospectiveReviewReadiness } from "./retrospective-review-readiness";
import { db, pool } from "@workspace/db";

const ready: RetrospectiveReviewReadiness = {
  review_table: true, columns_ready: true, constraints_ready: true, mutation_guard: true,
};

test("review storage fails closed for every missing catalog guarantee", () => {
  assert.doesNotThrow(() => assertRetrospectiveReviewReady([ready]));
  assert.throws(() => assertRetrospectiveReviewReady([]), /not immutable/);
  for (const key of Object.keys(ready) as Array<keyof RetrospectiveReviewReadiness>) {
    assert.throws(() => assertRetrospectiveReviewReady([{ ...ready, [key]: false }]), new RegExp(key));
  }
});

test("development catalog has the review constraint and mutation guard", async () => {
  const result = await db.execute(retrospectiveReviewReadinessQuery);
  assertRetrospectiveReviewReady(result.rows as RetrospectiveReviewReadiness[]);
});

test("a review transaction fences concurrent trigger disablement through its write", async () => {
  assert.equal(process.env.NODE_ENV, "development");
  const writer = await pool.connect();
  const ddl = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("LOCK TABLE public.retrospective_weekly_reviews IN SHARE ROW EXCLUSIVE MODE");
    await ddl.query("BEGIN");
    await ddl.query("SET LOCAL lock_timeout = '500ms'");
    await assert.rejects(
      ddl.query("ALTER TABLE public.retrospective_weekly_reviews DISABLE TRIGGER retrospective_weekly_reviews_immutable"),
      (error: unknown) => (error as { code?: string }).code === "55P03",
    );
    await ddl.query("ROLLBACK");
    const guard = await writer.query(
      "SELECT tgenabled FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.retrospective_weekly_reviews'::regclass AND tgname = 'retrospective_weekly_reviews_immutable'",
    );
    assert.equal(guard.rows[0]?.tgenabled, "O");
    // This transaction represents the whole check-and-insert window. Rollback
    // leaves both the review table and the trigger unchanged.
    await writer.query(
      "INSERT INTO public.retrospective_weekly_reviews (season, week, status, reason, reviewer_id) VALUES (2026, 1, 'unavailable', 'Rollback-only lock test', 'test')",
    );
  } finally {
    await writer.query("ROLLBACK");
    await ddl.query("ROLLBACK").catch(() => {});
    writer.release();
    ddl.release();
  }
});