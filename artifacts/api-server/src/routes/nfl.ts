import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  gamesTable,
  teamsTable,
  type Game as DbGame,
} from "@workspace/db";
import {
  GetGameParams,
  GetGameResponse,
  GetOddsHistoryParams,
  GetOddsHistoryResponse,
  ListGamesQueryParams,
  ListGamesResponse,
  ListTeamsResponse,
} from "@workspace/api-zod";
import {
  fetchSchedule,
  fetchTeams,
  logEspnFailure,
  type EspnGame,
} from "../lib/espn";
import { resolveCurrentSeasonWeek } from "../lib/season";
import { getLatestOddsByGame, getOddsHistory, type OddsQuote } from "../lib/odds";
import { saveScheduleGames, saveScheduleTeams, syncEspnScheduleCoverage } from "../lib/schedule";

const router: IRouter = Router();

function fromLiveGame(game: EspnGame, latestOdds: OddsQuote[]) {
  return {
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    gameDate: game.gameDate,
    kickoffTime: game.kickoffTime,
    homeTeam: {
      abbreviation: game.homeTeam.abbreviation,
      teamName: game.homeTeam.teamName,
      logoUrl: game.homeTeam.logoUrl,
    },
    awayTeam: {
      abbreviation: game.awayTeam.abbreviation,
      teamName: game.awayTeam.teamName,
      logoUrl: game.awayTeam.logoUrl,
    },
    venue: game.venue,
    finalHomeScore: game.finalHomeScore,
    finalAwayScore: game.finalAwayScore,
    gameStatus: game.gameStatus,
    broadcast: game.broadcast,
    modelStatus: game.modelStatus,
    latestOdds,
  };
}

async function fromDbGame(game: DbGame) {
  const teams = await db.select().from(teamsTable);
  const teamMap = new Map(teams.map((team) => [team.teamId, team]));
  const homeTeam = teamMap.get(game.homeTeamId);
  const awayTeam = teamMap.get(game.awayTeamId);
  const latestOdds = (await getLatestOddsByGame([game.gameId])).get(game.gameId) ?? [];
  return {
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    gameDate: game.gameDate.toISOString(),
    kickoffTime: game.kickoffTime?.toISOString() ?? null,
    homeTeam: {
      abbreviation: homeTeam?.abbreviation ?? game.homeTeamId,
      teamName: homeTeam?.teamName ?? game.homeTeamId,
      logoUrl: homeTeam?.logoUrl ?? null,
    },
    awayTeam: {
      abbreviation: awayTeam?.abbreviation ?? game.awayTeamId,
      teamName: awayTeam?.teamName ?? game.awayTeamId,
      logoUrl: awayTeam?.logoUrl ?? null,
    },
    venue: game.stadium,
    finalHomeScore: game.finalHomeScore,
    finalAwayScore: game.finalAwayScore,
    gameStatus: game.gameStatus,
    broadcast: game.broadcast,
    modelStatus: "not_trained" as const,
    latestOdds,
  };
}

router.get("/games", async (req, res): Promise<void> => {
  const parsed = ListGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await resolveCurrentSeasonWeek();
  const season = parsed.data.season ?? current.season;
  const week = parsed.data.week ?? current.week;
  try {
    if (season === current.season && week === current.week) {
      // Keep the current view additive while also warming the next two exposed
      // weeks. The sync never touches Odds API or deletes historical games.
      await syncEspnScheduleCoverage({ season, currentWeek: week });
    }
    const games = await fetchSchedule(season, week);
    if (season !== current.season || week !== current.week) {
      await saveScheduleGames(games);
    }
    const latestOdds = await getLatestOddsByGame(games.map((game) => game.gameId));
    res.json(
      ListGamesResponse.parse(
        games.map((game) => fromLiveGame(game, latestOdds.get(game.gameId) ?? [])),
      ),
    );
  } catch (error) {
    logEspnFailure(error);
    req.log.error({ error, season, week }, "Unable to fetch live NFL schedule");
    const stored = await db
      .select()
      .from(gamesTable)
      .where(and(eq(gamesTable.season, season), eq(gamesTable.week, week)));
    if (stored.length > 0) {
      res.json(ListGamesResponse.parse(await Promise.all(stored.map(fromDbGame))));
      return;
    }
    res.status(503).json({ error: "NFL schedule is temporarily unavailable." });
  }
});

router.get("/games/:gameId", async (req, res): Promise<void> => {
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.gameId, params.data.gameId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(GetGameResponse.parse(await fromDbGame(game)));
});

router.get("/games/:gameId/odds-history", async (req, res): Promise<void> => {
  const params = GetOddsHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [game] = await db
    .select({ gameId: gamesTable.gameId })
    .from(gamesTable)
    .where(eq(gamesTable.gameId, params.data.gameId))
    .limit(1);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(GetOddsHistoryResponse.parse(await getOddsHistory(game.gameId)));
});

router.get("/teams", async (req, res): Promise<void> => {
  try {
    const teams = await fetchTeams();
    await saveScheduleTeams(teams);
    res.json(ListTeamsResponse.parse(teams));
  } catch (error) {
    logEspnFailure(error);
    req.log.error({ error }, "Unable to fetch live NFL teams");
    const teams = await db.select().from(teamsTable);
    if (teams.length === 0) {
      res.status(503).json({ error: "NFL team data is temporarily unavailable." });
      return;
    }
    res.json(ListTeamsResponse.parse(teams));
  }
});

export default router;