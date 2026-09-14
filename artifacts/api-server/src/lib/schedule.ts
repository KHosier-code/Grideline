import { and, desc, eq, sql } from "drizzle-orm";
import {
  dataSyncRunsTable,
  db,
  gamesTable,
  teamsTable,
} from "@workspace/db";
import {
  fetchCurrentSeasonWeek,
  fetchSchedule,
  logEspnFailure,
  type EspnGame,
  type EspnTeam,
} from "./espn";
import { logger } from "./logger";

/**
 * The UI and API intentionally expose weeks 1-22 (18 regular-season weeks
 * followed by four postseason slots).  Future coverage must not manufacture a
 * week beyond that public bound when ESPN reports a later postseason round.
 */
export const MAX_EXPOSED_NFL_WEEK = 22;
export const FUTURE_SCHEDULE_WEEKS = 2;
export const SCHEDULE_TIMEZONE = "America/New_York";

export function getExposedScheduleWeeks(
  currentWeek: number,
  futureWeeks = FUTURE_SCHEDULE_WEEKS,
): number[] {
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > MAX_EXPOSED_NFL_WEEK) {
    return [];
  }
  const count = Math.max(0, Math.floor(futureWeeks));
  return Array.from({ length: count + 1 }, (_, index) => currentWeek + index)
    .filter((week) => week <= MAX_EXPOSED_NFL_WEEK);
}

function toDbTeam(team: EspnTeam) {
  return {
    teamId: team.teamId,
    abbreviation: team.abbreviation,
    teamName: team.teamName,
    conference: team.conference,
    division: team.division,
    logoUrl: team.logoUrl,
    sourceUpdatedAt: new Date(),
  };
}

export async function saveScheduleTeams(teams: EspnTeam[]) {
  for (const team of teams) {
    await db
      .insert(teamsTable)
      .values(toDbTeam(team))
      .onConflictDoUpdate({
        target: teamsTable.teamId,
        set: {
          abbreviation: team.abbreviation,
          teamName: team.teamName,
          conference: team.conference,
          division: team.division,
          logoUrl: team.logoUrl,
          sourceUpdatedAt: new Date(),
        },
      });
  }
}

export async function saveScheduleGames(games: EspnGame[]) {
  await saveScheduleTeams(games.flatMap((game) => [game.homeTeam, game.awayTeam]));
  for (const game of games) {
    await db
      .insert(gamesTable)
      .values({
        gameId: game.gameId,
        season: game.season,
        week: game.week,
        gameDate: new Date(game.gameDate),
        kickoffTime: game.kickoffTime ? new Date(game.kickoffTime) : null,
        homeTeamId: game.homeTeam.teamId,
        awayTeamId: game.awayTeam.teamId,
        stadium: game.venue,
        finalHomeScore: game.finalHomeScore,
        finalAwayScore: game.finalAwayScore,
        gameStatus: game.gameStatus,
        broadcast: game.broadcast,
        sourceUpdatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: gamesTable.gameId,
        set: {
          season: game.season,
          week: game.week,
          gameDate: new Date(game.gameDate),
          kickoffTime: game.kickoffTime ? new Date(game.kickoffTime) : null,
          homeTeamId: game.homeTeam.teamId,
          awayTeamId: game.awayTeam.teamId,
          stadium: game.venue,
          finalHomeScore: game.finalHomeScore,
          finalAwayScore: game.finalAwayScore,
          gameStatus: game.gameStatus,
          broadcast: game.broadcast,
          sourceUpdatedAt: new Date(),
        },
      });
  }
}

async function beginRun(jobKey?: string, scheduledFor?: Date) {
  const [run] = await db
    .insert(dataSyncRunsTable)
    .values({
      provider: "espn-schedule",
      status: "running",
      jobKey: jobKey ?? null,
      scheduledFor: scheduledFor ?? null,
    })
    .returning({ id: dataSyncRunsTable.id });
  return run.id;
}

async function finishRun(
  runId: number,
  status: "success" | "partial" | "failed",
  recordsProcessed: number,
  errorMessage: string | null,
) {
  await db
    .update(dataSyncRunsTable)
    .set({ status, recordsProcessed, errorMessage, completedAt: new Date() })
    .where(eq(dataSyncRunsTable.id, runId));
}

