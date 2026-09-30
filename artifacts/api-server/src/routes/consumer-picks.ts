import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import * as zod from "zod/v4";
import {
  db, gameProjectionRunsTable, gamesTable, predictionSnapshotsTable, touchdownPickResultsTable, touchdownPickRunsTable,
} from "@workspace/db";
import { projectionsBeforeKickoff, winnerRecord } from "../lib/game-projections";
import { isEligiblePredictionSnapshot } from "../lib/live-predictions";
import { addResult, emptyRecordLine, gradePicks, picksForProjection } from "../lib/pick-grading";
import { boardForWeek, fairAmericanOdds, topTenRecord } from "../lib/touchdown-board";

const router: IRouter = Router();

function parseInteger(value: unknown, min: number, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return null;
  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

const isFinal = (status: string | null) => /final|completed/i.test(status ?? "");

router.get("/consumer/record", async (req, res): Promise<void> => {
  const requested = parseInteger(req.query.season, 1990, 2200);
  if (requested === null) {
    res.status(400).json({ error: "Invalid season" });
    return;
  }
  try {
    const rows = await db.select({ snapshot: predictionSnapshotsTable, game: gamesTable })
      .from(predictionSnapshotsTable)
      .innerJoin(gamesTable, eq(gamesTable.gameId, predictionSnapshotsTable.gameId))
      .where(eq(predictionSnapshotsTable.officialFinalPrediction, true))
      .orderBy(desc(predictionSnapshotsTable.predictionTimestamp), desc(predictionSnapshotsTable.id));
    const latestPerGame = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestPerGame.has(row.game.gameId) && isEligiblePredictionSnapshot(row.snapshot)) latestPerGame.set(row.game.gameId, row);
    }
    const graded = [...latestPerGame.values()].filter(({ game }) =>
      isFinal(game.gameStatus) && game.finalHomeScore !== null && game.finalAwayScore !== null);
    const seasons = [...new Set(graded.map(({ game }) => game.season))].sort((a, b) => b - a);
    const season = requested ?? seasons[0] ?? null;
    const winners = emptyRecordLine();
    const spread = emptyRecordLine();
    const total = emptyRecordLine();
    const weeks = new Map<number, { week: number; winners: ReturnType<typeof emptyRecordLine>; spread: ReturnType<typeof emptyRecordLine>; total: ReturnType<typeof emptyRecordLine> }>();
    let count = 0;
    let lastGradedAt: Date | null = null;
    for (const { snapshot, game } of graded) {
      if (game.season !== season) continue;
      const comparison = (snapshot.marketComparison ?? {}) as Record<string, any>;
      const projection = {
        margin: snapshot.projectedMargin,
        total: snapshot.projectedTotal,
        homeWinProbability: snapshot.homeWinProbability,
        spreadLine: typeof comparison.spread?.marketLine === "number" ? comparison.spread.marketLine : null,
        totalLine: typeof comparison.totals?.marketTotal === "number" ? comparison.totals.marketTotal : null,
      };
      const result = gradePicks(picksForProjection(projection), projection, game.finalHomeScore!, game.finalAwayScore!);
      const week = weeks.get(game.week) ?? { week: game.week, winners: emptyRecordLine(), spread: emptyRecordLine(), total: emptyRecordLine() };
      weeks.set(game.week, week);
      addResult(winners, result.winner); addResult(week.winners, result.winner);
      addResult(spread, result.spread); addResult(week.spread, result.spread);
      addResult(total, result.total); addResult(week.total, result.total);
      count += 1;
      const played = game.kickoffTime ?? game.gameDate;
      if (!lastGradedAt || played > lastGradedAt) lastGradedAt = played;
    }
    res.json({
      season, seasons, graded: count, winners, spread, total,
      weeks: [...weeks.values()].sort((a, b) => a.week - b.week),
      lastGradedAt: lastGradedAt?.toISOString() ?? null,
    });
  } catch (error) {
    req.log.error({ error }, "Consumer record read failed");
    res.status(503).json({ error: "Record is being refreshed", code: "consumer_data_unavailable" });
  }
});

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
      picks: [], weeks: available, record: { weeksGraded: 0, topTenPicks: 0, topTenHits: 0 },
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
      })),
      weeks: available,
      record: topTenRecord([...boards.entries()]
        .map(([weekNumber, weekBoard]) => ({ board: weekBoard, results: resultsByWeek.get(weekNumber) ?? new Map() }))),
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
});
const gameIngestSchema = zod.object({
  season: zod.number().int().min(2000).max(2200),
  week: zod.number().int().min(1).max(22),
  generatedAt: zod.string().datetime({ offset: true }),
  modelVersion: zod.string().min(1).max(120),
  evaluation: zod.record(zod.string(), zod.union([zod.number(), zod.string(), zod.null()])),
  games: zod.array(zod.object({
    gameId: zod.string().min(1).max(40),
    nflverseGameId: zod.string().min(1).max(40),
    homeTeam: zod.string().min(2).max(4),
    awayTeam: zod.string().min(2).max(4),
    kickoff: zod.string().datetime({ offset: true }).nullable(),
    projectedMargin: zod.number().min(-60).max(60),
    projectedTotal: zod.number().min(0).max(120),
    homeWinProbability: zod.number().min(0).max(1),
    homeQb: qbSchema,
    awayQb: qbSchema,
    factors: zod.object({
      qbEdge: factorSchema, teamEdge: factorSchema, passEdge: factorSchema, rushEdge: factorSchema,
      restDiff: factorSchema, neutralSite: zod.boolean(),
    }),
  })).max(32),
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
      modelVersion: body.modelVersion, evaluation: body.evaluation, games: body.games,
    }).onConflictDoNothing();
    res.status(201).json({ stored: body.games.length });
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
        record: { wins: 0, losses: 0, pushes: 0 }, weeks: [] });
      return;
    }
    const runs = await db.select().from(gameProjectionRunsTable)
      .where(eq(gameProjectionRunsTable.season, selectedSeason)).orderBy(asc(gameProjectionRunsTable.generatedAt));
    const projections = projectionsBeforeKickoff(runs);
    const ids = [...projections.keys()];
    const finals = new Map<string, { home: number; away: number; week: number }>();
    if (ids.length) {
      const rows = await db.select().from(gamesTable).where(eq(gamesTable.season, selectedSeason));
      for (const row of rows) {
        if (ids.includes(row.gameId) && isFinal(row.gameStatus) && row.finalHomeScore !== null && row.finalAwayScore !== null) {
          finals.set(row.gameId, { home: row.finalHomeScore, away: row.finalAwayScore, week: row.week });
        }
      }
    }
    const record = winnerRecord(projections.values(), finals);
    const newest = runs.at(-1);
    res.json({
      status: runs.length ? "available" : "unavailable",
      season: selectedSeason,
      modelVersion: newest?.modelVersion ?? null,
      generatedAt: newest?.generatedAt.toISOString() ?? null,
      evaluation: newest?.evaluation ?? {},
      games: [...projections.values()].map(({ generatedAt, ...game }) => ({ ...game, projectedAt: generatedAt.toISOString() })),
      record: record.total,
      weeks: [...record.weeks.entries()].sort(([a], [b]) => a - b).map(([week, line]) => ({ week, ...line })),
    });
  } catch (error) {
    req.log.error({ error }, "Consumer game projections read failed");
    res.status(503).json({ error: "Game projections are being refreshed", code: "consumer_data_unavailable" });
  }
});

export default router;
