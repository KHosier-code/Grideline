import { formatRecord, type CbbGame } from './cbb.ts';

const easternDay = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
export const units = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} units`;

/**
 * "First tip 6:30 PM ET" on a game day: the next start today, Eastern time.
 * Nothing on days without games, so the card never points at next week.
 */
export function nextStart(times: string[], now: number, noun: 'kickoff' | 'tip') {
  const today = easternDay(now);
  const todays = times.filter(time => Number.isFinite(Date.parse(time)) && easternDay(Date.parse(time)) === today)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const next = todays.find(time => Date.parse(time) > now);
  if (!next) return null;
  const first = Date.parse(todays[0]) > now;
  return `${first ? 'First' : 'Next'} ${noun} ${clock(next)} ET`;
}

/** NFL early-line record at -110, as "9-6, +2.4 units". */
export function nflRecordText(record: { wins: number; losses: number; pushes: number } | undefined) {
  if (!record || record.wins + record.losses + record.pushes === 0) return 'no picks graded yet';
  return `${formatRecord({ ...record, units: 0 })}, ${units(record.wins - record.losses * 1.1)}`;
}

/**
 * The college games to feature: the day's official card when it's set (the
 * record's `official` ids), otherwise the biggest 2-6 point disagreements, the
 * same window the card uses. Upcoming games only, at most `count`.
 */
export function topCbbPicks(games: CbbGame[], now: number, count = 3, official: ReadonlySet<string> = new Set()) {
  const upcoming = games.filter(game => game.pick && Date.parse(game.tip) > now);
  const card = upcoming.filter(game => official.has(game.id));
  const pool = card.length ? card : upcoming.filter(game => game.pick!.edge >= 2 && game.pick!.edge < 6);
  return pool.sort((a, b) => b.pick!.edge - a.pick!.edge).slice(0, count);
}
