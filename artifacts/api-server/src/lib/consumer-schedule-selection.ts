import { interpretNflGameState } from "./game-state";

export type ScheduleSelectionGame = {
  season: number;
  week: number;
  kickoffTime: Date | null;
  gameStatus: string;
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
    first: Math.min(...rows.map((row) => row.kickoffTime!.getTime())),
    last: Math.max(...rows.map((row) => row.kickoffTime!.getTime())),
    live: rows.some((row) => interpretNflGameState(row, now) === "live"
      && row.kickoffTime!.getTime() <= now.getTime()
      && now.getTime() - row.kickoffTime!.getTime() <= 8 * 60 * 60_000),
    upcoming: rows.some((row) => row.kickoffTime!.getTime() > now.getTime()
      && ["scheduled", "pregame"].includes(interpretNflGameState(row, now))),
  }));
  const live = slates.filter((slate) => slate.live).sort((a, b) => b.first - a.first)[0];
  const upcoming = slates.filter((slate) => slate.upcoming).sort((a, b) => a.first - b.first)[0];
  const latest = [...slates].sort((a, b) => b.last - a.last)[0];
  const chosen = live ?? upcoming ?? latest;
  return {
    selection: { season: chosen.season, week: chosen.week },
    reason: live ? "live" as const : upcoming ? "upcoming" as const : "past" as const,
  };
}