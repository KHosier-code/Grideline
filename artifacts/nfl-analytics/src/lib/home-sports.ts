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

/**
 * Graded picks below which a spread record says nothing about skill. Even 300
 * picks at 55% is not clear of the 52.4% break-even; this only stops a
 * handful of picks from reading like a track record.
 */
export const TOO_FEW_TO_JUDGE = 300;

/** NFL early-line record at -110, as "9-6, +2.4 units · 15 picks, too few to judge". */
export function nflRecordText(record: { wins: number; losses: number; pushes: number } | undefined) {
  const picks = record ? record.wins + record.losses + record.pushes : 0;
  if (!record || picks === 0) return 'no picks graded yet';
  const text = `${formatRecord({ ...record, units: 0 })}, ${units(record.wins - record.losses * 1.1)}`;
  return picks < TOO_FEW_TO_JUDGE ? `${text} · ${picks} ${picks === 1 ? 'pick' : 'picks'}, too few to judge` : text;
}

/** Today's three college games where we're furthest from the line, and only those. */
export function topCbbPicks(games: CbbGame[], now: number, count = 3) {
  return games
    .filter(game => game.pick && Date.parse(game.tip) > now)
    .sort((a, b) => b.pick!.edge - a.pick!.edge)
    .slice(0, count);
}

