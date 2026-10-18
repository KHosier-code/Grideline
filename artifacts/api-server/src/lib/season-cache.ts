/**
 * Keeps one season's worth of heavy page data in memory.
 *
 * Several public pages (home, TD Picks, player pages, Record) need every
 * model run and every saved sportsbook price for the season. Reading all of
 * that from the database on each visit sent tens of megabytes per page view
 * (Neon bills this as network transfer). Instead, each request first runs a
 * tiny `fingerprint` query (newest run, newest price, results so far); the
 * full load runs again only when that changes or the copy is `ttlMs` old,
 * since some of the data depends on the clock (picks lock at kickoff).
 * Visitors arriving together share one load.
 */
export function seasonCache<T>(
  load: (season: number) => Promise<T>,
  fingerprint: (season: number) => Promise<string>,
  ttlMs = 5 * 60_000,
  clock: () => number = Date.now,
) {
  const entries = new Map<number, { key: string; at: number; value: Promise<T> }>();
  return async (season: number): Promise<T> => {
    const key = await fingerprint(season);
    const entry = entries.get(season);
    if (entry && entry.key === key && clock() - entry.at < ttlMs) return entry.value;
    const value = load(season);
    entries.set(season, { key, at: clock(), value });
    // A failed load is never kept.
    value.catch(() => { if (entries.get(season)?.value === value) entries.delete(season); });
    return value;
  };
}
