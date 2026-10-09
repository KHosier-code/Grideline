import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import * as zod from "zod/v4";
import {
  dataSyncRunsTable, db, gameProjectionRunsTable, touchdownPickResultsTable,
  touchdownPickRunsTable, weeklyReportsTable, gamesTable, weatherForecastSnapshotsTable,
} from "@workspace/db";
import {
  favoriteRecord, lineValueGames, lineValueSummary, openerWatch, openerWatchSummary, projectionsBeforeKickoff, winnerRecord,
} from "../lib/game-projections";
import { loadSeasonProjectionData } from "../lib/projection-data";
import {
  bookComparison, bookFairProbability, boardForWeek, expectedValue, fairAmericanOdds, isValuePick, topTenRecord, valueRecord,
} from "../lib/touchdown-board";
import { captureOddsSnapshots, getOddsSchedulingBalance, oddsCaptureQuotaDecision } from "../lib/odds";
import { ODDS_BACKUP_RECENT_MS, recentOddsCapture } from "../lib/kickoff-clock";
import { bestBookPrice, captureTouchdownProps, touchdownPropsForSeason } from "../lib/td-props";
import { syncNwsWeather } from "../lib/weather";
import { withFeedLock } from "../lib/feed-lock";
import { footballTime } from "../lib/feed-schedule";
import { syncNflverseHistory } from "../lib/nflverse";
import { personnelRefreshStatus, startPersonnelRefresh } from "../lib/personnel-refresh";
import { syncEspnScheduleCoverage } from "../lib/schedule";
import { syncEspnInjuries } from "../lib/availability";
import { rebuildPregameFeatures } from "../lib/features";

const router: IRouter = Router();

