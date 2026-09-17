export const NFL_GAME_STATES = ["scheduled", "pregame", "live", "final", "postponed", "cancelled"] as const;
export type NflGameState = (typeof NFL_GAME_STATES)[number];

function normalizedStatus(status: string | null | undefined) {
  return (status ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function interpretNflGameState(
  game: { gameStatus: string | null | undefined; kickoffTime?: Date | null },
  now = new Date(),
): NflGameState {
  const status = normalizedStatus(game.gameStatus);
  if (status.includes("postpon")) return "postponed";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("final") || status.includes("completed") || status === "closed") return "final";
  if (status.includes("scheduled") || status.includes("pre game") || status === "status unknown") {
    return game.kickoffTime ? "pregame" : "scheduled";
  }
  if (
    status.includes("progress") ||
    status.includes("halftime") ||
    status.includes("in progress") ||
    status.includes("end of") ||
    status.includes("quarter")
  ) return "live";
  if (game.kickoffTime && game.kickoffTime.getTime() <= now.getTime()) return "live";
  return game.kickoffTime ? "pregame" : "scheduled";
}

export function authoritativeFinalRegularSeasonGame(
  game: { week: number; gameStatus: string | null | undefined; kickoffTime?: Date | null; finalHomeScore: number | null; finalAwayScore: number | null },
  now = new Date(),
) {
  return game.week >= 1 && game.week <= 18
    && interpretNflGameState(game, now) === "final"
    && game.finalHomeScore !== null
    && game.finalAwayScore !== null
    && Number.isInteger(game.finalHomeScore)
    && Number.isInteger(game.finalAwayScore);
}

export function consumerFinalScore(
  game: { gameStatus: string | null | undefined; kickoffTime?: Date | null; finalHomeScore: number | null; finalAwayScore: number | null },
  now = new Date(),
) {
  return interpretNflGameState(game, now) === "final"
    && game.finalHomeScore !== null
    && game.finalAwayScore !== null
    ? { home: game.finalHomeScore, away: game.finalAwayScore }
    : null;
}

export type TeamRecord = {
  teamId: string;
  abbreviation: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
};

export function buildTeamRecords(
  teams: Array<{ teamId: string; abbreviation: string; teamName: string }>,
  games: Array<{ homeTeamId: string; awayTeamId: string; week: number; gameStatus: string | null; kickoffTime?: Date | null; finalHomeScore: number | null; finalAwayScore: number | null }>,
  now = new Date(),
) {
  const records = new Map(teams.map((team) => [team.teamId, {
    ...team, wins: 0, losses: 0, ties: 0, games: 0,
  } satisfies TeamRecord]));
  for (const game of games) {
    if (!authoritativeFinalRegularSeasonGame(game, now)) continue;
    const home = records.get(game.homeTeamId);
    const away = records.get(game.awayTeamId);
    if (!home || !away) continue;
    home.games += 1; away.games += 1;
    if (game.finalHomeScore === game.finalAwayScore) {
      home.ties += 1; away.ties += 1;
    } else if (game.finalHomeScore! > game.finalAwayScore!) {
      home.wins += 1; away.losses += 1;
    } else {
      away.wins += 1; home.losses += 1;
    }
  }
  return [...records.values()].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

export function verifyTeamRecords(
  records: TeamRecord[],
  options: number | { expectedTeamCount?: number; targetWeek?: number; completedPriorGames?: number } = {},
) {
  const config = typeof options === "number" ? { expectedTeamCount: options } : options;
  const expectedTeamCount = config.expectedTeamCount ?? 32;
  const targetWeek = config.targetWeek;
  const completedPriorGames = config.completedPriorGames ?? records.reduce((total, record) => total + record.games, 0) / 2;
  const discrepancies = records.filter((record) => record.games !== record.wins + record.losses + record.ties)
    .map((record) => `${record.abbreviation}: game total does not match W-L-T`);
  if (records.length !== expectedTeamCount) discrepancies.push(`Expected ${expectedTeamCount} teams, found ${records.length}`);
  if (targetWeek !== undefined && targetWeek > 1 && completedPriorGames === 0) {
    discrepancies.push(`No authoritative final regular-season games are available before Week ${targetWeek}`);
  }
  if (targetWeek === 2) {
    if (completedPriorGames !== 16) discrepancies.push(`Expected 16 authoritative final Week 1 games, found ${completedPriorGames}`);
    const incorrectWeekOneCounts = records.filter((record) => record.games !== 1).map((record) =>
      `${record.abbreviation}: expected exactly 1 authoritative entering game, found ${record.games}`);
    discrepancies.push(...incorrectWeekOneCounts);
  }
  return {
    expectedTeamCount,
    actualTeamCount: records.length,
    targetWeek: targetWeek ?? null,
    completedPriorGames,
    complete: discrepancies.length === 0,
    discrepancies,
  };
}