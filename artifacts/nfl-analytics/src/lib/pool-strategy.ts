/**
 * Pool helpers for the Pick'em page: contrarian options for big confidence
 * pools and a survivor-pool planner. Both work from win chances only; we have
 * no data on what other players in a pool pick, so neither guesses at it.
 */
import { homeWinChance } from './sim';

export type PoolPick = {
  gameId: string;
  /** Team we pick and its win chance (0.5 to 1). */
  team: string;
  opponent: string;
  chance: number;
  points: number;
  /** Whether Gridline's model leans the other way. */
  modelDisagrees: boolean;
  locked: boolean;
};

/** Expected confidence points for a sheet. */
export const expectedPoints = (picks: PoolPick[]) => picks.reduce((sum, pick) => sum + pick.points * pick.chance, 0);

/**
 * In a big pool, the favorite-on-every-game sheet looks like everyone else's,
 * so it rarely wins outright. Flipping a close game makes the sheet different
 * for the least expected cost: points x (2p - 1). Games where our model already
 * leans to the underdog come first, then the cheapest flips.
 */
export function contrarianOptions(picks: PoolPick[], limit = 3, maxChance = 0.65) {
  return picks
    .filter(pick => !pick.locked && pick.chance < maxChance)
    .map(pick => ({ ...pick, upset: pick.opponent, upsetChance: 1 - pick.chance, cost: pick.points * (2 * pick.chance - 1) }))
    .sort((a, b) => Number(b.modelDisagrees) - Number(a.modelDisagrees) || a.cost - b.cost)
    .slice(0, limit);
}

/** Typical NFL home-field edge, in points, for games more than a week out. */
export const HOME_FIELD = 1.5;

export type FutureGame = { week: number; home: string; away: string };

/**
 * Win chance for a future game from power ratings (each team's margin against
 * an average team), used only to look ahead for survivor pools. This week's
 * chances come from the betting line instead.
 */
export function ratingWinChance(ratings: Map<string, number>, game: FutureGame, team: string) {
  const home = ratings.get(game.home);
  const away = ratings.get(game.away);
  if (home === undefined || away === undefined) return null;
  const homeChance = homeWinChance(home - away + HOME_FIELD);
  return team === game.home ? homeChance : team === game.away ? 1 - homeChance : null;
}

export type SurvivorOption = {
  team: string;
  opponent: string;
  chance: number;
  /** This team's best look-ahead week, when it's a better spot than this week. */
  bestLater: { week: number; opponent: string; chance: number } | null;
};

/**
 * Survivor pool: every unused team playing this week, most likely winner
 * first, with the team's best later week so you can save a team for a better
 * spot. `thisWeek` holds each game's teams and the home win chance.
 */
export function survivorOptions(
  thisWeek: Array<{ home: string; away: string; homeWin: number; locked: boolean }>,
  future: FutureGame[],
  ratings: Map<string, number>,
  used: Set<string>,
): SurvivorOption[] {
  const options: SurvivorOption[] = [];
  for (const game of thisWeek) {
    if (game.locked) continue;
    for (const [team, opponent, chance] of [[game.home, game.away, game.homeWin], [game.away, game.home, 1 - game.homeWin]] as const) {
      if (used.has(team)) continue;
      let bestLater: SurvivorOption['bestLater'] = null;
      for (const later of future) {
        if (later.home !== team && later.away !== team) continue;
        const laterChance = ratingWinChance(ratings, later, team);
        if (laterChance === null || laterChance <= chance) continue;
        if (!bestLater || laterChance > bestLater.chance) {
          bestLater = { week: later.week, opponent: later.home === team ? later.away : later.home, chance: laterChance };
        }
      }
      options.push({ team, opponent, chance, bestLater });
    }
  }
  return options.sort((a, b) => b.chance - a.chance);
}
