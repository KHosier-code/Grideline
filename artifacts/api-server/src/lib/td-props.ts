import { desc, eq } from "drizzle-orm";
import { db, touchdownPickRunsTable, weeklyReportsTable } from "@workspace/db";

/**
 * Anytime-touchdown prices from DraftKings and FanDuel via the Odds API.
 * Player props are billed per event: one market in one region costs 1 credit
 * per game, so a full Sunday slate is about 15 credits. The events list is free.
 */
const SPORT_URL = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
const BOOKS = "draftkings,fanduel";
/** Leave headroom for the game-line captures that share the same key. */
const MIN_CREDITS_TO_START = 40;

/** Odds API team names to the nflverse abbreviations the TD model uses. */
const TEAM_ABBREVIATIONS: Record<string, string> = {
  "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL", "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR", "Chicago Bears": "CHI", "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL", "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
  "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX", "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC", "Los Angeles Rams": "LA", "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN", "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
  "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT", "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB", "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
};

export type BookPrice = { book: string; price: number };
export type PropEvent = { eventId: string; teams: string[]; commence: string; players: Record<string, BookPrice[]> };
export type TouchdownPropsReport = { capturedAt: string; creditsRemaining: number | null; events: PropEvent[] };

/** "D.J. Moore Jr." and "DJ Moore" compare equal. */
export function normalizePlayerName(name: string) {
  return name.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ").trim();
}

/** The best (highest-paying) book price for a player on a team, if captured. */
export function bestBookPrice(report: TouchdownPropsReport | null, name: string, team: string) {
  if (!report) return null;
  const key = normalizePlayerName(name);
  for (const event of report.events) {
    if (!event.teams.includes(team)) continue;
    const prices = event.players[key];
    if (!prices?.length) continue;
    const best = prices.reduce((top, item) => (item.price > top.price ? item : top));
    return { price: best.price, book: best.book, books: prices, capturedAt: report.capturedAt };
  }
  return null;
}

type OddsEvent = { id: string; home_team: string; away_team: string; commence_time: string };
type PropOdds = { bookmakers?: Array<{ key: string; markets?: Array<{ key: string; outcomes?: Array<{ name: string; description?: string; price: number }> }> }> };

export function parsePropOutcomes(payload: PropOdds) {
  const players: Record<string, BookPrice[]> = {};
  for (const bookmaker of payload.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (market.key !== "player_anytime_td") continue;
      for (const outcome of market.outcomes ?? []) {
        // Books list the player in description with name "Yes"; some omit description.
        const player = outcome.description ?? (outcome.name !== "Yes" ? outcome.name : null);
        if (!player || (outcome.description && outcome.name !== "Yes") || !Number.isFinite(outcome.price)) continue;
        const key = normalizePlayerName(player);
        (players[key] ??= []).push({ book: bookmaker.key, price: Math.round(outcome.price) });
      }
    }
  }
  return players;
}

export type TouchdownPropsCaptureResult = {
  status: "success" | "skipped" | "failed" | "not_configured";
  reason: string | null;
  events: number;
  players: number;
  creditsUsed: number;
  creditsRemaining: number | null;
};

/** Captures anytime-TD prices for games starting within `hoursAhead`. */
export async function captureTouchdownProps(hoursAhead: number, now = new Date()): Promise<TouchdownPropsCaptureResult> {
  const apiKey = process.env.ODDS_API_KEY;
  const empty = { events: 0, players: 0, creditsUsed: 0, creditsRemaining: null };
  if (!apiKey) return { status: "not_configured", reason: "ODDS_API_KEY is not configured.", ...empty };
  const [run] = await db.select({ season: touchdownPickRunsTable.season, week: touchdownPickRunsTable.week })
    .from(touchdownPickRunsTable).orderBy(desc(touchdownPickRunsTable.generatedAt)).limit(1);
  if (!run) return { status: "skipped", reason: "No touchdown picks have been published yet.", ...empty };

  const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
  const eventsUrl = `${SPORT_URL}/events?${new URLSearchParams({
    apiKey, commenceTimeFrom: iso(now), commenceTimeTo: iso(new Date(now.getTime() + hoursAhead * 3_600_000)),
  })}`;
  const eventsResponse = await fetch(eventsUrl, { signal: AbortSignal.timeout(20_000) });
  let creditsRemaining = Number(eventsResponse.headers.get("x-requests-remaining") ?? Number.NaN);
  if (!eventsResponse.ok) {
    return { status: "failed", reason: `The Odds API returned HTTP ${eventsResponse.status} for the events list.`, ...empty };
  }
  const events = (await eventsResponse.json()) as OddsEvent[];
  if (!events.length) return { status: "skipped", reason: "No games start in the capture window.", ...empty };
  if (Number.isFinite(creditsRemaining) && creditsRemaining < MIN_CREDITS_TO_START + events.length) {
    return { status: "skipped", reason: `Only ${creditsRemaining} Odds API credits remain; props wait so game lines keep working.`, ...empty, creditsRemaining };
  }

  const captured: PropEvent[] = [];
  let creditsUsed = 0;
  for (const event of events) {
    const url = `${SPORT_URL}/events/${encodeURIComponent(event.id)}/odds?${new URLSearchParams({
      apiKey, regions: "us", markets: "player_anytime_td", oddsFormat: "american", bookmakers: BOOKS,
    })}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const last = Number(response.headers.get("x-requests-last") ?? Number.NaN);
    const remaining = Number(response.headers.get("x-requests-remaining") ?? Number.NaN);
    if (Number.isFinite(last)) creditsUsed += last;
    if (Number.isFinite(remaining)) creditsRemaining = remaining;
    if (!response.ok) continue;
    const players = parsePropOutcomes((await response.json()) as PropOdds);
    const teams = [TEAM_ABBREVIATIONS[event.home_team], TEAM_ABBREVIATIONS[event.away_team]].filter(Boolean);
    if (Object.keys(players).length) captured.push({ eventId: event.id, teams, commence: event.commence_time, players });
  }

  const report: TouchdownPropsReport = {
    capturedAt: now.toISOString(),
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : null,
    events: captured,
  };
  // Merge with this week's earlier capture so a Thursday-only snapshot keeps
  // its game when Saturday's capture covers the rest.
  const previous = await latestTouchdownProps(run.season, run.week);
  if (previous) {
    const newIds = new Set(captured.map((event) => event.eventId));
    report.events = [...previous.events.filter((event) => !newIds.has(event.eventId)), ...captured];
  }
  await db.insert(weeklyReportsTable).values({
    kind: "td-props", season: run.season, week: run.week, generatedAt: now, payload: report as unknown as Record<string, unknown>,
  }).onConflictDoNothing();
  return {
    status: "success", reason: null, events: captured.length,
    players: captured.reduce((sum, event) => sum + Object.keys(event.players).length, 0),
    creditsUsed, creditsRemaining: report.creditsRemaining,
  };
}

export async function latestTouchdownProps(season: number, week: number): Promise<TouchdownPropsReport | null> {
  const rows = await db.select().from(weeklyReportsTable)
    .where(eq(weeklyReportsTable.kind, "td-props"))
    .orderBy(desc(weeklyReportsTable.generatedAt)).limit(10);
  const row = rows.find((item) => item.season === season && item.week === week);
  return row ? (row.payload as unknown as TouchdownPropsReport) : null;
}
