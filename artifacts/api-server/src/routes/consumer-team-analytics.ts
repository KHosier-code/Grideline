import { and, asc, eq, gte, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, gamesTable, teamGameStatsTable, teamsTable } from "@workspace/db";
import { buildConsumerTeamAnalytics, type TeamAnalyticsWindow } from "../lib/consumer-team-analytics";
import { fetchSchedule } from "../lib/espn";
import { consumerVerifiedImages } from "../lib/verified-imagery";

const router: IRouter = Router();
const validWindows = new Set<TeamAnalyticsWindow>(["season", "last3", "last5", "last8"]);

function queryValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Non-Error value thrown";
  return error.message
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[redacted database URL]")
    .replace(/\b(password|token|secret)=\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

router.get("/consumer/team-analytics", async (req, res): Promise<void> => {
  const now = new Date();
  const seasonText = queryValue(req.query.season);
  const throughWeekText = queryValue(req.query.throughWeek);
  const windowText = queryValue(req.query.window);
  const teamsText = req.query.teams === undefined ? undefined : queryValue(req.query.teams);
  const currentSeason = now.getUTCFullYear();

  if (!seasonText || !/^\d{4}$/.test(seasonText)) {
    res.status(400).json({ error: "season must be a four-digit year." });
    return;
  }
  const season = Number(seasonText);
  if (season < 2000 || season > currentSeason) {
    res.status(400).json({ error: `season must be between 2000 and ${currentSeason}.` });
    return;
  }
  if (!throughWeekText || !/^\d+$/.test(throughWeekText)) {
    res.status(400).json({ error: "throughWeek must be an integer from 1 to 18." });
    return;
  }
  const throughWeek = Number(throughWeekText);
  if (!Number.isInteger(throughWeek) || throughWeek < 1 || throughWeek > 18) {
    res.status(400).json({ error: "throughWeek must be an integer from 1 to 18." });
    return;
  }
  if (!windowText || !validWindows.has(windowText as TeamAnalyticsWindow)) {
    res.status(400).json({ error: "window must be one of season, last3, last5, or last8." });
    return;
  }
  if (req.query.teams !== undefined && teamsText === null) {
    res.status(400).json({ error: "teams must be a comma-separated list of up to four team abbreviations." });
    return;
  }

  const requestedCodes = teamsText == null ? undefined : teamsText.split(",").map((code) => code.trim().toUpperCase());
  if (requestedCodes && (requestedCodes.length < 1 || requestedCodes.length > 4
    || requestedCodes.some((code) => !/^[A-Z0-9]{2,4}$/.test(code))
    || new Set(requestedCodes).size !== requestedCodes.length)) {
    res.status(400).json({ error: "teams must contain one to four unique team abbreviations." });
    return;
  }

  try {
    const canonicalTeams = await db.select({
      teamId: teamsTable.teamId,
      abbreviation: teamsTable.abbreviation,
      name: teamsTable.teamName,
      logoUrl: teamsTable.logoUrl,
    }).from(teamsTable);
    let selectedTeamIds: string[] | undefined;
    if (requestedCodes) {
      selectedTeamIds = [];
      for (const abbreviation of requestedCodes) {
        const matches = canonicalTeams.filter((team) => team.abbreviation.toUpperCase() === abbreviation);
        if (matches.length !== 1) {
          res.status(400).json({ error: `Unknown or ambiguous team abbreviation: ${abbreviation}.` });
          return;
        }
        selectedTeamIds.push(matches[0]!.teamId);
      }
    }

    const games = await db.select().from(gamesTable).where(and(
      eq(gamesTable.season, season),
      gte(gamesTable.week, 1),
      lte(gamesTable.week, throughWeek),
    )).orderBy(asc(gamesTable.week), asc(gamesTable.kickoffTime), asc(gamesTable.gameId));
    const stats = await db.select({
        gameId: teamGameStatsTable.gameId,
        week: teamGameStatsTable.week,
        teamId: teamGameStatsTable.teamId,
        opponentTeamId: teamGameStatsTable.opponentTeamId,
        isHome: teamGameStatsTable.isHome,
        epaPerPlay: teamGameStatsTable.epaPerPlay,
        defensiveEpaAllowedPerPlay: teamGameStatsTable.defensiveEpaAllowedPerPlay,
        offensiveSuccessRate: teamGameStatsTable.offensiveSuccessRate,
        defensiveSuccessRate: teamGameStatsTable.defensiveSuccessRate,
      }).from(teamGameStatsTable).where(and(
        eq(teamGameStatsTable.season, season),
        gte(teamGameStatsTable.week, 1),
        lte(teamGameStatsTable.week, throughWeek),
      ))

    const imagery = consumerVerifiedImages(canonicalTeams.map(team => ({
      teamId: team.teamId, abbreviation: team.abbreviation, name: team.name,
    })));
    const verifiedTeams = canonicalTeams.map(team => ({
      ...team, logoUrl: imagery?.teams.logos.get(team.teamId) ?? null,
    }));
    // Read the provider independently of persisted games. A failed or empty fixture
    // is unknown coverage, never proof that the persisted week is complete.
    const fixtureWeeks = await Promise.all(Array.from({ length: throughWeek }, async (_, index) => {
      const week = index + 1;
      try {
        const fixture = await fetchSchedule(season, week);
        return {
          week,
          games: fixture.length ? fixture.map((game) => ({
            gameId: game.gameId,
            homeTeamId: game.homeTeam.teamId,
            awayTeamId: game.awayTeam.teamId,
          })) : null,
        };
      } catch (error) {
        req.log.warn({ season, week, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Team analytics schedule fixture unavailable");
        return { week, games: null };
      }
    }));
    res.json(buildConsumerTeamAnalytics(games, stats, verifiedTeams, {
      season,
      throughWeek,
      window: windowText as TeamAnalyticsWindow,
      now,
      selectedTeamIds,
      fixtureWeeks,
    }));
  } catch (error) {
    req.log.error({
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: safeErrorMessage(error),
      season,
      throughWeek,
    }, "Consumer team analytics read failed");
    res.status(503).json({ error: "Team analytics data is unavailable", code: "consumer_data_unavailable" });
  }
});

export default router;