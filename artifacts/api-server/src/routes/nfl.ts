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
  ListGamesQueryParams,
  ListGamesResponse,
  ListTeamsResponse,
} from "@workspace/api-zod";
import {
  fetchSchedule,
  fetchTeams,
  logEspnFailure,
  type EspnGame,
  type EspnTeam,
} from "../lib/espn";
import { getCurrentSeasonWeek } from "../lib/season";

const router: IRouter = Router();

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

async function saveTeams(teams: EspnTeam[]) {
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

async function saveGames(games: EspnGame[]) {
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

function fromLiveGame(game: EspnGame) {
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
    latestOdds: [],
  };
}

async function fromDbGame(game: DbGame) {
  const teams = await db.select().from(teamsTable);
  const teamMap = new Map(teams.map((team) => [team.teamId, team]));
  const homeTeam = teamMap.get(game.homeTeamId);
  const awayTeam = teamMap.get(game.awayTeamId);
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
    latestOdds: [],
  };
}

router.get("/games", async (req, res): Promise<void> => {
  const parsed = ListGamesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = getCurrentSeasonWeek();
  const season = parsed.data.season ?? current.season;
  const week = parsed.data.week ?? current.week;
  try {
    const games = await fetchSchedule(season, week);
    const teams = games.flatMap((game) => [game.homeTeam, game.awayTeam]);
    await saveTeams(teams);
    await saveGames(games);
    res.json(ListGamesResponse.parse(games.map(fromLiveGame)));
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

router.get("/teams", async (req, res): Promise<void> => {
  try {
    const teams = await fetchTeams();
    await saveTeams(teams);
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