function parseInteger(value: unknown, min: number, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

router.get("/consumer/touchdowns", async (req, res): Promise<void> => {
  const season = parseInteger(req.query.season, 1990, 2200);
  const week = parseInteger(req.query.week, 1, 22);
  if (season === null || week === null) {
    res.status(400).json({ error: "Invalid season or week" });
    return;
  }
  try {
    const available = await db.selectDistinct({ season: touchdownPickRunsTable.season, week: touchdownPickRunsTable.week })
      .from(touchdownPickRunsTable)
      .orderBy(desc(touchdownPickRunsTable.season), desc(touchdownPickRunsTable.week));
    const selected = season !== undefined && week !== undefined
      ? available.find((item) => item.season === season && item.week === week)
      : available.find((item) => season === undefined || item.season === season);
    const empty = {
      status: "unavailable" as const, season: selected?.season ?? season ?? null, week: selected?.week ?? week ?? null,
      generatedAt: null, modelVersion: null, evaluation: { topTenHitRate: null, auc: null, testedOn: null },
      picks: [], weeks: available, record: { weeksGraded: 0, topTenPicks: 0, topTenHits: 0, weeks: [] },
      valueRecord: { picks: 0, hits: 0, units: 0, weeks: [] },
      bookComparison: bookComparison([]),
    };
    if (!selected) {
      res.json(empty);
      return;
    }
    const seasonRuns = await db.select().from(touchdownPickRunsTable)
      .where(eq(touchdownPickRunsTable.season, selected.season))
      .orderBy(asc(touchdownPickRunsTable.generatedAt));
    const results = await db.select().from(touchdownPickResultsTable)
      .where(eq(touchdownPickResultsTable.season, selected.season));
    const resultsByWeek = new Map<number, Map<string, boolean>>();
    for (const row of results) {
      const map = resultsByWeek.get(row.week) ?? new Map<string, boolean>();
      map.set(row.playerId, row.scored);
      resultsByWeek.set(row.week, map);
    }
    const now = new Date();
    const boards = new Map<number, ReturnType<typeof boardForWeek>>();
    for (const weekNumber of new Set(seasonRuns.map((run) => run.week))) {
      boards.set(weekNumber, boardForWeek(seasonRuns.filter((run) => run.week === weekNumber), now));
    }
    const board = boards.get(selected.week) ?? [];
    const latest = seasonRuns.filter((run) => run.week === selected.week).at(-1)!;
    const weekResults = resultsByWeek.get(selected.week) ?? new Map<string, boolean>();
    const propsByWeek = await touchdownPropsForSeason(selected.season).catch(() => new Map());
    const props = propsByWeek.get(selected.week) ?? null;
    const evaluation = latest.evaluation as Record<string, unknown>;
    const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    res.json({
      status: "available",
      season: selected.season,
      week: selected.week,
      generatedAt: latest.generatedAt.toISOString(),
      modelVersion: latest.modelVersion,
      evaluation: {
        topTenHitRate: numberOrNull(evaluation.topTenHitRate),
        auc: numberOrNull(evaluation.auc),
        testedOn: typeof evaluation.testedOn === "string" ? evaluation.testedOn : null,
      },
      picks: board.map((entry, index) => {
        const bookOdds = bestBookPrice(props, entry.name, entry.team);
        return {
          rank: index + 1,
          playerId: entry.playerId,
          name: entry.name,
          position: entry.position,
          team: entry.team,
          opponent: entry.opponent,
          isHome: entry.isHome,
          kickoff: entry.kickoff,
          probability: entry.probability,
          fairOdds: fairAmericanOdds(entry.probability),
          injuryStatus: entry.injuryStatus,
          factors: entry.factors,
          scored: weekResults.has(entry.playerId) ? weekResults.get(entry.playerId)! : null,
          bookOdds,
          expectedValue: bookOdds ? Math.round(expectedValue(entry.probability, bookOdds.price) * 1000) / 1000 : null,
          value: isValuePick(index + 1, entry.probability, bookOdds?.price),
        };
      }),
      weeks: available,
      record: topTenRecord([...boards.entries()]
        .map(([weekNumber, weekBoard]) => ({ week: weekNumber, board: weekBoard, results: resultsByWeek.get(weekNumber) ?? new Map() }))),
      valueRecord: valueRecord([...boards.entries()].map(([weekNumber, weekBoard]) => ({
        week: weekNumber, board: weekBoard, results: resultsByWeek.get(weekNumber) ?? new Map(),
        price: (entry) => bestBookPrice(propsByWeek.get(weekNumber) ?? null, entry.name, entry.team)?.price ?? null,
      }))),
      bookComparison: bookComparison([...boards.entries()].flatMap(([weekNumber, weekBoard]) => {
        const weekResults = resultsByWeek.get(weekNumber);
        return weekBoard.flatMap((entry) => {
          const prices = bestBookPrice(propsByWeek.get(weekNumber) ?? null, entry.name, entry.team)?.books.map((item) => item.price) ?? [];
          const bookProbability = bookFairProbability(prices);
          return bookProbability !== null && weekResults?.has(entry.playerId)
            ? [{ week: weekNumber, probability: entry.probability, bookProbability, scored: weekResults.get(entry.playerId)! }] : [];
        });
      })),
    });
  } catch (error) {
    req.log.error({ error }, "Consumer touchdown picks read failed");
    res.status(503).json({ error: "Touchdown picks are being refreshed", code: "consumer_data_unavailable" });
  }
});

const factorSchema = zod.number().finite().nullable();
const ingestSchema = zod.object({
  season: zod.number().int().min(2000).max(2200),
  week: zod.number().int().min(1).max(22),
  generatedAt: zod.string().datetime({ offset: true }),
  modelVersion: zod.string().min(1).max(120),
  evaluation: zod.object({
    topTenHitRate: zod.number().min(0).max(1).nullable(),
    auc: zod.number().min(0).max(1).nullable(),
    testedOn: zod.string().max(200).nullable(),
  }),
  picks: zod.array(zod.object({
    playerId: zod.string().min(1).max(40),
    name: zod.string().min(1).max(80),
    position: zod.enum(["QB", "RB", "WR", "TE"]),
    team: zod.string().min(2).max(4),
    opponent: zod.string().min(2).max(4),
    isHome: zod.boolean(),
    kickoff: zod.string().datetime({ offset: true }).nullable(),
    probability: zod.number().min(0).max(1),
    injuryStatus: zod.string().max(40).nullable(),
    factors: zod.object({
      targetsPerGame: factorSchema, carriesPerGame: factorSchema, targetShare: factorSchema, carryShare: factorSchema,
      redZoneTouchesPerGame: factorSchema, redZoneShare: factorSchema, goalLineShare: factorSchema,
      teamImpliedPoints: factorSchema, opponentTdsAllowedRatio: factorSchema, recentTdRate: factorSchema,
    }),
  })).max(800),
  results: zod.array(zod.object({
    season: zod.number().int().min(2000).max(2200),
    week: zod.number().int().min(1).max(22),
    playerId: zod.string().min(1).max(40),
    scored: zod.boolean(),
  })).max(5000).default([]),
});

function tokenMatches(header: string | undefined, expected: string) {
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return provided.length > 0 && timingSafeEqual(digest(provided), digest(expected));
}

/** Shared secret for the scheduled GitHub workflow (research/td-model and research/game-model). */
function authorizeIngest(req: import("express").Request, res: import("express").Response) {
  const expected = process.env.GRIDLINE_INGEST_TOKEN ?? process.env.TD_PICKS_INGEST_TOKEN;
  if (!expected || expected.length < 24) {
    res.status(503).json({ error: "Ingest is not configured" });
    return false;
  }
  if (!tokenMatches(req.get("authorization"), expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

router.post("/touchdowns/ingest", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid touchdown picks payload", issues: parsed.error.issues.slice(0, 10) });
    return;
  }
  const body = parsed.data;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(touchdownPickRunsTable).values({
        season: body.season, week: body.week, generatedAt: new Date(body.generatedAt),
        modelVersion: body.modelVersion, evaluation: body.evaluation, picks: body.picks,
      }).onConflictDoNothing();
      for (const result of body.results) {
        await tx.insert(touchdownPickResultsTable).values(result).onConflictDoUpdate({
          target: [touchdownPickResultsTable.season, touchdownPickResultsTable.week, touchdownPickResultsTable.playerId],
          set: { scored: result.scored, recordedAt: new Date() },
        });
      }
    });
    res.status(201).json({ stored: body.picks.length, results: body.results.length });
  } catch (error) {
    req.log.error({ error }, "Touchdown ingest failed");
    res.status(500).json({ error: "Touchdown ingest failed" });
  }
});

