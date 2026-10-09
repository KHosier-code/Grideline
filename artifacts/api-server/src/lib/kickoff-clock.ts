import { and, desc, eq, gte, lte, isNotNull } from "drizzle-orm";
import { db, gamesTable, oddsApiRequestsTable, touchdownPickRunsTable } from "@workspace/db";
import { syncEspnInjuries } from "./availability";
import { withFeedLock } from "./feed-lock";
import { logger } from "./logger";
import { captureOddsSnapshots, getOddsSchedulingBalance, oddsCaptureQuotaDecision } from "./odds";
import { syncEspnScheduleCoverage } from "./schedule";
import { syncNwsWeather } from "./weather";

/**
 * The site's own clock for work that has to happen before kickoff.
 *
 * GitHub's scheduled workflows are best-effort: on Sunday Oct 4 the "10:30 AM"
 * picks refresh ran at 4:32 PM and the pre-game odds captures ran hours late.
 * The API process is always on, so it keys these jobs to the actual kickoff
 * times in the games table instead. The GitHub crons stay as backups; the
 * routes they call skip work this clock already did.
 *
 *   odds      one capture 40 min before each distinct kickoff
 *   weather   kickoff forecasts 80 min before each distinct kickoff
 *   injuries  the injury report 80 min before (inactives come out ~90 min before)
 *   picks     re-run the "Weekly picks" workflow 75 min before each kickoff window
 *   scores    every 15 min from kickoff until 4 hours after
 */
const MINUTE = 60_000;
const TICK_MS = MINUTE;
/** Kickoffs closer together than this share one picks refresh (4:05 and 4:25). */
const WINDOW_GAP_MS = 60 * MINUTE;
/** A capture this recent satisfies the clock's own pre-kickoff odds task. */
export const ODDS_CLOCK_RECENT_MS = 15 * MINUTE;
/** A capture this recent makes a (possibly hours-late) GitHub odds run a no-op. */
export const ODDS_BACKUP_RECENT_MS = 120 * MINUTE;
/** A TD pick run this recent means the workflow already ran for this window. */
const PICKS_RECENT_MS = 3 * 60 * MINUTE;

export type ClockTask =
  | { kind: "odds" | "weather" | "injuries"; key: string; kickoff: Date }
  | { kind: "picks"; key: string; kickoff: Date }
  | { kind: "scores"; key: string };

const within = (now: number, start: number, end: number) => now >= start && now < end;

/** Distinct kickoffs, grouped into windows that start within an hour of each other. */
export function kickoffWindows(kickoffs: Date[]) {
  const times = [...new Set(kickoffs.map((kickoff) => kickoff.getTime()))].sort((a, b) => a - b);
  const windows: number[][] = [];
  for (const time of times) {
    const current = windows.at(-1);
    if (current && time - current[current.length - 1] < WINDOW_GAP_MS) current.push(time);
    else windows.push([time]);
  }
  return windows;
}

/**
 * The tasks due at `now`, minus those already in `done`. Each task has a
 * stable key, so a tick that runs every minute fires each one once.
 */
export function dueClockTasks(now: Date, kickoffs: Date[], done: ReadonlySet<string>): ClockTask[] {
  const t = now.getTime();
  const tasks: ClockTask[] = [];
  const times = [...new Set(kickoffs.map((kickoff) => kickoff.getTime()))].sort((a, b) => a - b);
  for (const time of times) {
    const kickoff = new Date(time);
    const stamp = kickoff.toISOString();
    if (within(t, time - 40 * MINUTE, time - 15 * MINUTE)) tasks.push({ kind: "odds", key: `odds:${stamp}`, kickoff });
    if (within(t, time - 80 * MINUTE, time - 30 * MINUTE)) {
      tasks.push({ kind: "weather", key: `weather:${stamp}`, kickoff });
      tasks.push({ kind: "injuries", key: `injuries:${stamp}`, kickoff });
    }
  }
  for (const window of kickoffWindows(kickoffs)) {
    const first = window[0];
    if (within(t, first - 75 * MINUTE, first - 45 * MINUTE)) {
      tasks.push({ kind: "picks", key: `picks:${new Date(first).toISOString()}`, kickoff: new Date(first) });
    }
  }
  if (times.some((time) => within(t, time, time + 4 * 60 * MINUTE))) {
    const slot = new Date(Math.floor(t / (15 * MINUTE)) * 15 * MINUTE);
    tasks.push({ kind: "scores", key: `scores:${slot.toISOString()}` });
  }
  return tasks.filter((task) => !done.has(task.key));
}

