import { footballTime } from "./feed-schedule";
import { logger } from "./logger";

let cached = new Set<string>();
let expiresAt = 0;

/** Range queries cover playoffs and special weekdays without regular-season week assumptions. */
export async function getFeedGameDays(now: Date): Promise<ReadonlySet<string>> {
  if (+now < expiresAt) return cached;
  const compactDate = (offset: number) => new Date(+now + offset * 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${compactDate(-8)}-${compactDate(2)}&limit=100`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new Error(`ESPN calendar HTTP ${response.status}`);
    const payload = await response.json() as { events?: { date?: string }[] };
    if (!Array.isArray(payload.events)) throw new Error("ESPN calendar missing events");
    const dates = new Set<string>();
    for (const event of payload.events) {
      if (!event.date || !Number.isFinite(Date.parse(event.date))) throw new Error("ESPN calendar has invalid kickoff");
      dates.add(footballTime(new Date(event.date)).dateKey);
    }
    cached = dates;
    expiresAt = +now + 60 * 60_000;
  } catch (error) {
    // Retain the conservative Thu/Sat/Sun/Mon cadence and any known special dates.
    expiresAt = +now + 5 * 60_000;
    logger.warn({ error }, "Game calendar unavailable; using baseline feed cadence");
  }
  return cached;
}