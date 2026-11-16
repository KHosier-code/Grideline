import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import * as zod from "zod/v4";
import { db, weeklyReportsTable } from "@workspace/db";
import { createRateLimiter } from "../lib/newsletter";
import { addVisit, visitDay, VISIT_EVENTS, VISIT_SOURCES, type VisitCounts } from "../lib/visit-counts";

const router: IRouter = Router();

const visitSchema = zod.object({
  page: zod.string().max(200),
  first: zod.boolean().optional(),
  returning: zod.boolean().optional(),
  source: zod.enum(VISIT_SOURCES).optional(),
  event: zod.enum(VISIT_EVENTS).optional(),
  detail: zod.string().max(40).optional(),
});

// Generous for a person clicking around, low enough that a script can't swamp the counts.
const visitLimiter = createRateLimiter(240, 60 * 60_000);

/** The row holding one day's counts: kind "visits", stamped at noon UTC on that Eastern day. */
function dayRow(day: string) {
  return { kind: "visits", season: Number(day.slice(0, 4)), week: 0, generatedAt: new Date(`${day}T12:00:00Z`) };
}

/**
 * Counts a page view or product event (lib/visit-counts.ts). Always answers
 * 204 so counting can never get in a visitor's way.
 */
router.post("/visit", async (req, res): Promise<void> => {
  res.status(204).end();
  const parsed = visitSchema.safeParse(req.body);
  const ip = String(req.headers["x-forwarded-for"] ?? req.ip ?? "").split(",")[0].trim() || "unknown";
  if (!parsed.success || !visitLimiter(ip)) return;
  const row = dayRow(visitDay());
  const where = and(eq(weeklyReportsTable.kind, row.kind), eq(weeklyReportsTable.season, row.season),
    eq(weeklyReportsTable.generatedAt, row.generatedAt));
  try {
    await db.transaction(async (tx) => {
      await tx.insert(weeklyReportsTable).values({ ...row, payload: {} }).onConflictDoNothing();
      const [current] = await tx.select({ payload: weeklyReportsTable.payload }).from(weeklyReportsTable)
        .where(where).for("update");
      const payload = addVisit((current?.payload ?? {}) as VisitCounts, parsed.data);
      await tx.update(weeklyReportsTable).set({ payload: payload as Record<string, unknown> }).where(where);
    });
  } catch (error) {
    req.log.warn({ error }, "Visit count failed");
  }
});

function ingestAuthorized(req: import("express").Request) {
  const expected = process.env.GRIDLINE_INGEST_TOKEN ?? process.env.TD_PICKS_INGEST_TOKEN;
  const header = req.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || expected.length < 24 || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/** The last N days of counts, newest first, for the daily check job. */
router.get("/ops/visits", async (req, res): Promise<void> => {
  if (!ingestAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  try {
    const rows = await db.select({ generatedAt: weeklyReportsTable.generatedAt, payload: weeklyReportsTable.payload })
      .from(weeklyReportsTable).where(eq(weeklyReportsTable.kind, "visits"))
      .orderBy(desc(weeklyReportsTable.generatedAt)).limit(days);
    res.set("Cache-Control", "no-store");
    res.json({ days: rows.map((row) => ({ day: row.generatedAt.toISOString().slice(0, 10), ...(row.payload as VisitCounts) })) });
  } catch (error) {
    req.log.error({ error }, "Visit counts read failed");
    res.status(503).json({ error: "Database unavailable" });
  }
});

export default router;
