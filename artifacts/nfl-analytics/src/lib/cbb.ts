/** Shapes written by research/cbb-model/daily.py and api-server lib/cbb-record.ts. */
export type CbbTeam = {
  id: string; name: string; short: string; abbr: string | null; logo: string | null; color: string | null;
  rank: number; preseasonRank: number; net: number; offense: number; defense: number; tempo: number;
  offenseRank: number; defenseRank: number; tempoRank: number; wins: number; losses: number;
};
export type CbbLine = {
  provider: string | null; homeSpread: number | null; homeSpreadOpen: number | null;
  total: number | null; totalOpen: number | null; homeMoneyline: number | null; awayMoneyline: number | null;
};
export type CbbSide = { id: string; rank: number; apRank: number | null };
export type CbbPickSide = { side: 'home' | 'away'; team: string; line: number; edge: number };
export type CbbGame = {
  id: string; tip: string; neutral: boolean; home: CbbSide; away: CbbSide;
  model: { homeMargin: number; total: number; homeWinProb: number; homePoints: number; awayPoints: number; possessions: number };
  line: CbbLine | null; pick: CbbPickSide | null;
};
export type CbbReport = {
  generatedAt: string; season: number; gamesPlayed: number;
  model: { pickEdge: number; marginSd: number; homeCourt: number; averageEfficiency: number; averageTempo: number };
  teams: CbbTeam[]; games: CbbGame[];
};
export type CbbTally = { wins: number; losses: number; pushes: number; units: number };
export type CbbGradedPick = CbbPickSide & {
  id: string; tip: string; home: string; away: string; postedAt: string;
  outcome: 'win' | 'loss' | 'push' | 'pending'; homePoints: number | null; awayPoints: number | null;
};
export type CbbRecord = CbbTally & { pending: number; byEdge: Array<CbbTally & { min: number; max: number | null }>; recent: CbbGradedPick[] };

/** "2026-27" for season 2027. */
export const seasonLabel = (season: number) => `${season - 1}-${String(season).slice(2)}`;

/** A spread from one team's side: −4.5, +3, PK. */
export function formatSpread(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 2) / 2;
  if (rounded === 0) return 'PK';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded) % 1 ? Math.abs(rounded).toFixed(1) : Math.abs(rounded)}`;
}

/** Our line from the home side: a home margin of +6.2 is home −6. */
export const modelHomeSpread = (game: CbbGame) => -game.model.homeMargin;

/** The team favored by a home spread, and by how much (always ≥ 0). */
export function favorite(homeSpread: number | null, game: CbbGame) {
  if (homeSpread === null) return null;
  return homeSpread <= 0 ? { team: game.home.id, points: -homeSpread } : { team: game.away.id, points: homeSpread };
}

/** Record as "12-9-1". */
export const formatRecord = (tally: CbbTally) => `${tally.wins}-${tally.losses}${tally.pushes ? `-${tally.pushes}` : ''}`;

export const winRate = (tally: CbbTally) => tally.wins + tally.losses ? tally.wins / (tally.wins + tally.losses) : null;

/** Games split into Eastern-time days, in tip order. */
export function gamesByDay(games: CbbGame[], now = new Date()) {
  const day = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  const groups = new Map<string, CbbGame[]>();
  for (const game of [...games].sort((a, b) => Date.parse(a.tip) - Date.parse(b.tip))) {
    const key = day(new Date(game.tip));
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: key === today ? 'Today' : key === tomorrow ? 'Tomorrow'
      : new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    games: list,
  }));
}
