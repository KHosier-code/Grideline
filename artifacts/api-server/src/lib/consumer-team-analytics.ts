import { authoritativeFinalRegularSeasonGame } from "./game-state";
import { NFLVERSE_TEAM_ALIASES, nflverseTeamCandidates } from "./personnel-context-derivation";

export type TeamAnalyticsWindow = "season" | "last3" | "last5" | "last8";

export type TeamAnalyticsGame = {
  gameId: string;
  week: number;
  kickoffTime: Date | null;
  gameStatus: string;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  homeTeamId: string;
  awayTeamId: string;
};

export type TeamAnalyticsStat = {
  gameId: string;
  week: number;
  teamId: string;
  opponentTeamId: string;
  isHome: boolean;
  epaPerPlay: number | null;
  defensiveEpaAllowedPerPlay: number | null;
  offensiveSuccessRate: number | null;
  defensiveSuccessRate: number | null;
};

export type TeamAnalyticsTeam = {
  teamId: string;
  abbreviation: string;
  name: string;
  logoUrl: string | null;
};

export type TeamAnalyticsOptions = {
  season: number;
  throughWeek: number;
  window: TeamAnalyticsWindow;
  now: Date;
  selectedTeamIds?: string[];
  fixtureWeeks?: Array<{
    week: number;
    games: Array<{ gameId: string; homeTeamId: string; awayTeamId: string }> | null;
  }>;
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function canonicalizeTeamAnalyticsStats(
  stats: TeamAnalyticsStat[],
  games: TeamAnalyticsGame[],
  teams: TeamAnalyticsTeam[],
  now: Date,
): { stats: TeamAnalyticsStat[]; unmatchedStatsByWeek: Map<number, number> } {
  const sourceToTeamIds = new Map<string, Set<string>>();
  const addMapping = (sourceId: string, teamId: string) => {
    const normalized = sourceId.trim().toUpperCase();
    if (!normalized) return;
    const matching = sourceToTeamIds.get(normalized) ?? new Set<string>();
    matching.add(teamId);
    sourceToTeamIds.set(normalized, matching);
  };
  for (const team of teams) {
    addMapping(team.teamId, team.teamId);
    addMapping(team.abbreviation, team.teamId);
    const stableSourceAbbreviation = NFLVERSE_TEAM_ALIASES[team.abbreviation.trim().toUpperCase()]
      ?? team.abbreviation;
    for (const sourceId of new Set([
      ...nflverseTeamCandidates(team.abbreviation),
      ...nflverseTeamCandidates(stableSourceAbbreviation),
    ])) addMapping(sourceId, team.teamId);
  }

  const finalGames = games.filter((game) =>
    authoritativeFinalRegularSeasonGame(game, now)
    && game.kickoffTime !== null
    && game.kickoffTime.getTime() <= now.getTime());
  const canonicalStats = new Map<string, TeamAnalyticsStat>();
  const unmatchedStatsByWeek = new Map<number, number>();
  for (const stat of stats) {
    const canonicalSourceId = (sourceId: string) => {
      const matches = sourceToTeamIds.get(sourceId.trim().toUpperCase());
      if (!matches?.size) {
        throw new Error(`Cannot map persisted team-game stat team_id '${sourceId}' to a canonical team.`);
      }
      if (matches.size !== 1) {
        throw new Error(`Persisted team-game stat team_id '${sourceId}' maps to multiple canonical teams.`);
      }
      return [...matches][0]!;
    };
    const teamId = canonicalSourceId(stat.teamId);
    const opponentTeamId = canonicalSourceId(stat.opponentTeamId);
    const sameMatchupGames = games.filter((game) => game.week === stat.week
      && ((game.homeTeamId === teamId && game.awayTeamId === opponentTeamId)
        || (game.awayTeamId === teamId && game.homeTeamId === opponentTeamId)));
    if (!sameMatchupGames.length) {
      unmatchedStatsByWeek.set(stat.week, (unmatchedStatsByWeek.get(stat.week) ?? 0) + 1);
      continue;
    }
    const matches = sameMatchupGames.filter((game) =>
      (stat.isHome && game.homeTeamId === teamId && game.awayTeamId === opponentTeamId)
      || (!stat.isHome && game.awayTeamId === teamId && game.homeTeamId === opponentTeamId));
    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? `Persisted team-game stat ${stat.gameId} ambiguously matches ${matches.length} scheduled games.`
          : `Persisted team-game stat ${stat.gameId} does not match a scheduled game by week, teams, and home/away orientation.`,
      );
    }
    const game = matches[0]!;
    if (!finalGames.some((finalGame) => finalGame.gameId === game.gameId)) continue;
    const key = `${game.gameId}\0${teamId}`;
    if (canonicalStats.has(key)) {
      throw new Error(`Multiple persisted team-game stat rows map to ${teamId} for game ${game.gameId}.`);
    }
    canonicalStats.set(key, {
      ...stat,
      gameId: game.gameId,
      teamId,
      opponentTeamId,
    });
  }
  return {
    stats: [...canonicalStats.values()],
    unmatchedStatsByWeek,
  };
}

