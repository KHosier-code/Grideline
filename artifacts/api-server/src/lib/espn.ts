import { logger } from "./logger";

export type EspnTeam = {
  teamId: string;
  abbreviation: string;
  teamName: string;
  conference: string | null;
  division: string | null;
  logoUrl: string | null;
};

export type EspnGame = {
  gameId: string;
  season: number;
  week: number;
  gameDate: string;
  kickoffTime: string | null;
  homeTeam: EspnTeam;
  awayTeam: EspnTeam;
  venue: string | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  gameStatus: string;
  broadcast: string | null;
  modelStatus: "not_trained" | "available";
};

type EspnResponse = {
  events?: unknown[];
  season?: { year?: number; type?: number };
  week?: { number?: number };
  sports?: Array<{
    leagues?: Array<{
      teams?: Array<{ team?: Record<string, unknown> }>;
    }>;
  }>;
};

const espnBaseUrl = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const cache = new Map<string, { expiresAt: number; value: unknown }>();
let lastSuccessfulRequest: Date | null = null;
let requestCountToday = 0;
let requestCountThisMonth = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function findTeamName(team: Record<string, unknown>): string {
  return (
    asString(team.displayName) ??
    asString(team.name) ??
    asString(team.shortDisplayName) ??
    "Unknown team"
  );
}

function parseTeam(teamValue: unknown): EspnTeam {
  const team = asRecord(teamValue);
  return {
    teamId: String(team.id ?? team.abbreviation ?? "unknown"),
    abbreviation: asString(team.abbreviation) ?? "TBD",
    teamName: findTeamName(team),
    conference: asString(team.conference),
    division: asString(team.division),
    logoUrl: asString(team.logo),
  };
}

function parseGame(eventValue: unknown, season: number, requestedWeek: number): EspnGame | null {
  const event = asRecord(eventValue);
  const competition = asRecord(Array.isArray(event.competitions) ? event.competitions[0] : null);
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const homeValue = competitors.find((item) => asRecord(item).homeAway === "home");
  const awayValue = competitors.find((item) => asRecord(item).homeAway === "away");
  if (!homeValue || !awayValue || !event.id) return null;

  const home = asRecord(homeValue);
  const away = asRecord(awayValue);
  const status = asRecord(asRecord(competition.status).type);
  const venue = asRecord(asRecord(competition.venue).fullName ? competition.venue : null);
  const broadcastValue = Array.isArray(competition.broadcasts) ? competition.broadcasts[0] : null;
  const broadcast = asRecord(broadcastValue);
  const broadcastNames = Array.isArray(broadcast.names) ? broadcast.names : [];
  const homeScore = Number(home.score);
  const awayScore = Number(away.score);

  return {
    gameId: String(event.id),
    season,
    week: Number(asRecord(event.week).number ?? requestedWeek),
    gameDate: String(event.date ?? new Date().toISOString()),
    kickoffTime: asString(event.date),
    homeTeam: parseTeam(home.team),
    awayTeam: parseTeam(away.team),
    venue: asString(venue.fullName),
    finalHomeScore: Number.isFinite(homeScore) ? homeScore : null,
    finalAwayScore: Number.isFinite(awayScore) ? awayScore : null,
    gameStatus: asString(status.name) ?? "STATUS_UNKNOWN",
    broadcast: asString(broadcastNames[0]),
    modelStatus: "not_trained",
  };
}

async function fetchEspn(path: string): Promise<EspnResponse> {
  const response = await fetch(`${espnBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`ESPN returned HTTP ${response.status}`);
  }
  lastSuccessfulRequest = new Date();
  requestCountToday += 1;
  requestCountThisMonth += 1;
  return (await response.json()) as EspnResponse;
}

export async function fetchSchedule(season: number, week: number): Promise<EspnGame[]> {
  const cacheKey = `schedule:${season}:${week}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as EspnGame[];

  const seasonType = week > 18 ? 3 : 2;
  const sourceWeek = week > 18 ? week - 18 : week;
  const data = await fetchEspn(`/scoreboard?limit=1000&dates=${season}&seasontype=${seasonType}&week=${sourceWeek}`);
  const games = (data.events ?? [])
    .map((event) => {
      const game = parseGame(event, season, week);
      return game ? { ...game, week } : null;
    })
    .filter((game): game is EspnGame => game !== null);
  cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: games });
  return games;
}

export async function fetchCurrentSeasonWeek() {
  const data = await fetchEspn("/scoreboard?limit=1000");
  const season = Number(data.season?.year);
  const sourceWeek = Number(data.week?.number);
  const seasonType = Number(data.season?.type);
  if (!Number.isInteger(season) || !Number.isInteger(sourceWeek)) {
    throw new Error("ESPN did not return a current NFL season and week");
  }
  return {
    season,
    week: seasonType === 3 ? 18 + sourceWeek : sourceWeek,
    seasonType,
  };
}

export async function fetchTeams(): Promise<EspnTeam[]> {
  const cacheKey = "teams";
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as EspnTeam[];

  const data = await fetchEspn("/teams?limit=100");
  const teams = data.sports?.[0]?.leagues?.[0]?.teams
    ?.map((entry) => parseTeam(entry.team))
    .filter((team) => team.teamId !== "unknown") ?? [];
  cache.set(cacheKey, { expiresAt: Date.now() + 60 * 60_000, value: teams });
  return teams;
}

export function getEspnHealth() {
  return {
    lastSuccessfulRequest,
    requestsToday: requestCountToday,
    requestsThisMonth: requestCountThisMonth,
  };
}

export function logEspnFailure(error: unknown) {
  logger.warn({ error }, "ESPN data request failed");
}