const qbSchema = zod.object({
  name: zod.string().max(80).nullable(), value: zod.number().finite().nullable(),
  listed: zod.boolean(), newStarter: zod.boolean(),
  outName: zod.string().max(80).nullable().optional(), outReason: zod.string().max(40).nullable().optional(),
});
const gameIngestSchema = zod.object({
  season: zod.number().int().min(2000).max(2200),
  week: zod.number().int().min(1).max(22),
  generatedAt: zod.string().datetime({ offset: true }),
  modelVersion: zod.string().min(1).max(120),
  evaluation: zod.object({
    seasons: zod.array(zod.record(zod.string(), zod.union([zod.number(), zod.string(), zod.null(), zod.array(zod.union([zod.number(), zod.null()]))]))).max(40).optional(),
  }).catchall(zod.union([zod.number(), zod.string(), zod.null()])),
  games: zod.array(zod.object({
    gameId: zod.string().min(1).max(40),
    nflverseGameId: zod.string().min(1).max(40),
    homeTeam: zod.string().min(2).max(4),
    awayTeam: zod.string().min(2).max(4),
    kickoff: zod.string().datetime({ offset: true }).nullable(),
    projectedMargin: zod.number().min(-60).max(60),
    projectedTotal: zod.number().min(0).max(120),
    homeWinProbability: zod.number().min(0).max(1),
    marketMargin: zod.number().min(-60).max(60).nullable().optional(),
    marketTotal: zod.number().min(0).max(120).nullable().optional(),
    homeQb: qbSchema,
    awayQb: qbSchema,
    factors: zod.object({
      qbEdge: factorSchema, teamEdge: factorSchema, passEdge: factorSchema, rushEdge: factorSchema,
      restDiff: factorSchema, neutralSite: zod.boolean(),
    }),
  })).max(32),
  teams: zod.array(zod.object({
    team: zod.string().min(2).max(4),
    rating: zod.number().finite(), offense: zod.number().finite(), defense: zod.number().finite(), qb: zod.number().finite(),
    ratingRank: zod.number().int().min(1).max(32), offenseRank: zod.number().int().min(1).max(32),
    defenseRank: zod.number().int().min(1).max(32), qbRank: zod.number().int().min(1).max(32),
    qbName: zod.string().max(80).nullable(), qbValue: zod.number().finite().nullable(), qbNewStarter: zod.boolean(),
    qbOutName: zod.string().max(80).nullable().optional(), qbOutReason: zod.string().max(40).nullable().optional(),
    record: zod.object({ wins: zod.number().int().min(0), losses: zod.number().int().min(0), ties: zod.number().int().min(0) }).nullable(),
    stats: zod.record(zod.string().regex(/^(off|def)_[a-z_]+$/), zod.number().finite().nullable()),
  })).max(40).default([]),
});

