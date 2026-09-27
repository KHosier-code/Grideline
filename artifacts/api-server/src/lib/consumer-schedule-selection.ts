import { interpretNflGameState } from "./game-state";

export type ScheduleSelectionGame = {
  season: number;
  week: number;
  kickoffTime: Date | null;
  gameStatus: string;
};

export type ScheduleSlateSummary = {
  season: number;
  week: number;
  first: Date;
  last: Date;
  live: boolean;
  upcoming: boolean;
  pastEligible: boolean;
};

/** Select from persisted kickoffs, not the calendar's guess at an NFL week. */
export function selectConsumerSlate(games: ScheduleSelectionGame[], now: Date) {
  const dated = games.filter((game) => game.kickoffTime !== null && Number.isFinite(game.kickoffTime.getTime()));
  if (!dated.length) return { selection: null, reason: "no_schedule" as const };
  const bySlate = new Map<string, ScheduleSelectionGame[]>();
  for (const game of dated) {
    const key = `${game.season}:${game.week}`;
    bySlate.set(key, [...(bySlate.get(key) ?? []), game]);
  }
  const slates = [...bySlate.values()].map((rows) => ({
    season: rows[0].season,
    week: rows[0].week,
    first: new Date(Math.min(...rows.map((row) => row.kickoffTime!.getTime()))),
    last: new Date(Math.max(...rows.map((row) => row.kickoffTime!.getTime()))),
    live: rows.some((row) => interpretNflGameState(row, now) === "live"
      && row.kickoffTime!.getTime() <= now.getTime()
      && now.getTime() - row.kickoffTime!.getTime() <= 8 * 60 * 60_000),
    upcoming: rows.some((row) => row.kickoffTime!.getTime() > now.getTime()
      && ["scheduled", "pregame"].includes(interpretNflGameState(row, now))),
    pastEligible: rows.some((row) => row.kickoffTime!.getTime() <= now.getTime()
      && ["scheduled", "pregame", "live", "final"].includes(interpretNflGameState(row, now))),
  }));
  return selectConsumerSlateSummaries(slates, now);
}

/** The database can send one summary per slate instead of every historical game. */
export function selectConsumerSlateSummaries(slates: ScheduleSlateSummary[], now: Date) {
  const valid = slates.filter((slate) => Number.isFinite(slate.first.getTime()) && Number.isFinite(slate.last.getTime()));
  if (!valid.length) return { selection: null, reason: "no_schedule" as const };
  const live = valid.filter((slate) => slate.live).sort((a, b) => b.first.getTime() - a.first.getTime())[0];
  const upcoming = valid.filter((slate) => slate.upcoming).sort((a, b) => a.first.getTime() - b.first.getTime())[0];
  // An unavailable future slate is neither upcoming nor "past".
  const latest = valid.filter((slate) => slate.last.getTime() <= now.getTime() && slate.pastEligible)
    .sort((a, b) => b.last.getTime() - a.last.getTime())[0];
  const chosen = live ?? upcoming ?? latest;
  if (!chosen) return { selection: null, reason: "no_schedule" as const };
  return {
    selection: { season: chosen.season, week: chosen.week },
    reason: live ? "live" as const : upcoming ? "upcoming" as const : "past" as const,
  };
}