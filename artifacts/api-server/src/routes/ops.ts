import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import {
  dataSyncRunsTable, db, gameProjectionRunsTable, gamesTable, oddsApiRequestsTable, touchdownPickRunsTable, weeklyReportsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import { kickoffClockEnabled, kickoffClockRunning, recentClockLog, upcomingClockPlan } from "../lib/kickoff-clock";

/**
 * The Ops dashboard (/admin/ops): one read of everything that keeps the site
 * current, so a stale feed or a quiet workflow is visible at a glance.
 */
const router: IRouter = Router();

const FEEDS = [
  { feed: "Scores", provider: "espn-schedule", staleHours: 26 },
  { feed: "Injuries", provider: "espn-injuries", staleHours: 26 },
  { feed: "Weather", provider: "nws-weather", staleHours: 13 },
  { feed: "Player stats", provider: "nflverse", staleHours: 8 * 24 },
] as const;
const REPORT_KINDS = ["usage", "replay", "share-td", "share-clip", "td-props"] as const;

type WorkflowRun = { name: string; status: string; conclusion: string | null; event: string; createdAt: string; url: string };
let workflowCache: { at: number; runs: WorkflowRun[] | null; error: string | null } | null = null;

/** Recent GitHub Actions runs, when GITHUB_DISPATCH_TOKEN can read them. Cached a minute. */
async function workflowRuns() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { runs: null, error: "Add GITHUB_DISPATCH_TOKEN to see workflow runs here." };
  if (workflowCache && Date.now() - workflowCache.at < 60_000) return workflowCache;
  const repo = process.env.GRIDLINE_GITHUB_REPO || "KHosier-code/Grideline";
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=12`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gridline-ops" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const body = (await response.json()) as { workflow_runs?: Array<Record<string, unknown>> };
    const runs = (body.workflow_runs ?? []).map((run) => ({
      name: String(run.name ?? ""), status: String(run.status ?? ""), conclusion: (run.conclusion as string | null) ?? null,
      event: String(run.event ?? ""), createdAt: String(run.created_at ?? ""), url: String(run.html_url ?? ""),
    }));
    workflowCache = { at: Date.now(), runs, error: null };
  } catch (error) {
    workflowCache = { at: Date.now(), runs: null, error: error instanceof Error ? error.message : String(error) };
  }
  return workflowCache;
}

router.get("/admin/ops", requireAdmin, async (req, res): Promise<void> => {
  const now = new Date();
  try {
    const [feeds, odds, oddsWeek, tdRun, gameRun, reports, kickoffs, github] = await Promise.all([
      Promise.all(FEEDS.map(async ({ feed, provider, staleHours }) => {
        const [latest] = await db.select({ completedAt: dataSyncRunsTable.completedAt }).from(dataSyncRunsTable)
          .where(and(eq(dataSyncRunsTable.provider, provider), inArray(dataSyncRunsTable.status, ["success", "partial"]), isNotNull(dataSyncRunsTable.completedAt)))
          .orderBy(desc(dataSyncRunsTable.completedAt)).limit(1);
        const at = latest?.completedAt ?? null;
        return { feed, at: at?.toISOString() ?? null, stale: !at || now.getTime() - at.getTime() > staleHours * 3_600_000 };
      })),
      db.select({ requestedAt: oddsApiRequestsTable.requestedAt, creditsRemaining: oddsApiRequestsTable.creditsRemaining })
        .from(oddsApiRequestsTable).where(and(eq(oddsApiRequestsTable.status, "success")))
        .orderBy(desc(oddsApiRequestsTable.requestedAt)).limit(1),
      db.select({ creditsUsed: oddsApiRequestsTable.creditsUsed }).from(oddsApiRequestsTable)
        .where(gte(oddsApiRequestsTable.requestedAt, new Date(now.getTime() - 7 * 86_400_000))),
      db.select({ season: touchdownPickRunsTable.season, week: touchdownPickRunsTable.week, generatedAt: touchdownPickRunsTable.generatedAt })
        .from(touchdownPickRunsTable).orderBy(desc(touchdownPickRunsTable.generatedAt)).limit(1),
      db.select({ season: gameProjectionRunsTable.season, week: gameProjectionRunsTable.week, generatedAt: gameProjectionRunsTable.generatedAt })
        .from(gameProjectionRunsTable).orderBy(desc(gameProjectionRunsTable.generatedAt)).limit(1),
      Promise.all(REPORT_KINDS.map(async (kind) => {
        const [latest] = await db.select({ week: weeklyReportsTable.week, generatedAt: weeklyReportsTable.generatedAt })
          .from(weeklyReportsTable).where(eq(weeklyReportsTable.kind, kind)).orderBy(desc(weeklyReportsTable.generatedAt)).limit(1);
        return { kind, week: latest?.week ?? null, at: latest?.generatedAt.toISOString() ?? null };
      })),
      db.select({ kickoff: gamesTable.kickoffTime }).from(gamesTable).where(and(isNotNull(gamesTable.kickoffTime),
        gte(gamesTable.kickoffTime, now), lte(gamesTable.kickoffTime, new Date(now.getTime() + 8 * 86_400_000)))),
      workflowRuns(),
    ]);
    const [latestCredits] = await db.select({ creditsRemaining: oddsApiRequestsTable.creditsRemaining, requestedAt: oddsApiRequestsTable.requestedAt })
      .from(oddsApiRequestsTable).where(isNotNull(oddsApiRequestsTable.creditsRemaining))
      .orderBy(desc(oddsApiRequestsTable.requestedAt)).limit(1);
    const kickoffTimes = kickoffs.map((row) => row.kickoff!).sort((a, b) => a.getTime() - b.getTime());
    res.set("Cache-Control", "no-store").json({
      generatedAt: now.toISOString(),
      clock: {
        enabled: kickoffClockEnabled(), running: kickoffClockRunning(),
        dispatchConfigured: Boolean(process.env.GITHUB_DISPATCH_TOKEN),
        nextKickoff: kickoffTimes[0]?.toISOString() ?? null,
        plan: upcomingClockPlan(now, kickoffTimes, 14),
        log: recentClockLog().slice(0, 20),
      },
      odds: {
        lastCapture: odds[0]?.requestedAt.toISOString() ?? null,
        creditsRemaining: latestCredits?.creditsRemaining ?? null,
        creditsAsOf: latestCredits?.requestedAt.toISOString() ?? null,
        creditsUsedLast7Days: oddsWeek.reduce((sum, row) => sum + (row.creditsUsed ?? 0), 0),
      },
      feeds,
      picks: {
        touchdowns: tdRun[0] ? { season: tdRun[0].season, week: tdRun[0].week, at: tdRun[0].generatedAt.toISOString() } : null,
        games: gameRun[0] ? { season: gameRun[0].season, week: gameRun[0].week, at: gameRun[0].generatedAt.toISOString() } : null,
      },
      reports,
      github,
    });
  } catch (error) {
    req.log.error({ error }, "Ops dashboard read failed");
    res.status(503).json({ error: "Ops data unavailable" });
  }
});

export default router;
