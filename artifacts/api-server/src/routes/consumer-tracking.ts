import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, gameProjectionRunsTable, touchdownPickResultsTable, touchdownPickRunsTable } from "@workspace/db";
import { lockedAt, openerWatch, projectionsBeforeKickoff, watchAlerts } from "../lib/game-projections";
import { loadSeasonProjectionData } from "../lib/projection-data";
import { boardForWeek } from "../lib/touchdown-board";

const router: IRouter = Router();

function parseSeason(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1990 && number <= 2200 ? number : null;
}

async function latestSeason() {
  const [latest] = await db.select({ season: gameProjectionRunsTable.season }).from(gameProjectionRunsTable)
    .orderBy(desc(gameProjectionRunsTable.generatedAt)).limit(1);
  return latest?.season;
}

/**
 * Every projection and top-5 touchdown pick as it was locked in before
 * kickoff, with the time the site received it and the result. Runs are
 * append-only; the weekly workflow also commits each payload to the public
 * `receipts` branch, so anyone can check a pick was posted before the game.
 */
router.get("/consumer/receipts", async (req, res): Promise<void> => {
  const requested = parseSeason(req.query.season);
  if (requested === null) {
    res.status(400).json({ error: "Invalid season" });
    return;
  }
  try {
    const seasons = (await db.selectDistinct({ season: gameProjectionRunsTable.season }).from(gameProjectionRunsTable)
      .orderBy(desc(gameProjectionRunsTable.season))).map((row) => row.season);
    const season = requested ?? seasons[0];
    if (season === undefined) {
      res.json({ status: "unavailable", season: null, seasons, games: [], touchdowns: [], runs: [] });
      return;
    }
    const { runs, finals, quotesByGame } = await loadSeasonProjectionData(season);
    const weekOf = new Map<string, number>();
    for (const run of runs) for (const game of run.games) weekOf.set(game.gameId, run.week);
    const games = [...projectionsBeforeKickoff(runs).values()].map((game) => {
      const final = finals.get(game.gameId) ?? null;
      const quotes = (quotesByGame.get(game.gameId) ?? []).filter((quote) => quote.capturedAt <= game.lockedAt);
      const line = ["DraftKings", "FanDuel"].map((book) => quotes.filter((quote) => quote.sportsbook === book)
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()).at(-1)).find(Boolean) ?? null;
      const actual = final ? final.home - final.away : null;
      return {
        week: weekOf.get(game.gameId) ?? final?.week ?? null,
        gameId: game.gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, kickoff: game.kickoff,
        lockedAt: game.lockedAt.toISOString(),
        projectedMargin: game.projectedMargin, projectedTotal: game.projectedTotal, homeWinProbability: game.homeWinProbability,
        line: line ? { sportsbook: line.sportsbook, homeLine: line.homeLine, capturedAt: line.capturedAt.toISOString() } : null,
        final: final ? { home: final.home, away: final.away } : null,
        winner: actual === null || game.projectedMargin === 0 ? null
          : actual === 0 ? "push" : (actual > 0) === (game.projectedMargin > 0) ? "win" : "loss",
      };
    }).sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "") || a.gameId.localeCompare(b.gameId));

    const tdRuns = await db.select().from(touchdownPickRunsTable)
      .where(eq(touchdownPickRunsTable.season, season)).orderBy(asc(touchdownPickRunsTable.generatedAt));
    const results = await db.select().from(touchdownPickResultsTable).where(eq(touchdownPickResultsTable.season, season));
    const scored = new Map(results.map((row) => [`${row.week}|${row.playerId}`, row.scored]));
    const now = new Date();
    const touchdowns = [...new Set(tdRuns.map((run) => run.week))].sort((a, b) => a - b).flatMap((week) =>
      boardForWeek(tdRuns.filter((run) => run.week === week), now).slice(0, 5).map((entry, index) => ({
        week, rank: index + 1, playerId: entry.playerId, name: entry.name, position: entry.position, team: entry.team,
        opponent: entry.opponent, kickoff: entry.kickoff, probability: entry.probability, lockedAt: entry.lockedAt.toISOString(),
        scored: scored.has(`${week}|${entry.playerId}`) ? scored.get(`${week}|${entry.playerId}`)! : null,
      })));
    const runLog = [
      ...runs.map((run) => ({ kind: "games" as const, week: run.week, generatedAt: run.generatedAt, receivedAt: run.receivedAt })),
      ...tdRuns.map((run) => ({ kind: "touchdowns" as const, week: run.week, generatedAt: run.generatedAt, receivedAt: run.receivedAt })),
    ].sort((a, b) => lockedAt(b).getTime() - lockedAt(a).getTime())
      .map((run) => ({ ...run, generatedAt: run.generatedAt.toISOString(), receivedAt: run.receivedAt.toISOString() }));
    res.set("Cache-Control", "public, max-age=300");
    res.json({ status: "available", season, seasons, games, touchdowns, runs: runLog });
  } catch (error) {
    req.log.error({ error }, "Receipts read failed");
    res.status(503).json({ error: "Receipts are being refreshed", code: "consumer_data_unavailable" });
  }
});

