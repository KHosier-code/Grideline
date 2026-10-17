const TEAM_ALIASES: Record<string, string> = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX' };

/** ESPN and nflverse write a few teams differently (LAR/LA, WSH/WAS, JAC/JAX); compare on one code. */
export const normalizeTeam = (team: string) => TEAM_ALIASES[team.toUpperCase()] ?? team.toUpperCase();
