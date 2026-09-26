export const RED_ZONE_VALUES = [20, 10, 5] as const;
export type RedZone = typeof RED_ZONE_VALUES[number];

export type RedZonePlay = {
  gameId: string;
  sourceGameId: string;
  season: number;
  week: number;
  seasonType: string;
  playId: string;
  teamId: string;
  opponentTeamId: string;
  yardline100: number | null;
  passAttempt: boolean;
  rushAttempt: boolean;
  receiverId: string | null;
  rusherId: string | null;
  receiverName?: string | null;
  rusherName?: string | null;
  noPlay: boolean;
  twoPointAttempt: boolean;
  kneel: boolean;
  spike: boolean;
  passTouchdown: boolean;
  rushTouchdown: boolean;
};

export type RedZonePlayerFact = {
  gameId: string;
  sourceGameId: string;
  season: number;
  week: number;
  seasonType: string;
  playerId: string;
  playerName: string | null;
  teamId: string;
  opponentTeamId: string;
  zone: RedZone;
  targets: number;
  carries: number;
  receivingTouchdowns: number;
  rushingTouchdowns: number;
};

export type RedZoneTeamFact = {
  gameId: string;
  sourceGameId: string;
  season: number;
  week: number;
  seasonType: string;
  teamId: string;
  opponentTeamId: string;
  zone: RedZone;
  targets: number;
  carries: number;
};

/** Deterministic PBP definition. Denominators include qualifying credited
 * attempts only; an attempt without receiver/rusher ID is deliberately omitted. */
export function deriveRedZoneGameFacts(plays: RedZonePlay[]) {
  const byPlay = new Map<string, RedZonePlay>();
  for (const play of plays) {
    const key = `${play.sourceGameId}:${play.playId}`;
    if (!play.playId || !byPlay.has(key)) byPlay.set(key, play);
  }
  const players = new Map<string, RedZonePlayerFact>();
  const teams = new Map<string, RedZoneTeamFact>();
  const valid = [...byPlay.values()].filter((play) =>
    play.seasonType.toUpperCase() === "REG"
    && play.yardline100 !== null
    && !play.noPlay
    && !play.twoPointAttempt
    && !play.kneel
    && !play.spike);
  for (const play of valid) {
    for (const zone of RED_ZONE_VALUES) {
      const key = `${play.gameId}:${play.teamId}:${zone}`;
      if (!teams.has(key)) teams.set(key, {
        gameId: play.gameId, sourceGameId: play.sourceGameId, season: play.season,
        week: play.week, seasonType: "REG", teamId: play.teamId,
        opponentTeamId: play.opponentTeamId, zone, targets: 0, carries: 0,
      });
    }
  }
  const ensurePlayer = (play: RedZonePlay, playerId: string, name: string | null, zone: RedZone) => {
    const key = `${play.gameId}:${play.teamId}:${playerId}:${zone}`;
    let fact = players.get(key);
    if (!fact) {
      fact = {
        gameId: play.gameId, sourceGameId: play.sourceGameId, season: play.season, week: play.week,
        seasonType: "REG", playerId, playerName: name, teamId: play.teamId,
        opponentTeamId: play.opponentTeamId, zone, targets: 0, carries: 0,
        receivingTouchdowns: 0, rushingTouchdowns: 0,
      };
      players.set(key, fact);
    } else if (!fact.playerName && name) fact.playerName = name;
    return fact;
  };
  for (const play of valid) {
    const receiverAttempt = play.passAttempt && Boolean(play.receiverId);
    const rusherAttempt = play.rushAttempt && Boolean(play.rusherId);
    if (receiverAttempt || rusherAttempt) {
      for (const zone of RED_ZONE_VALUES) {
        if (receiverAttempt) ensurePlayer(play, play.receiverId!, play.receiverName ?? null, zone);
        if (rusherAttempt) ensurePlayer(play, play.rusherId!, play.rusherName ?? null, zone);
      }
    }
    for (const zone of RED_ZONE_VALUES) {
      if (play.yardline100! > zone) continue;
      const teamKey = `${play.gameId}:${play.teamId}:${zone}`;
      const team = teams.get(teamKey)!;
      if (!receiverAttempt && !rusherAttempt) continue;
      if (receiverAttempt) {
        team.targets += 1;
        const player = ensurePlayer(play, play.receiverId!, play.receiverName ?? null, zone);
        player.targets += 1;
        if (play.passTouchdown) player.receivingTouchdowns += 1;
      }
      if (rusherAttempt) {
        team.carries += 1;
        const player = ensurePlayer(play, play.rusherId!, play.rusherName ?? null, zone);
        player.carries += 1;
        if (play.rushTouchdown) player.rushingTouchdowns += 1;
      }
    }
  }
  return { players: [...players.values()], teams: [...teams.values()], deduplicatedPlayCount: byPlay.size };
}