router.post("/games/projections/ingest", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const parsed = gameIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid game projections payload", issues: parsed.error.issues.slice(0, 10) });
    return;
  }
  const body = parsed.data;
  try {
    await db.insert(gameProjectionRunsTable).values({
      season: body.season, week: body.week, generatedAt: new Date(body.generatedAt),
      modelVersion: body.modelVersion, evaluation: body.evaluation, games: body.games, teams: body.teams,
    }).onConflictDoNothing();
    res.status(201).json({ stored: body.games.length, teams: body.teams.length });
  } catch (error) {
    req.log.error({ error }, "Game projection ingest failed");
    res.status(500).json({ error: "Game projection ingest failed" });
  }
});

router.get("/consumer/game-projections", async (req, res): Promise<void> => {
  const season = parseInteger(req.query.season, 1990, 2200);
  if (season === null) {
    res.status(400).json({ error: "Invalid season" });
    return;
  }
  try {
    const [latest] = await db.select({ season: gameProjectionRunsTable.season }).from(gameProjectionRunsTable)
      .orderBy(desc(gameProjectionRunsTable.generatedAt)).limit(1);
    const selectedSeason = season ?? latest?.season;
    if (selectedSeason === undefined) {
      res.json({ status: "unavailable", season: null, modelVersion: null, generatedAt: null, evaluation: {}, games: [],
        record: { wins: 0, losses: 0, pushes: 0 }, favoriteRecord: { wins: 0, losses: 0, pushes: 0 },
        lineValue: lineValueSummary([]), watch: { ...openerWatchSummary([]), games: [] }, weeks: [] });
      return;
    }
    const { runs, finals, quotesByGame, booksByGame } = await loadSeasonProjectionData(selectedSeason);
    const projections = projectionsBeforeKickoff(runs);
    const record = winnerRecord(projections.values(), finals);
    const lineValue = lineValueSummary(lineValueGames(runs, quotesByGame, finals));
    const watchGames = openerWatch(runs, quotesByGame, finals, new Date());
    const newest = runs.at(-1);
    res.json({
      status: runs.length ? "available" : "unavailable",
      season: selectedSeason,
      modelVersion: newest?.modelVersion ?? null,
      generatedAt: newest?.generatedAt.toISOString() ?? null,
      evaluation: newest?.evaluation ?? {},
      games: [...projections.values()].map(({ generatedAt, lockedAt, ...game }) => ({
        ...game, projectedAt: generatedAt.toISOString(), lockedAt: lockedAt.toISOString(), books: booksByGame.get(game.gameId) ?? [],
      })),
      record: record.total,
      favoriteRecord: favoriteRecord(projections.values(), finals),
      lineValue,
      watch: {
        ...openerWatchSummary(watchGames),
        games: watchGames.map((game) => ({
          ...game, lockedAt: game.lockedAt.toISOString(), openedAt: game.openedAt.toISOString(), currentAt: game.currentAt.toISOString(),
        })),
      },
      weeks: [...record.weeks.entries()].sort(([a], [b]) => a - b).map(([week, line]) => ({ week, ...line })),
    });
  } catch (error) {
    req.log.error({ error }, "Consumer game projections read failed");
    res.status(503).json({ error: "Game projections are being refreshed", code: "consumer_data_unavailable" });
  }
});