/**
 * Construct analytics only from already-persisted schedule/stat records.
 * Team EPA summaries are unweighted means of per-game values, not play-weighted
 * aggregates; sample counts report games with a non-null persisted EPA value.
 */
export function buildConsumerTeamAnalytics(
  games: TeamAnalyticsGame[],
  stats: TeamAnalyticsStat[],
  teams: TeamAnalyticsTeam[],
  options: TeamAnalyticsOptions,
) {
  const { season, throughWeek, window, now } = options;
  const schedule = games.filter((game) => game.week >= 1 && game.week <= throughWeek);
  const gamesByWeek = new Map<number, TeamAnalyticsGame[]>();
  for (const game of schedule) {
    gamesByWeek.set(game.week, [...(gamesByWeek.get(game.week) ?? []), game]);
  }

  const { stats: canonicalStats, unmatchedStatsByWeek } = canonicalizeTeamAnalyticsStats(
    stats,
    schedule,
    teams,
    now,
  );
  const statsByGameAndTeam = new Map<string, TeamAnalyticsStat>();
  for (const stat of canonicalStats) statsByGameAndTeam.set(`${stat.gameId}\0${stat.teamId}`, stat);

  const fixturesByWeek = new Map(options.fixtureWeeks?.map((entry) => [entry.week, entry.games]) ?? []);
  const weeks = [...gamesByWeek.entries()].sort(([a], [b]) => a - b).map(([week, weekGames]) => {
    const fixture = fixturesByWeek.get(week);
    const missingMatchups = fixture?.filter((expected) => !weekGames.some((game) =>
      game.gameId === expected.gameId
      && game.homeTeamId === expected.homeTeamId
      && game.awayTeamId === expected.awayTeamId,
    )).map((game) => `${game.awayTeamId} at ${game.homeTeamId} (${game.gameId})`) ?? [];
    const finalGames = weekGames.filter((game) =>
      authoritativeFinalRegularSeasonGame(game, now)
      && game.kickoffTime !== null
      && game.kickoffTime.getTime() <= now.getTime());
    const statGames = finalGames.filter((game) =>
      statsByGameAndTeam.has(`${game.gameId}\0${game.homeTeamId}`)
      && statsByGameAndTeam.has(`${game.gameId}\0${game.awayTeamId}`));
    return {
      week,
      finalGames,
      scheduledGames: weekGames.length,
      statGames: statGames.length,
      expectedGames: fixture?.length ?? null,
      missingMatchups,
      fixtureVerified: !!fixture?.length,
      complete: !!fixture?.length && missingMatchups.length === 0
        && weekGames.length === fixture.length && finalGames.length === weekGames.length,
    };
  });

  const partialReasons: string[] = [];
  for (const week of weeks) {
    if (!week.fixtureVerified) {
      partialReasons.push(`Week ${week.week} has no verifiable provider schedule fixture; schedule completeness cannot be confirmed.`);
    } else if (week.missingMatchups.length) {
      partialReasons.push(`Week ${week.week} is missing ${week.missingMatchups.length} provider schedule matchup(s): ${week.missingMatchups.join(", ")}.`);
    } else if (week.scheduledGames !== week.expectedGames) {
      partialReasons.push(`Week ${week.week} has ${week.scheduledGames} persisted games but ${week.expectedGames} provider schedule games.`);
    }
    if (!week.complete) {
      partialReasons.push(
        `Week ${week.week} is not final-complete (${week.finalGames.length} of ${week.scheduledGames} games final before now).`,
      );
    }
    if (week.finalGames.length > week.statGames) {
      partialReasons.push(
        `Week ${week.week} has paired persisted team stats for ${week.statGames} of ${week.finalGames.length} final games.`,
      );
    }
  }
  if (!schedule.length) {
    partialReasons.push(
      `No regular-season schedule games are available for season ${season} through week ${throughWeek}.`,
    );
  }
  for (let week = 1; week <= throughWeek; week++) {
    if (gamesByWeek.has(week)) continue;
    const fixture = fixturesByWeek.get(week);
    if (fixture?.length) {
      partialReasons.push(`Week ${week} is missing all ${fixture.length} provider schedule matchups.`);
    } else if (schedule.some((game) => game.week > week)) {
      partialReasons.push(`Week ${week} has no persisted games and no verifiable provider schedule fixture.`);
    }
  }
  for (const [week, rowCount] of [...unmatchedStatsByWeek.entries()].sort(([a], [b]) => a - b)) {
    partialReasons.push(
      `Excluded ${rowCount} persisted team-game stat rows from week ${week} because no matching schedule matchup is available.`,
    );
  }

  const completeWeeks = [];
  for (let week = 1; week <= throughWeek; week++) {
    const entry = weeks.find((item) => item.week === week);
    if (!entry?.complete) break;
    completeWeeks.push(entry);
  }
  const requestedCount = window === "season" ? Number.POSITIVE_INFINITY : Number(window.slice(4));
  // Window size is measured in each team's games, not league weeks: bye weeks
  // must not silently shorten a last-N sample.
  const selectedWeekNumbers = new Set(completeWeeks.map((week) => week.week));
  const selectedGames = schedule.filter((game) =>
    selectedWeekNumbers.has(game.week)
    && authoritativeFinalRegularSeasonGame(game, now)
    && game.kickoffTime !== null
    && game.kickoffTime.getTime() <= now.getTime());
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const selectedTeamIds = options.selectedTeamIds
    ? new Set(options.selectedTeamIds)
    : new Set(teams.map((team) => team.teamId));
  const statFor = (gameId: string, teamId: string) => statsByGameAndTeam.get(`${gameId}\0${teamId}`);

  const outputTeams = teams
    .filter((team) => selectedTeamIds.has(team.teamId))
    .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation))
    .map((team) => {
      const teamGames = selectedGames
        .filter((game) => game.homeTeamId === team.teamId || game.awayTeamId === team.teamId)
        .sort((a, b) => a.week - b.week
          || (a.kickoffTime?.getTime() ?? 0) - (b.kickoffTime?.getTime() ?? 0)
          || a.gameId.localeCompare(b.gameId));
      const selectedTeamGames = window === "season"
        ? teamGames
        : teamGames.slice(-requestedCount);
      const observations = selectedTeamGames
        .map((game) => {
          const opponentId = game.homeTeamId === team.teamId ? game.awayTeamId : game.homeTeamId;
          const stat = statFor(game.gameId, team.teamId);
          return {
            gameId: game.gameId,
            week: game.week,
            kickoffTime: game.kickoffTime,
            opponent: teamById.get(opponentId)?.abbreviation ?? opponentId,
            offenseEpa: finite(stat?.epaPerPlay),
            defenseEpa: finite(stat?.defensiveEpaAllowedPerPlay),
            offenseSuccessRate: finite(stat?.offensiveSuccessRate),
            defenseSuccessRate: finite(stat?.defensiveSuccessRate),
          };
        });
      const offenseValues = observations.map((observation) => observation.offenseEpa);
      const defenseValues = observations.map((observation) => observation.defenseEpa);
      return {
        teamId: team.teamId,
        abbreviation: team.abbreviation,
        name: team.name,
        logoUrl: team.logoUrl,
        offenseEpa: mean(offenseValues),
        defenseEpa: mean(defenseValues),
        offenseSamples: offenseValues.filter((value) => value !== null).length,
        defenseSamples: defenseValues.filter((value) => value !== null).length,
        selectedGames: observations.length,
        observations,
      };
    });

  return {
    season,
    throughWeek,
    window,
    source: "persisted team_game_stats; per-game EPA is averaged equally (not play-weighted); offense uses epa_per_play, defense uses defensive_epa_allowed_per_play",
    coverage: {
      weeks: weeks.map(({ week, scheduledGames, finalGames, statGames, complete, expectedGames, missingMatchups, fixtureVerified }) => ({
        week, scheduledGames, expectedGames, missingMatchups, fixtureVerified,
        finalGames: finalGames.length, statGames, allFinal: complete,
      })),
      partialReasons,
    },
    teams: outputTeams,
  };
}