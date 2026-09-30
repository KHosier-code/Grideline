/**
 * NFL slates, the way fans and bettors group a week: Thursday night, Sunday
 * early (London and the 1:00 PM ET window), Sunday afternoon (4:05 PM ET on,
 * including Sunday night), Monday night, and any other day by name. Slates
 * follow Eastern time, the league's schedule clock, so a game lands in the
 * same slate for every viewer.
 */
export type Slate = { key: string; label: string; date: string; short: string };

const SUNDAY_LATE_FROM_MINUTES = 14 * 60 + 30; // 2:30 PM ET splits 1:00 from 4:05/4:25

const easternParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    weekday: get('weekday'), date: `${get('month')} ${get('day')}`, day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
};

export function slateFor(kickoff: string | null | undefined): Slate {
  const date = kickoff ? new Date(kickoff) : null;
  if (!date || Number.isNaN(date.getTime())) return { key: 'tba', label: 'Time to be announced', date: '', short: 'TBA' };
  const et = easternParts(date);
  if (et.weekday === 'Sunday') {
    return et.minutes < SUNDAY_LATE_FROM_MINUTES
      ? { key: `${et.day}-early`, label: 'Sunday early', date: et.date, short: 'Sun early' }
      : { key: `${et.day}-late`, label: 'Sunday afternoon', date: et.date, short: 'Sun afternoon' };
  }
  return { key: et.day, label: et.weekday, date: et.date, short: et.weekday.slice(0, 3) };
}

/** Groups items into slates in kickoff order; items keep their order within a slate. */
export function groupBySlate<T>(items: T[], kickoff: (item: T) => string | null | undefined) {
  const groups = new Map<string, { slate: Slate; first: number; items: T[] }>();
  for (const item of items) {
    const slate = slateFor(kickoff(item));
    const time = Date.parse(kickoff(item) ?? '') || Number.MAX_SAFE_INTEGER;
    const group = groups.get(slate.key) ?? { slate, first: time, items: [] };
    group.first = Math.min(group.first, time);
    group.items.push(item);
    groups.set(slate.key, group);
  }
  return [...groups.values()].sort((a, b) => a.first - b.first);
}
