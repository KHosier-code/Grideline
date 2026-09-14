import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  gamesTable,
  teamsTable,
  weatherForecastSnapshotsTable,
  dataSyncRunsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { stadiumFor } from "./stadiums";

const NWS = "https://api.weather.gov";
const USER_AGENT = process.env.NWS_USER_AGENT ?? "Gridline/0.2 (NWS forecast integration)";
const FORECAST_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const properties = (value: unknown) => object(object(value).properties);
const numberValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
function firstNumber(value: string | null) {
  const match = value?.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
function precipitationType(summary: string | null) {
  if (!summary) return null;
  if (/snow|flurr/i.test(summary)) return "snow";
  if (/sleet|ice|freezing/i.test(summary)) return "sleet";
  if (/rain|shower|drizzle|thunder/i.test(summary)) return "rain";
  return null;
}

async function requestJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`NWS HTTP ${response.status} for ${new URL(url).pathname}`);
  return object(await response.json());
}

async function beginRun(options?: { jobKey?: string; scheduledFor?: Date }) {
  const [run] = await db.insert(dataSyncRunsTable).values({
    provider: "nws-weather",
    status: "running",
    jobKey: options?.jobKey ?? null,
    scheduledFor: options?.scheduledFor ?? null,
  }).returning({ id: dataSyncRunsTable.id });
  return run.id;
}

export async function syncNwsWeather(options?: { now?: Date; jobKey?: string; scheduledFor?: Date }) {
  const now = options?.now ?? new Date();
  const runId = await beginRun(options);
  const horizon = new Date(now.getTime() + FORECAST_HORIZON_MS);
  let inserted = 0;
  const failures: string[] = [];
  try {
    const games = await db.select().from(gamesTable).where(and(
      gte(gamesTable.kickoffTime, now),
      lte(gamesTable.kickoffTime, horizon),
    ));
    const teams = await db.select().from(teamsTable);
    const byId = new Map(teams.map((team) => [team.teamId, team]));
    const pointsCache = new Map<string, JsonRecord>();
    const forecastCache = new Map<string, JsonRecord>();
    const stadiumGames = new Map<string, { game: typeof games[number]; stadium: NonNullable<ReturnType<typeof stadiumFor>> }[]>();
    for (const game of games) {
      const team = byId.get(game.homeTeamId);
      const stadium = stadiumFor(team?.abbreviation, game.stadium);
      if (!stadium || !game.kickoffTime) {
        failures.push(`${game.gameId}: unsupported or international venue`);
        continue;
      }
      const key = `${stadium.latitude},${stadium.longitude}`;
      stadiumGames.set(key, [...(stadiumGames.get(key) ?? []), { game, stadium }]);
    }
    for (const [key, entries] of stadiumGames) {
      const stadium = entries[0].stadium;
      const [lat, lon] = key.split(",");
      try {
        let point = pointsCache.get(key);
        if (!point) {
          point = await requestJson(`${NWS}/points/${lat},${lon}`);
          pointsCache.set(key, point);
        }
        const pointProps = properties(point);
        const forecastUrl = text(pointProps.forecast);
        if (!forecastUrl && stadium.indoorOutdoor === "outdoor") throw new Error("NWS points response did not provide forecast URL");
        let forecast: JsonRecord | null = null;
        if (forecastUrl && stadium.indoorOutdoor === "outdoor") {
          forecast = forecastCache.get(key) ?? await requestJson(forecastUrl);
          forecastCache.set(key, forecast);
        }
        const forecastProps = properties(forecast);
        const periods = Array.isArray(forecastProps.periods) ? forecastProps.periods.map(object) : [];
        const fetchedAt = now;
        for (const { game } of entries) {
          const kickoff = game.kickoffTime!;
          const period = periods.find((candidate) => {
            const start = Date.parse(String(candidate.startTime ?? ""));
            const end = Date.parse(String(candidate.endTime ?? ""));
            return Number.isFinite(start) && Number.isFinite(end) && start <= kickoff.getTime() && kickoff.getTime() < end;
          });
          if (!period && stadium.indoorOutdoor === "outdoor") {
            failures.push(`${game.gameId}: NWS forecast did not contain a period covering kickoff`);
            continue;
          }
          const periodProps = object(period);
          const validTime = new Date(Date.parse(String(periodProps.startTime ?? kickoff.toISOString())));
          const summary = text(periodProps.shortForecast);
          const generated = text(forecastProps.updateTime);
          await db.insert(weatherForecastSnapshotsTable).values({
            gameId: game.gameId,
            source: "National Weather Service api.weather.gov",
            fetchedAt,
            forecastGeneratedAt: generated && Number.isFinite(Date.parse(generated)) ? new Date(generated) : null,
            validTime: Number.isFinite(validTime.getTime()) ? validTime : kickoff,
            temperature: stadium.indoorOutdoor === "indoor" ? null : numberValue(periodProps.temperature),
            sustainedWind: stadium.indoorOutdoor === "indoor" ? null : firstNumber(text(periodProps.windSpeed)),
            windGust: stadium.indoorOutdoor === "indoor" ? null : firstNumber(text(periodProps.windGust)),
            precipitationProbability: stadium.indoorOutdoor === "indoor" ? null : numberValue(properties(periodProps.probabilityOfPrecipitation).value),
            precipitationType: stadium.indoorOutdoor === "indoor" ? null : precipitationType(summary),
            humidity: stadium.indoorOutdoor === "indoor" ? null : numberValue(properties(periodProps.relativeHumidity).value),
            weatherSummary: stadium.indoorOutdoor === "indoor" ? "Indoor stadium; outdoor forecast not applicable." : summary,
            indoorOutdoor: stadium.indoorOutdoor,
            roofStatus: stadium.retractableRoof === "retractable" ? "unknown" : stadium.retractableRoof === "none" ? "not_applicable" : "unknown",
            sourceUrl: forecastUrl ?? `${NWS}/points/${lat},${lon}`,
            office: text(pointProps.forecastOffice),
            gridpoint: pointProps.gridId && pointProps.gridX && pointProps.gridY ? `${pointProps.gridId}/${pointProps.gridX}/${pointProps.gridY}` : null,
          });
          inserted += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${stadium.venue}: ${message}`);
        logger.warn({ error, stadium: stadium.venue }, "NWS weather synchronization failed");
      }
    }
    const status = failures.length ? inserted ? "partial" : "failed" : "success";
    await db.update(dataSyncRunsTable).set({
      status, recordsProcessed: inserted, errorMessage: failures.length ? failures.join("; ").slice(0, 8000) : null,
      completedAt: new Date(),
      metadata: { source: "api.weather.gov", requestCount: pointsCache.size + forecastCache.size, horizon: horizon.toISOString() },
    }).where(eq(dataSyncRunsTable.id, runId));
    return { status, inserted, requests: pointsCache.size + forecastCache.size, failures, horizon: horizon.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(dataSyncRunsTable).set({ status: "failed", errorMessage: message, completedAt: new Date() }).where(eq(dataSyncRunsTable.id, runId));
    throw error;
  }
}

export async function weatherHealth() {
  const rows = await db.select().from(dataSyncRunsTable).where(eq(dataSyncRunsTable.provider, "nws-weather"));
  const latest = rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  return {
    source: "National Weather Service api.weather.gov",
    cost: "Free, keyless open data; reasonable rate limits.",
    userAgentConfigured: Boolean(process.env.NWS_USER_AGENT),
    lastRun: latest ? { status: latest.status, startedAt: latest.startedAt.toISOString(), completedAt: latest.completedAt?.toISOString() ?? null, error: latest.errorMessage } : null,
  };
}