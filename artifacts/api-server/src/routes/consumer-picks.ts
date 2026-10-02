import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as zod from "zod/v4";
import {
  db, gameProjectionRunsTable, gamesTable, sportsbookOddsTable, teamsTable, touchdownPickResultsTable,
  touchdownPickRunsTable, weeklyReportsTable,
} from "@workspace/db";
import {
  favoriteRecord, lineValueGames, lineValueSummary, projectionsBeforeKickoff, winnerRecord, type SpreadQuote,
} from "../lib/game-projections";
import { boardForWeek, fairAmericanOdds, topTenRecord } from "../lib/touchdown-board";
import { captureOddsSnapshots, getOddsSchedulingBalance, oddsCaptureQuotaDecision } from "../lib/odds";
import { bestBookPrice, captureTouchdownProps, latestTouchdownProps } from "../lib/td-props";

const router: IRouter = Router();

function parseInteger(value: unknown, min: number, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

const isFinal = (status: string | null) => /final|completed/i.test(status ?? "");

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
    const props = await latestTouchdownProps(selected.season, selected.week).catch(() => null);
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
      picks: board.map((entry, index) => ({
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
        bookOdds: bestBookPrice(props, entry.name, entry.team),
      })),
      weeks: available,
      record: topTenRecord([...boards.entries()]
        .map(([weekNumber, weekBoard]) => ({ week: weekNumber, board: weekBoard, results: resultsByWeek.get(weekNumber) ?? new Map() }))),
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

const squash = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a sportsbook selection ("Kansas City Chiefs") names this team. */
function spreadSide(selection: string, team: { teamName: string; abbreviation: string } | undefined) {
  if (!team) return false;
  const value = squash(selection);
  return value === squash(team.teamName) || value === squash(team.abbreviation);
}

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
        lineValue: lineValueSummary([]), weeks: [] });
      return;
    }
    const runs = await db.select().from(gameProjectionRunsTable)
      .where(eq(gameProjectionRunsTable.season, selectedSeason)).orderBy(asc(gameProjectionRunsTable.generatedAt));
    const projections = projectionsBeforeKickoff(runs);
    const ids = [...projections.keys()];
    const finals = new Map<string, { home: number; away: number; week: number }>();
    const quotesByGame = new Map<string, SpreadQuote[]>();
    if (ids.length) {
      const rows = await db.select().from(gamesTable).where(eq(gamesTable.season, selectedSeason));
      for (const row of rows) {
        if (ids.includes(row.gameId) && isFinal(row.gameStatus) && row.finalHomeScore !== null && row.finalAwayScore !== null) {
          finals.set(row.gameId, { home: row.finalHomeScore, away: row.finalAwayScore, week: row.week });
        }
      }
      const teams = new Map((await db.select().from(teamsTable)).map((team) => [team.teamId, team]));
      const sides = new Map(rows.filter((row) => ids.includes(row.gameId)).map((row) => [row.gameId, {
        home: teams.get(row.homeTeamId), away: teams.get(row.awayTeamId),
      }]));
      const odds = await db.select({
        gameId: sportsbookOddsTable.gameId, sportsbook: sportsbookOddsTable.sportsbook, selection: sportsbookOddsTable.selection,
        point: sportsbookOddsTable.point, capturedAt: sportsbookOddsTable.capturedAt,
      }).from(sportsbookOddsTable)
        .where(and(eq(sportsbookOddsTable.market, "spread"), inArray(sportsbookOddsTable.gameId, [...sides.keys()])));
      for (const row of odds) {
        const side = sides.get(row.gameId);
        if (row.point === null || !side) continue;
        const homeLine = spreadSide(row.selection, side.home) ? row.point : spreadSide(row.selection, side.away) ? -row.point : null;
        if (homeLine === null) continue;
        const list = quotesByGame.get(row.gameId) ?? [];
        list.push({ sportsbook: row.sportsbook, capturedAt: row.capturedAt, homeLine });
        quotesByGame.set(row.gameId, list);
      }
    }
    const record = winnerRecord(projections.values(), finals);
    const lineValue = lineValueSummary(lineValueGames(runs, quotesByGame, finals));
    const newest = runs.at(-1);
    res.json({
      status: runs.length ? "available" : "unavailable",
      season: selectedSeason,
      modelVersion: newest?.modelVersion ?? null,
      generatedAt: newest?.generatedAt.toISOString() ?? null,
      evaluation: newest?.evaluation ?? {},
      games: [...projections.values()].map(({ generatedAt, ...game }) => ({ ...game, projectedAt: generatedAt.toISOString() })),
      record: record.total,
      favoriteRecord: favoriteRecord(projections.values(), finals),
      lineValue,
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
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      status: "available", season: latest.season, week: latest.week,
      generatedAt: latest.generatedAt.toISOString(), report: latest.payload,
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
