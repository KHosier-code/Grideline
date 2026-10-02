import type { ConsumerGame } from '@workspace/api-client-react';
import { normalizeTeam } from './parlay';
import type { DefenseLine, UsageReport } from './usage-report';

/**
 * Favorable/tough matchup calls from the weekly defense-vs-position report.
 * Rank 1 allows the most PPR points to the position, so the top quarter of
 * the league (ranks 1-8) is a favorable matchup and the bottom quarter
 * (25-32) a tough one. Everything between is neutral.
 */
export type Position = 'QB' | 'RB' | 'WR' | 'TE';
export const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];
export type MatchupTone = 'favorable' | 'tough' | 'neutral';

export function matchupTone(rank: number | null | undefined, teams = 32): MatchupTone | null {
  if (rank === null || rank === undefined || !Number.isFinite(rank)) return null;
  const quarter = Math.round(teams / 4);
  if (rank <= quarter) return 'favorable';
  if (rank > teams - quarter) return 'tough';
  return 'neutral';
}

export const TONE_LABEL: Record<MatchupTone, string> = { favorable: 'Favorable', tough: 'Tough', neutral: 'Neutral' };

/** What `defense` allows to `position`, matching ESPN and nflverse team codes. */
export function defenseLine(report: UsageReport, defense: string, position: Position, win: 'season' | 'last4' = 'season'): DefenseLine | null {
  const code = normalizeTeam(defense);
  const row = report.defenses.find(item => normalizeTeam(item.team) === code);
  return row?.[win][position] ?? null;
}

export type NextGame = { gameId: string; week: number; opponent: string; home: boolean; kickoffTime: string };

/** Each team's next game that hasn't kicked off, keyed by nflverse team code. */
export function nextGames(games: ConsumerGame[], now: number) {
  const upcoming = games
    .filter(game => game.kickoffTime && Date.parse(game.kickoffTime) > now && !game.finalScore)
    .sort((a, b) => Date.parse(a.kickoffTime!) - Date.parse(b.kickoffTime!));
  const next = new Map<string, NextGame>();
  for (const game of upcoming) {
    const home = game.matchup.home.abbreviation;
    const away = game.matchup.away.abbreviation;
    for (const [team, opponent, isHome] of [[home, away, true], [away, home, false]] as const) {
      const key = normalizeTeam(team);
      if (!next.has(key)) next.set(key, { gameId: game.gameId, week: game.week, opponent, home: isHome, kickoffTime: game.kickoffTime! });
    }
  }
  return next;
}

/** A player's next-game matchup against the defense they face, or null when unknown. */
export function playerMatchup(report: UsageReport, next: Map<string, NextGame>, team: string, position: Position) {
  const game = next.get(normalizeTeam(team));
  if (!game) return null;
  const line = defenseLine(report, game.opponent, position);
  return { game, line, tone: matchupTone(line?.pprRank) };
}