/** An empty replacement set is never allowed to reach the transactional delete path. */
export function redZoneReplacementGameIds(teamFacts: Array<{ gameId: string }>) {
  const gameIds = [...new Set(teamFacts.map((fact) => fact.gameId))];
  if (!gameIds.length) throw new Error("No usable team denominator facts to replace");
  return gameIds;
}

export function redZoneShare(value: number | null, denominator: number | null | undefined) {
  return value !== null && denominator !== null && denominator !== undefined && denominator > 0
    ? value / denominator : null;
}

/** An all-null weekly-stat row is an identity placeholder, not evidence of an appearance. */
export function hasPlayerStatAppearance(stats: {
  completions?: number | null;
  attempts?: number | null;
  passingYards?: number | null;
  passingTds?: number | null;
  carries?: number | null;
  rushingYards?: number | null;
  rushingTds?: number | null;
  targets?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTds?: number | null;
}) {
  return [
    stats.completions, stats.attempts, stats.passingYards, stats.passingTds,
    stats.carries, stats.rushingYards, stats.rushingTds, stats.targets,
    stats.receptions, stats.receivingYards, stats.receivingTds,
  ].some((value) => value !== null && value !== undefined && Number.isFinite(value));
}

export function redZonePlayerFactForAppearance<
  T extends {
    gameId: string; teamId: string; zone: number;
    targets: number; carries: number; receivingTouchdowns: number; rushingTouchdowns: number;
  },
>(
  facts: T[],
  appearance: { gameId: string; teamId: string },
  zone: number,
  verifiedPositiveOffenseSnap: boolean,
  hasTeamDenominator: boolean,
) {
  const existing = facts.find((fact) =>
    fact.gameId === appearance.gameId && fact.teamId === appearance.teamId && fact.zone === zone);
  if (existing) return existing;
  if (!verifiedPositiveOffenseSnap || !hasTeamDenominator) return undefined;
  return {
    gameId: appearance.gameId,
    teamId: appearance.teamId,
    zone,
    targets: 0,
    carries: 0,
    receivingTouchdowns: 0,
    rushingTouchdowns: 0,
  };
}

export type RedZoneAppearance = { playerId: string; gameId: string; kickoffTime: Date; week: number };

export function cutoffSafeRedZoneGames<T extends {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date | null;
  gameStatus: string;
}>(games: T[], season: number, cutoff: Date, excludedGameId?: string) {
  return games.filter((game) =>
    game.season === season
    && game.week <= 18
    && game.gameStatus === "STATUS_FINAL"
    && game.kickoffTime !== null
    && game.kickoffTime < cutoff
    && game.gameId !== excludedGameId)
    .sort((a, b) => a.kickoffTime!.getTime() - b.kickoffTime!.getTime()
      || a.gameId.localeCompare(b.gameId));
}

/** Selects each player's last three completed appearances (not team games). */
export function selectLastThreeAppearances<T extends RedZoneAppearance>(appearances: T[]) {
  const grouped = new Map<string, T[]>();
  for (const appearance of appearances) {
    grouped.set(appearance.playerId, [...(grouped.get(appearance.playerId) ?? []), appearance]);
  }
  return new Map([...grouped].map(([playerId, rows]) => [
    playerId,
    [...rows].sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime()
      || a.gameId.localeCompare(b.gameId)).slice(-3).map((row) => row.gameId),
  ]));
}

/** Select each player's window across teams first, then partition each included
 * appearance by the team recorded for that specific game. */
export function groupRedZoneAppearancesByPlayerTeam<
  T extends RedZoneAppearance & { teamId: string },
>(
  appearances: T[],
  period: "season" | "last3",
  teamFilter?: string,
) {
  const lastThree = period === "last3" ? selectLastThreeAppearances(appearances) : null;
  const grouped = new Map<string, T[]>();
  for (const appearance of appearances) {
    if (teamFilter && appearance.teamId !== teamFilter) continue;
    if (lastThree && !lastThree.get(appearance.playerId)?.includes(appearance.gameId)) continue;
    const key = `${appearance.playerId}:${appearance.teamId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), appearance]);
  }
  return [...grouped].map(([key, rows]) => ({
    key,
    playerId: rows[0]!.playerId,
    teamId: rows[0]!.teamId,
    appearances: [...rows].sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime()
      || a.gameId.localeCompare(b.gameId)),
  }));
}