router.get("/consumer/power-ratings", async (req, res): Promise<void> => {
  const season = parseInteger(req.query.season, 1990, 2200);
  if (season === null) {
    res.status(400).json({ error: "Invalid season" });
    return;
  }
  try {
    const runs = await db.select({
      season: gameProjectionRunsTable.season, week: gameProjectionRunsTable.week,
      generatedAt: gameProjectionRunsTable.generatedAt, teams: gameProjectionRunsTable.teams,
    }).from(gameProjectionRunsTable)
      .where(season === undefined ? undefined : eq(gameProjectionRunsTable.season, season))
      .orderBy(desc(gameProjectionRunsTable.generatedAt)).limit(200);
    const latest = runs.find((run) => run.teams.length > 0);
    if (!latest) {
      res.json({ status: "unavailable", season: season ?? null, week: null, generatedAt: null, teams: [] });
      return;
    }
    const previous = runs.find((run) => run.teams.length > 0 && run.season === latest.season && run.week < latest.week);
    const previousRank = new Map(previous?.teams.map((team) => [team.team, team.ratingRank]) ?? []);
    res.json({
      status: "available",
      season: latest.season,
      week: latest.week,
      generatedAt: latest.generatedAt.toISOString(),
      teams: [...latest.teams].sort((a, b) => a.ratingRank - b.ratingRank).map((team) => ({
        ...team,
        rankChange: previousRank.has(team.team) ? previousRank.get(team.team)! - team.ratingRank : null,
      })),
    });
  } catch (error) {
    req.log.error({ error }, "Consumer power ratings read failed");
    res.status(503).json({ error: "Power ratings are being refreshed", code: "consumer_data_unavailable" });
  }
});

const reportIngestSchema = zod.object({
  kind: zod.enum(["usage", "replay", "share-td"]),
  season: zod.number().int().min(2000).max(2200),
  week: zod.number().int().min(0).max(22),
  generatedAt: zod.string().datetime({ offset: true }),
  payload: zod.record(zod.string(), zod.unknown()),
});

router.post("/reports/ingest", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const parsed = reportIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report payload", issues: parsed.error.issues.slice(0, 10) });
    return;
  }
  const body = parsed.data;
  try {
    await db.insert(weeklyReportsTable).values({
      kind: body.kind, season: body.season, week: body.week,
      generatedAt: new Date(body.generatedAt), payload: body.payload,
    }).onConflictDoNothing();
    res.status(201).json({ stored: body.kind });
  } catch (error) {
    req.log.error({ error }, "Weekly report ingest failed");
    res.status(500).json({ error: "Weekly report ingest failed" });
  }
});

async function latestReport(kind: "usage" | "replay", req: import("express").Request, res: import("express").Response) {
  try {
    const [latest] = await db.select().from(weeklyReportsTable)
      .where(eq(weeklyReportsTable.kind, kind))
      .orderBy(desc(weeklyReportsTable.generatedAt)).limit(1);
    if (!latest) {
      res.json({ status: "unavailable", season: null, week: null, generatedAt: null, report: null });
      return;
    }
    let report = latest.payload;
    if (kind === "replay") {
      // A replayed week must never sit next to that week's real, timestamped
      // picks: keep only weeks before the first live TD pick run.
      const [firstLive] = await db.select({ week: touchdownPickRunsTable.week }).from(touchdownPickRunsTable)
        .where(eq(touchdownPickRunsTable.season, latest.season)).orderBy(asc(touchdownPickRunsTable.week)).limit(1);
      const weeks = (report as { weeks?: Array<{ week: number }> }).weeks;
      if (firstLive && Array.isArray(weeks)) report = { ...report, weeks: weeks.filter((week) => week.week < firstLive.week) };
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      status: "available", season: latest.season, week: latest.week,
      generatedAt: latest.generatedAt.toISOString(), report,
    });
  } catch (error) {
    req.log.error({ error, kind }, "Weekly report read failed");
    res.status(503).json({ error: "Report is being refreshed", code: "consumer_data_unavailable" });
  }
}