/** The latest successful Odds API capture, if it happened within `withinMs`. */
export async function recentOddsCapture(withinMs: number, now = new Date()) {
  const [row] = await db.select({ requestedAt: oddsApiRequestsTable.requestedAt }).from(oddsApiRequestsTable)
    .where(and(eq(oddsApiRequestsTable.status, "success"), gte(oddsApiRequestsTable.requestedAt, new Date(now.getTime() - withinMs))))
    .orderBy(desc(oddsApiRequestsTable.requestedAt)).limit(1);
  return row?.requestedAt ?? null;
}

/**
 * Starts the "Weekly picks" GitHub workflow. Needs GITHUB_DISPATCH_TOKEN, a
 * fine-grained token for this repository with "Actions: Read and write".
 * workflow_dispatch runs start within a minute or so, unlike scheduled runs.
 */
async function dispatchWeeklyPicks(): Promise<string> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return "skipped: GITHUB_DISPATCH_TOKEN is not set";
  const repo = process.env.GRIDLINE_GITHUB_REPO || "KHosier-code/Grideline";
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/weekly-picks.yml/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gridline-kickoff-clock",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return "dispatched";
}

async function runTask(task: ClockTask, now: Date): Promise<string> {
  switch (task.kind) {
    case "odds": {
      const recent = await recentOddsCapture(ODDS_CLOCK_RECENT_MS, now);
      if (recent) return `skipped: captured at ${recent.toISOString()}`;
      const quota = oddsCaptureQuotaDecision(await getOddsSchedulingBalance());
      if (!quota.safe) return `skipped: ${quota.reason}`;
      const result = await captureOddsSnapshots({ jobKey: "kickoff-clock-odds", scheduledFor: new Date(task.kickoff.getTime() - 40 * MINUTE) });
      return `${result.status}: ${result.snapshotsCreated ?? 0} snapshots, ${result.creditsRemaining ?? "?"} credits left`;
    }
    case "weather": {
      const result = await withFeedLock("weather", () => syncNwsWeather({ jobKey: "kickoff-clock-weather" }));
      return result ? `${result.status}: ${result.inserted} forecasts` : "skipped: weather sync already running";
    }
    case "injuries": {
      const result = await withFeedLock("injuries", () => syncEspnInjuries({ jobKey: "kickoff-clock-injuries" }));
      return result ? "done" : "skipped: injury sync already running";
    }
    case "scores": {
      const result = await syncEspnScheduleCoverage({ jobKey: "kickoff-clock-scores" });
      return result.status;
    }
    case "picks": {
      const [latest] = await db.select({ generatedAt: touchdownPickRunsTable.generatedAt }).from(touchdownPickRunsTable)
        .orderBy(desc(touchdownPickRunsTable.generatedAt)).limit(1);
      if (latest && now.getTime() - latest.generatedAt.getTime() < PICKS_RECENT_MS) {
        return `skipped: picks published at ${latest.generatedAt.toISOString()}`;
      }
      return dispatchWeeklyPicks();
    }
  }
}

/** On in production; off in development (NODE_ENV=development) unless GRIDLINE_KICKOFF_CLOCK=on. */
export function kickoffClockEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const setting = environment.GRIDLINE_KICKOFF_CLOCK?.trim().toLowerCase();
  if (setting === "off") return false;
  if (setting === "on") return true;
  return environment.NODE_ENV !== "development" && environment.NODE_ENV !== "test";
}

let timer: NodeJS.Timeout | null = null;

export function startKickoffClock() {
  if (timer || !kickoffClockEnabled()) return;
  const done = new Set<string>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const now = new Date();
    try {
      const games = await db.select({ kickoff: gamesTable.kickoffTime }).from(gamesTable).where(and(
        isNotNull(gamesTable.kickoffTime),
        gte(gamesTable.kickoffTime, new Date(now.getTime() - 4 * 60 * MINUTE)),
        lte(gamesTable.kickoffTime, new Date(now.getTime() + 2 * 60 * MINUTE)),
      ));
      const tasks = dueClockTasks(now, games.map((game) => game.kickoff!), done);
      for (const task of tasks) {
        // Marked first: a failing task is logged once, not retried every minute.
        done.add(task.key);
        try {
          logger.info({ task: task.key, outcome: await runTask(task, now) }, "Kickoff clock task");
        } catch (error) {
          logger.warn({ task: task.key, error: error instanceof Error ? error.message : String(error) }, "Kickoff clock task failed");
        }
      }
      if (done.size > 500) for (const key of [...done].slice(0, 250)) done.delete(key);
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Kickoff clock tick failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  logger.info("Kickoff clock started");
}