/**
 * Public ntfy.sh topic for phone notifications (set NTFY_TOPIC on the server).
 * The site shows it so visitors can subscribe in the ntfy app; the Odds
 * workflow posts each new alert to it.
 */
function ntfyTopic() {
  const topic = process.env.NTFY_TOPIC?.trim();
  return topic && /^[A-Za-z0-9_-]{1,64}$/.test(topic) ? topic : null;
}

async function currentAlerts(since: Date) {
  const season = await latestSeason();
  if (season === undefined) return [];
  const { runs, finals, quotesByGame } = await loadSeasonProjectionData(season);
  return watchAlerts(openerWatch(runs, quotesByGame, finals, new Date()), quotesByGame, since);
}

/**
 * Watch-list alerts since a time: games newly 4+ points off the opener, and
 * watch-list lines moving a point or more. `since` (an ISO time, at most two
 * weeks back) wins over `hours` (default 3). The Odds and Weekly picks
 * workflows ask for alerts since their own start, so each alert is sent once,
 * and post each one to the ntfy topic when one is configured.
 */
router.get("/consumer/watch-alerts", async (req, res): Promise<void> => {
  const now = Date.now();
  let since: number;
  if (typeof req.query.since === "string") {
    since = Date.parse(req.query.since);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(req.query.since) || Number.isNaN(since) || since > now || since < now - 14 * 86_400_000) {
      res.status(400).json({ error: "since must be an ISO time within the last two weeks" });
      return;
    }
  } else {
    const hours = typeof req.query.hours === "string" && /^\d{1,3}$/.test(req.query.hours) ? Number(req.query.hours) : 3;
    if (hours < 1 || hours > 336) {
      res.status(400).json({ error: "hours must be 1-336" });
      return;
    }
    since = now - hours * 3_600_000;
  }
  try {
    const alerts = await currentAlerts(new Date(since));
    res.set("Cache-Control", "no-store");
    res.json({
      alerts: alerts.map((alert) => ({ ...alert, at: alert.at.toISOString() })),
      ntfyTopic: ntfyTopic(),
    });
  } catch (error) {
    req.log.error({ error }, "Watch alerts read failed");
    res.status(503).json({ error: "Alerts are being refreshed", code: "consumer_data_unavailable" });
  }
});

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS feed of the last week's watch-list alerts, for any feed reader. */
router.get("/feeds/watch-list.xml", async (req, res): Promise<void> => {
  try {
    const alerts = await currentAlerts(new Date(Date.now() - 7 * 86_400_000));
    const origin = `${req.protocol}://${req.get("host")}`;
    const titles = { flagged: "New watch-list game", "moved-toward": "Line moved toward Gridline", "moved-away": "Line moved away from Gridline" };
    const items = alerts.map((alert) => `<item><title>${xml(titles[alert.kind])}</title><description>${xml(alert.message)}</description>`
      + `<link>${xml(`${origin}/performance#watch-list`)}</link><guid isPermaLink="false">${xml(`${alert.kind}-${alert.gameId}-${alert.at.toISOString()}`)}</guid>`
      + `<pubDate>${alert.at.toUTCString()}</pubDate></item>`).join("");
    res.set({ "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600" });
    res.send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Gridline watch list</title>`
      + `<link>${xml(`${origin}/performance#watch-list`)}</link><description>Games where Gridline's line is 4+ points off the opener, and when those lines move.</description>${items}</channel></rss>`);
  } catch (error) {
    req.log.error({ error }, "Watch-list feed failed");
    res.status(503).type("text/plain").send("Feed is being refreshed");
  }
});

export default router;
