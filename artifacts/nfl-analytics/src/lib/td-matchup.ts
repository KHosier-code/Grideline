import type { MatchupTone } from './dvp-matchups';

/**
 * Favorable / Neutral / Tough for an anytime-TD pick.
 *
 * Half the score is the Vegas team total (how many points the team is
 * expected to score, ranked against the rest of this week's board) and half
 * is the defense: touchdowns, yards and red-zone looks it allows to the
 * position, red-zone trips and red-zone TD rate it allows, and EPA it allows
 * to the play type (runs for RBs and QBs, passes for WRs and TEs). Each part
 * is 0 (hardest) to 1 (easiest).
 *
 * In 2022-2026 testing, defense stats alone barely separated scorers
 * (favorable 19.8% vs tough 18.2%; touchdowns allowed alone, 19.1% vs
 * 18.2%). The Vegas total does most of the work (22.7% vs 14.4%); the blend
 * keeps that while still describing the defense (23.3% vs 15.0%).
 */
export type DefenseRanks = {
  /** Defense vs position, rank 1 = allows the most. */
  tdsRank?: number | null;
  yardsRank?: number | null;
  redZoneOppsRank?: number | null;
  /** Red-zone defense, rank 1 = allows the fewest. */
  allowedTripsPerGameRank?: number | null;
  allowedTdRateRank?: number | null;
  /** Matchup report, rank 1 = best defense (allows the least EPA). */
  epaRank?: number | null;
};

const ease = (rank: number | null | undefined, mostIsEasy: boolean, teams = 32) =>
  rank == null || !Number.isFinite(rank) ? null : mostIsEasy ? (teams - rank) / (teams - 1) : (rank - 1) / (teams - 1);

/** 0 (hardest) to 1 (easiest) from whichever defense ranks are known, or null when none are. */
export function defenseEase(ranks: DefenseRanks) {
  const parts = [
    ease(ranks.tdsRank, true), ease(ranks.yardsRank, true), ease(ranks.redZoneOppsRank, true),
    ease(ranks.allowedTripsPerGameRank, false), ease(ranks.allowedTdRateRank, false), ease(ranks.epaRank, false),
  ].filter((value): value is number => value !== null);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null;
}

/** Share of `values` at or below `value` (0 to 1). */
function percentile(value: number, values: number[]) {
  if (values.length <= 1) return 0.5;
  const below = values.filter(item => item < value).length;
  const equal = values.filter(item => item === value).length;
  return (below + (equal - 1) / 2) / (values.length - 1);
}

export type TdMatchupInput = { key: string; position: string; implied: number | null; defense: DefenseRanks };

/**
 * Tags every player on the board. Scores are compared within each position,
 * so the top quarter of this week's RBs is favorable and the bottom quarter
 * tough, the same cut the testing used.
 */
export function tdMatchupTones(players: TdMatchupInput[]) {
  const implied = players.map(player => player.implied).filter((value): value is number => value !== null && Number.isFinite(value));
  const scored = players.map(player => {
    const defense = defenseEase(player.defense);
    const vegas = player.implied !== null && Number.isFinite(player.implied) ? percentile(player.implied, implied) : null;
    const parts = [vegas, defense].filter((value): value is number => value !== null);
    return { player, vegas, defense, score: parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null };
  });
  const tones = new Map<string, { tone: MatchupTone; vegas: number | null; defense: number | null }>();
  for (const position of new Set(players.map(player => player.position))) {
    const group = scored.filter(item => item.player.position === position && item.score !== null);
    const scores = group.map(item => item.score!);
    for (const item of group) {
      const rank = percentile(item.score!, scores);
      tones.set(item.player.key, { tone: rank >= 0.75 ? 'favorable' : rank <= 0.25 ? 'tough' : 'neutral', vegas: item.vegas, defense: item.defense });
    }
  }
  return tones;
}
