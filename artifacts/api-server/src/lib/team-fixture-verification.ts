import type { EspnGame } from "./espn";
import { fetchSchedule } from "./espn";
import { logger } from "./logger";

export type VerifiedFixtureWeek = {
  week: number;
  games: Array<{ gameId: string; homeTeamId: string; awayTeamId: string }> | null;
};

const RESPONSE_BUDGET_MS = 900;
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 108;
const MAX_PENDING = 36;
const MAX_ACTIVE = 3;

export function createTeamFixtureVerifier(
  fetchWeek: (season: number, week: number) => Promise<EspnGame[]>,
  options: { responseBudgetMs?: number; cacheTtlMs?: number } = {},
) {
  type Matchup = NonNullable<VerifiedFixtureWeek["games"]>[number];
  const cache = new Map<string, { expiresAt: number; games: Matchup[] }>();
  const pending = new Map<string, Promise<void>>();
  const queue: Array<() => void> = [];
  let active = 0;

  function drain() {
    while (active < MAX_ACTIVE && queue.length) {
      active++;
      queue.shift()!();
    }
  }

  function schedule(season: number, week: number) {
    const key = `${season}:${week}`;
    if (pending.has(key) || (cache.get(key)?.expiresAt ?? 0) > Date.now()) return;
    if (pending.size >= MAX_PENDING) return;

    let resolve!: () => void;
    const done = new Promise<void>((finish) => { resolve = finish; });
    pending.set(key, done);
    queue.push(() => {
      const started = performance.now();
      void (async () => {
        let outcome = "unavailable";
        try {
          const games = await fetchWeek(season, week);
          // An empty, malformed, or wrong-week response is never evidence of coverage.
          const matchups = games.map((game) => ({
            gameId: game.gameId,
            homeTeamId: game.homeTeam.teamId,
            awayTeamId: game.awayTeam.teamId,
          }));
          if (games.length > 0
            && games.every((game) => game.season === season && game.week === week)
            && matchups.every((game) => game.gameId
              && !["unknown", "TBD", ""].includes(game.homeTeamId)
              && !["unknown", "TBD", ""].includes(game.awayTeamId)
              && game.homeTeamId !== game.awayTeamId)
            && new Set(matchups.map((game) => game.gameId)).size === matchups.length) {
            cache.delete(key);
            cache.set(key, { games: matchups, expiresAt: Date.now() + (options.cacheTtlMs ?? CACHE_TTL_MS) });
            while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
            outcome = "verified";
          }
        } catch (error) {
          logger.warn({ season, week, errorName: error instanceof Error ? error.name : "UnknownError" },
            "Team analytics schedule fixture unavailable");
        } finally {
          logger.info({ season, week, outcome, durationMs: Math.round(performance.now() - started) },
            "Team analytics provider fixture fetch");
          pending.delete(key);
          active--;
          resolve();
          drain();
        }
      })();
    });
    drain();
  }

  async function getWeeks(season: number, throughWeek: number): Promise<VerifiedFixtureWeek[]> {
    for (let week = 1; week <= throughWeek; week++) schedule(season, week);
    const work = Array.from({ length: throughWeek }, (_, index) => pending.get(`${season}:${index + 1}`))
      .filter((promise): promise is Promise<void> => !!promise);
    if (work.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(work),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, options.responseBudgetMs ?? RESPONSE_BUDGET_MS); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const now = Date.now();
    return Array.from({ length: throughWeek }, (_, index) => {
      const week = index + 1;
      const entry = cache.get(`${season}:${week}`);
      if (entry && entry.expiresAt <= now) cache.delete(`${season}:${week}`);
      return { week, games: entry && entry.expiresAt > now ? entry.games : null };
    });
  }

  return { getWeeks };
}

export const teamFixtureVerifier = createTeamFixtureVerifier(
  (season, week) => fetchSchedule(season, week, 3_000),
);