router.get("/consumer/usage-report", (req, res) => latestReport("usage", req, res));
router.get("/consumer/replay", (req, res) => latestReport("replay", req, res));

/**
 * The failure message for the token-protected capture routes, so the workflow
 * log shows what went wrong. The Odds API key is scrubbed from the text.
 */
function describeError(error: unknown) {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current));
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : null;
  }
  let text = parts.join(" <- ") || "Unknown error";
  const key = process.env.ODDS_API_KEY;
  if (key) text = text.split(key).join("***");
  return text.replace(/apiKey=[^&\s"]+/g, "apiKey=***").slice(0, 400);
}

/**
 * Scheduled sportsbook capture, called by the GitHub "Odds" workflow. It uses
 * the server's own ODDS_API_KEY and the same quota and billing safeguards as
 * the data worker. Calls in the same 10-minute slot share one intent, so a
 * retried workflow run can never pay twice.
 */
router.post("/odds/scheduled-capture", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const slot = new Date(Math.floor(Date.now() / 600_000) * 600_000);
  try {
    // GitHub's cron often runs hours late. When the site's kickoff clock (or an
    // earlier run) captured recently, a late backup run must not pay again.
    const recent = req.query.force === "1" ? null : await recentOddsCapture(ODDS_BACKUP_RECENT_MS);
    if (recent) {
      res.json({ status: "skipped", reason: `Lines were captured at ${recent.toISOString()}; this backup run is not needed.` });
      return;
    }
    const quota = oddsCaptureQuotaDecision(await getOddsSchedulingBalance());
    if (!quota.safe) {
      res.json({ status: "skipped", reason: quota.reason, creditsRemaining: quota.creditsRemaining ?? null });
      return;
    }
    const result = await captureOddsSnapshots({ jobKey: "github-odds", scheduledFor: slot });
    res.status(result.status === "failed" ? 502 : result.status === "not_configured" ? 503 : 200).json({
      status: result.status, reason: result.error ?? result.skipReason, snapshotsCreated: result.snapshotsCreated,
      recordsReceived: result.recordsReceived, unmatchedEvents: result.unmatchedEvents,
      creditsUsed: result.creditsUsed, creditsRemaining: result.creditsRemaining,
    });
  } catch (error) {
    const reason = describeError(error);
    req.log.error({ error: reason }, "Scheduled odds capture failed");
    res.status(502).json({ status: "failed", reason });
  }
});

/** Anytime-TD prices for games starting within `hours` (GitHub "Odds" workflow). */
router.post("/odds/td-props-capture", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const hours = parseInteger(req.query.hours, 1, 96);
  if (hours === null) {
    res.status(400).json({ error: "hours must be 1-96" });
    return;
  }
  try {
    const result = await captureTouchdownProps(hours ?? 30);
    res.status(result.status === "failed" ? 502 : result.status === "not_configured" ? 503 : 200).json(result);
  } catch (error) {
    const reason = describeError(error);
    req.log.error({ error: reason }, "TD props capture failed");
    res.status(502).json({ status: "failed", reason });
  }
});

/**
 * Kickoff forecasts from the National Weather Service (free, keyless), called
 * by the GitHub "Weather" workflow. Without this, forecasts only refresh when
 * the data worker runs. Shares the worker's weather lock, so the two never
 * overlap.
 */
router.post("/weather/scheduled-capture", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  try {
    const result = await withFeedLock("weather", () => syncNwsWeather({ jobKey: "github-weather" }));
    if (!result) {
      res.json({ status: "skipped", reason: "A weather sync is already running" });
      return;
    }
    res.status(result.status === "failed" ? 502 : 200).json({
      status: result.status, inserted: result.inserted, requests: result.requests,
      failures: result.failures.slice(0, 20), horizon: result.horizon,
    });
  } catch (error) {
    const reason = describeError(error);
    req.log.error({ error: reason }, "Scheduled weather capture failed");
    res.status(502).json({ status: "failed", reason });
  }
});

/**
 * When each feed last updated, for the "Updated" line on the home page. A
 * stale time there is the first sign a scheduled workflow stopped running.
 */
