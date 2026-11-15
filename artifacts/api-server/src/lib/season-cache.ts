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

/**
 * Like seasonCache, but the database is read again only when the fingerprint
 * changes (a new run, result or price), never just because time passed. The
 * clock-dependent part, such as which run was the last before kickoff, is
 * worked out in memory from the saved rows at most once per `deriveMs`. That
 * costs no database transfer.
 */
export function seasonDataCache<R, T>(
  read: (season: number) => Promise<R>,
  fingerprint: (season: number) => Promise<string>,
  derive: (rows: R, now: Date, season: number) => T | Promise<T>,
  deriveMs = 60_000,
  clock: () => number = Date.now,
) {
  const rows = seasonCache(read, fingerprint, Number.POSITIVE_INFINITY, clock);
  const derived = new Map<number, { rows: R; at: number; value: Promise<T> }>();
  return async (season: number): Promise<T> => {
    const current = await rows(season);
    const now = clock();
    const entry = derived.get(season);
    if (entry && entry.rows === current && now - entry.at < deriveMs) return entry.value;
    const value = Promise.resolve().then(() => derive(current, new Date(now), season));
    derived.set(season, { rows: current, at: now, value });
    value.catch(() => { if (derived.get(season)?.value === value) derived.delete(season); });
    return value;
  };
}