/**
 * Persist the current exposed week plus up to two future exposed weeks. This
 * function only upserts provider observations; it never deletes old games.
 */
export async function syncEspnScheduleCoverage(input?: {
  season?: number;
  currentWeek?: number;
  jobKey?: string;
  scheduledFor?: Date;
}) {
  const runId = await beginRun(input?.jobKey, input?.scheduledFor);
  try {
    const current = input?.season !== undefined && input.currentWeek !== undefined
      ? { season: input.season, week: input.currentWeek }
      : await fetchCurrentSeasonWeek();
    const weeks = await getCoverageWeeks(current.season, current.week);
    const gamesByWeek: Record<string, number> = {};
    const failures: string[] = [];
    let totalGames = 0;

    for (const week of weeks) {
      try {
        const games = await fetchSchedule(current.season, week);
        await saveScheduleGames(games);
        gamesByWeek[String(week)] = games.length;
        totalGames += games.length;
      } catch (error) {
        logEspnFailure(error);
        const message = `Week ${week}: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(message);
        logger.warn({ error, season: current.season, week }, "ESPN schedule coverage sync failed");
      }
    }

    const status = failures.length === 0 ? "success" : totalGames > 0 ? "partial" : "failed";
    await finishRun(runId, status, totalGames, failures.length > 0 ? failures.join("; ").slice(0, 8_000) : null);
    return {
      status,
      season: current.season,
      currentWeek: current.week,
      weeks,
      gamesByWeek,
      totalGames,
      failures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, "failed", 0, message);
    throw error;
  }
}

/**
 * Keep the current and next two weeks warm, but also retain a previous week
 * while ESPN still reports an unfinished game. This is what lets a delayed
 * game or a late score transition through finals without asking the caller to
 * manually pick an old week.
 */
async function getCoverageWeeks(season: number, currentWeek: number) {
  const weeks = getExposedScheduleWeeks(currentWeek);
  if (currentWeek <= 1) return weeks;
  const unfinished = await db
    .select({ week: gamesTable.week })
    .from(gamesTable)
    .where(and(
      eq(gamesTable.season, season),
      eq(gamesTable.week, currentWeek - 1),
      sql`lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%'`,
    ))
  if (unfinished.length > 0) {
    return [...new Set([...unfinished.map((item) => item.week), ...weeks])]
      .filter((week) => week >= 1 && week <= MAX_EXPOSED_NFL_WEEK)
      .sort((left, right) => left - right);
  }
  return weeks;
}

export async function getScheduleHealth() {
  const [summary] = await db
    .select({
      games: sql<number>`count(*)::int`,
      latestUpdated: sql<Date | null>`max(${gamesTable.sourceUpdatedAt})`,
      unfinished: sql<number>`count(*) filter (where lower(${gamesTable.gameStatus}) not like '%final%' and lower(${gamesTable.gameStatus}) not like '%completed%' and lower(${gamesTable.gameStatus}) not like '%postponed%')::int`,
    })
    .from(gamesTable);
  const runs = await db
    .select()
    .from(dataSyncRunsTable)
    .where(eq(dataSyncRunsTable.provider, "espn-schedule"))
    .orderBy(desc(dataSyncRunsTable.startedAt), desc(dataSyncRunsTable.id))
    .limit(10);
  const latest = runs[0];
  return {
    records: summary?.games ?? 0,
    unfinished: summary?.unfinished ?? 0,
    lastUpdated: summary?.latestUpdated ? new Date(summary.latestUpdated).toISOString() : null,
    latestRun: latest
      ? {
          id: latest.id,
          status: latest.status,
          startedAt: latest.startedAt.toISOString(),
          completedAt: latest.completedAt?.toISOString() ?? null,
          recordsProcessed: latest.recordsProcessed,
          errorMessage: latest.errorMessage,
        }
      : null,
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      recordsProcessed: run.recordsProcessed,
      errorMessage: run.errorMessage,
    })),
  };
}