const FRESHNESS_FEEDS = { scores: "espn-schedule", injuries: "espn-injuries", weather: "nws-weather", stats: "nflverse" } as const;
router.get("/consumer/freshness", async (_req, res): Promise<void> => {
  const entries = await Promise.all(Object.entries(FRESHNESS_FEEDS).map(async ([feed, provider]) => {
    const [latest] = await db.select({ completedAt: dataSyncRunsTable.completedAt }).from(dataSyncRunsTable)
      .where(and(eq(dataSyncRunsTable.provider, provider), inArray(dataSyncRunsTable.status, ["success", "partial"]), isNotNull(dataSyncRunsTable.completedAt)))
      .orderBy(desc(dataSyncRunsTable.completedAt)).limit(1);
    return [feed, latest?.completedAt?.toISOString() ?? null] as const;
  }));
  res.set("Cache-Control", "public, max-age=120");
  res.json(Object.fromEntries(entries));
});

/**
 * The latest kickoff-hour forecast for each game in the next ten days, read by
 * the weekly picks workflow so projected totals use the forecast wind and
 * temperature instead of calm 65F. Indoor games come back with nulls.
 */
const finite = (value: number | null) => (value !== null && Number.isFinite(value) ? value : null);

router.get("/weather/kickoff-forecasts", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const now = new Date();
  const games = await db.select({ gameId: gamesTable.gameId, kickoff: gamesTable.kickoffTime }).from(gamesTable)
    .where(and(gte(gamesTable.kickoffTime, new Date(now.getTime() - 6 * 3_600_000)),
      lte(gamesTable.kickoffTime, new Date(now.getTime() + 10 * 86_400_000))));
  const kickoffs = new Map(games.flatMap(game => game.kickoff ? [[game.gameId, game.kickoff.getTime()] as const] : []));
  const rows = kickoffs.size === 0 ? [] : await db.select().from(weatherForecastSnapshotsTable)
    .where(inArray(weatherForecastSnapshotsTable.gameId, [...kickoffs.keys()]))
    .orderBy(desc(weatherForecastSnapshotsTable.fetchedAt));
  // Newest capture first; within it, the forecast hour nearest kickoff.
  const best = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const kickoff = kickoffs.get(row.gameId)!;
    const gap = Math.abs(row.validTime.getTime() - kickoff);
    if (gap > 2 * 3_600_000) continue;
    const current = best.get(row.gameId);
    if (!current) { best.set(row.gameId, row); continue; }
    if (current.fetchedAt.getTime() !== row.fetchedAt.getTime()) continue;
    if (gap < Math.abs(current.validTime.getTime() - kickoff)) best.set(row.gameId, row);
  }
  res.set("Cache-Control", "no-store");
  res.json({
    forecasts: [...best.values()].map(row => ({
      gameId: row.gameId, indoorOutdoor: row.indoorOutdoor, temperature: finite(row.temperature),
      sustainedWind: finite(row.sustainedWind), validTime: row.validTime.toISOString(), fetchedAt: row.fetchedAt.toISOString(),
    })),
  });
});

/**
 * This season's nflverse play-by-play, player stats, snaps and depth charts,
 * called by the GitHub "Stats" workflow. Team charts only count a week once
 * every game has team stats, and without this those stats only load when the
 * data worker runs. The import takes minutes, so it runs in the background;
 * the workflow follows it with GET /nflverse/refresh-status.
 */
router.post("/nflverse/scheduled-refresh", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const season = footballTime(new Date()).season;
  let signalStart: () => void = () => undefined;
  const startedSignal = new Promise<"started">((resolve) => { signalStart = () => resolve("started"); });
  const job = withFeedLock("nflverse", async () => {
    signalStart();
    const result = await syncNflverseHistory([season], { jobKey: "github-stats", refresh: true });
    // Matchup Board numbers come from pregame team features, which the data
    // worker rebuilt after each import. Rebuild them here too.
    if ((result as { status?: string } | null)?.status === "success") {
      try {
        await rebuildPregameFeatures(undefined, new Date(), { futureOnly: true });
      } catch (error) {
        req.log.error({ error: describeError(error) }, "Pregame feature rebuild after nflverse refresh failed");
      }
    }
    return result;
  });
  job.catch((error) => req.log.error({ error: describeError(error) }, "Scheduled nflverse refresh failed"));
  // withFeedLock resolves null at once when another import holds the lock.
  const outcome = await Promise.race([startedSignal, job.then(() => "busy" as const, () => "error" as const)]);
  if (outcome === "started") res.status(202).json({ status: "started", season });
  else if (outcome === "busy") res.json({ status: "skipped", reason: "An nflverse import is already running", season });
  else res.status(502).json({ status: "failed", reason: "Could not start the nflverse import", season });
});

