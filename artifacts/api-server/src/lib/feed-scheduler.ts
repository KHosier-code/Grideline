import { and, desc, eq, gte } from "drizzle-orm";
import { db, pool, dataSyncRunsTable } from "@workspace/db";
import { syncEspnInjuries } from "./availability";
import { syncNflverseHistory } from "./nflverse";
import { syncNwsWeather } from "./weather";
import { footballTime, latestFeedSlot, shouldAttempt, type Feed } from "./feed-schedule";
import { logger } from "./logger";
import { getFeedGameDays } from "./feed-game-days";

// Session locks prevent duplicate jobs across API replicas. Manual syncs share them.
export async function withFeedLock<T>(feed: Feed, work: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  const key = feed === "injuries" ? 731401 : feed === "nflverse" ? 731402 : 731403;
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [key]);
    locked = result.rows[0].locked;
    if (!locked) return null;
    return await work();
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch (error) {
        client.release(true);
        throw error;
      }
    }
    client.release();
  }
}

export async function runScheduledFeed(feed: Feed, now = new Date()) {
  return withFeedLock(feed, async () => {
    const provider = `scheduled:${feed}`;
    // Owning the lock means any previous running scheduled attempt was interrupted.
    await db.update(dataSyncRunsTable).set({
      status: "failed", completedAt: now,
      errorMessage: "Scheduled attempt interrupted before completion; bounded retry policy applies.",
    }).where(and(eq(dataSyncRunsTable.provider, provider), eq(dataSyncRunsTable.status, "running")));
    const slot = latestFeedSlot(feed, now, feed === "injuries" ? await getFeedGameDays(now) : undefined);
    const attempts = await db.select().from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, provider), gte(dataSyncRunsTable.startedAt, slot)))
      .orderBy(desc(dataSyncRunsTable.startedAt));
    if (!shouldAttempt(attempts, now)) return;
    const attempt = attempts.length + 1;
    const [run] = await db.insert(dataSyncRunsTable)
      .values({ provider, status: "running", startedAt: now }).returning();
    logger.info({ feed, slot, attempt }, "Scheduled feed attempt started");
    try {
      const result = feed === "injuries"
        ? await syncEspnInjuries()
        : feed === "weather"
          ? await syncNwsWeather({ jobKey: provider, scheduledFor: now })
          : await syncNflverseHistory([footballTime(now).season], { refresh: true });
      if ("status" in result && result.status !== "success") {
        throw new Error(`Source returned ${result.status}: ${"failures" in result ? result.failures.join("; ") : ""}`);
      }
      await db.update(dataSyncRunsTable).set({
        status: "success", completedAt: new Date(),
        recordsProcessed: "recordsProcessed" in result ? result.recordsProcessed : result.inserted,
      }).where(eq(dataSyncRunsTable.id, run.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(dataSyncRunsTable).set({
        status: "failed", completedAt: new Date(),
        errorMessage: `Attempt ${attempt}/4${attempt === 4 ? " (retries exhausted; next scheduled slot will try again)" : ""}: ${message}`.slice(0, 8000),
      }).where(eq(dataSyncRunsTable.id, run.id));
      logger.error({ feed, attempt, error }, "Scheduled feed attempt failed");
    }
  });
}

export function startFeedScheduler() {
  const busy = new Set<Feed>();
  const tick = async () => {
    // Independent feeds: a large history import must not delay injury reports.
    await Promise.allSettled((["injuries", "nflverse", "weather"] as const).map(async feed => {
      if (busy.has(feed)) return;
      busy.add(feed);
      try { await runScheduledFeed(feed); }
      catch (error) { logger.error({ feed, error }, "Feed scheduler tick failed"); }
      finally { busy.delete(feed); }
    }));
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 60_000);
  timer.unref();
  logger.info("Automatic feed scheduler started (America/New_York)");
  return () => clearInterval(timer);
}