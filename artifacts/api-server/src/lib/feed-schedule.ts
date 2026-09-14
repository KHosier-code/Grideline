export type Feed = "injuries" | "nflverse";
const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "numeric",
  day: "numeric", weekday: "short", hour: "numeric", hourCycle: "h23",
});

export function footballTime(date: Date) {
  const parts = Object.fromEntries(eastern.formatToParts(date).map(p => [p.type, p.value]));
  const month = Number(parts.month);
  return {
    month, hour: Number(parts.hour), weekday: parts.weekday,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    // January playoffs and the spring/summer updates belong to the preceding season.
    season: Number(parts.year) - (month < 8 ? 1 : 0),
    active: month >= 8 || month <= 2,
  };
}

export function latestFeedSlot(feed: Feed, now: Date, gameDates: ReadonlySet<string> = new Set()): Date {
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  // Search real instants, not local arithmetic, so DST transitions are unambiguous.
  for (let i = 0; i < 8 * 24; i++) {
    const t = footballTime(candidate);
    const due = feed === "nflverse"
      ? t.hour === 14 && (t.weekday === "Tue" || (t.active && t.weekday === "Wed"))
      : gameDates.has(t.dateKey)
        ? t.hour % 3 === 0
        : !t.active
        ? t.weekday === "Wed" && t.hour === 12
        : ["Thu", "Sat", "Sun", "Mon"].includes(t.weekday)
          ? t.hour % 3 === 0
          : t.hour === 9 || t.hour === 18;
    if (due) return candidate;
    candidate.setUTCHours(candidate.getUTCHours() - 1);
  }
  throw new Error("No feed schedule slot found");
}

export const retryDelays = [5, 15, 45].map(minutes => minutes * 60_000);
export function nextFeedUpdate(
  feed: Feed, now: Date,
  runs: { status: string; completedAt: Date | null; startedAt: Date }[],
  gameDates: ReadonlySet<string> = new Set(),
): Date | null {
  const slot = latestFeedSlot(feed, now, gameDates);
  const attempts = runs.filter(run => +run.startedAt >= +slot);
  if (attempts.some(run => run.status === "running")) return null;
  if (!attempts.length) return now;
  if (!attempts.some(run => run.status === "success") && attempts.length < 4) {
    return new Date(Math.max(+now, +(attempts[0].completedAt ?? attempts[0].startedAt) + retryDelays[attempts.length - 1]));
  }
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 8 * 24; i++) {
    next.setUTCHours(next.getUTCHours() + 1);
    if (+latestFeedSlot(feed, next, gameDates) === +next) return next;
  }
  return null;
}

export function shouldAttempt(
  attempts: { status: string; completedAt: Date | null; startedAt: Date }[],
  now: Date,
) {
  if (attempts.some(a => a.status === "success") || attempts.length >= 4) return false;
  if (!attempts.length) return true;
  const latest = attempts[0];
  return now.getTime() >= (latest.completedAt ?? latest.startedAt).getTime() + retryDelays[attempts.length - 1];
}