router.get("/nflverse/refresh-status", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  const [latest] = await db.select().from(dataSyncRunsTable)
    .where(eq(dataSyncRunsTable.provider, "nflverse"))
    .orderBy(desc(dataSyncRunsTable.startedAt)).limit(1);
  res.json(latest ? {
    status: latest.status, startedAt: latest.startedAt.toISOString(),
    completedAt: latest.completedAt?.toISOString() ?? null,
    recordsProcessed: latest.recordsProcessed, error: latest.errorMessage?.slice(0, 600) ?? null,
  } : { status: "none" });
});

/**
 * Game status and final scores from ESPN, called by the GitHub "Scores"
 * workflow. Pick records, receipts, the watch list and "Final" labels all
 * read these; without this they only update when the data worker runs.
 */
router.post("/schedule/scheduled-refresh", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  try {
    const result = await syncEspnScheduleCoverage({ jobKey: "github-scores" });
    res.status(result.status === "failed" ? 502 : 200).json({
      status: result.status, season: result.season, currentWeek: result.currentWeek,
      gamesByWeek: result.gamesByWeek, failures: result.failures.slice(0, 10),
    });
  } catch (error) {
    const reason = describeError(error);
    req.log.error({ error: reason }, "Scheduled score refresh failed");
    res.status(502).json({ status: "failed", reason });
  }
});

/** The ESPN injury report alone (GitHub "Weather" workflow), so it refreshes through the day. */
router.post("/injuries/scheduled-capture", async (req, res): Promise<void> => {
  if (!authorizeIngest(req, res)) return;
  try {
    const result = await withFeedLock("injuries", () => syncEspnInjuries({ jobKey: "github-injuries" }));
    if (!result) {
      res.json({ status: "skipped", reason: "An injury sync is already running" });
      return;
    }
    res.json(result);
  } catch (error) {
    const reason = describeError(error);
    req.log.error({ error: reason }, "Scheduled injury capture failed");
    res.status(502).json({ status: "failed", reason });
  }
});

/**
 * Depth charts (Sleeper, mapped to nflverse IDs) and the ESPN injury report,
 * called by the GitHub "Players" workflow. Game pages' likely roles, defensive
 * personnel and player matchups come from these. Runs in the background; the
 * workflow follows it with GET /personnel/refresh-status.
 */
router.post("/personnel/scheduled-refresh", (req, res): void => {
  if (!authorizeIngest(req, res)) return;
  if (startPersonnelRefresh()) res.status(202).json({ status: "started" });
  else res.json({ status: "skipped", reason: "A personnel refresh is already running" });
});

router.get("/personnel/refresh-status", (req, res): void => {
  if (!authorizeIngest(req, res)) return;
  res.json(personnelRefreshStatus() ?? { status: "none" });
});

/** This week's TD picks card (research/td-model/share_card.py), the TD Picks link preview. */
router.get("/share/td-card.png", async (req, res): Promise<void> => {
  try {
    const [latest] = await db.select({ payload: weeklyReportsTable.payload }).from(weeklyReportsTable)
      .where(eq(weeklyReportsTable.kind, "share-td"))
      .orderBy(desc(weeklyReportsTable.generatedAt)).limit(1);
    const png = typeof latest?.payload.png === "string" ? Buffer.from(latest.payload.png, "base64") : null;
    if (!png?.length) {
      res.redirect(302, "/gridline-share.png");
      return;
    }
    res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" }).send(png);
  } catch (error) {
    req.log.error({ error }, "Share card read failed");
    res.redirect(302, "/gridline-share.png");
  }
});

export default router;
