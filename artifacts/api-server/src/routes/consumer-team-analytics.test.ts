import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, gamesTable, teamGameStatsTable, teamsTable } from "@workspace/db";
import { GetConsumerTeamAnalyticsResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { createConsumerTeamAnalyticsRouter } from "./consumer-team-analytics";

test("HTTP team analytics compares final, stat-covered persisted weeks against an independent provider fixture", async (t) => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("This fixture test must run against the development database only");
  }
  const season = 2000;
  const existing = await db.select({ gameId: gamesTable.gameId })
    .from(gamesTable).where(eq(gamesTable.season, season)).limit(1);
  assert.equal(existing.length, 0, "the isolated fixture season must not contain other games");

  const prefix = `team-route-${randomUUID()}`;
  const a = { id: `${prefix}-a`, code: `X${randomUUID().slice(0, 3).toUpperCase()}` };
  const b = { id: `${prefix}-b`, code: `Y${randomUUID().slice(0, 3).toUpperCase()}` };
  const ids = [1, 2, 3].map(week => `${prefix}-week-${week}`);
  let missingWeek = 2;
  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.use(createConsumerTeamAnalyticsRouter({
    async getWeeks(_season, throughWeek) {
      const matchup = (gameId: string) => ({
        gameId, homeTeamId: a.id, awayTeamId: b.id,
      });
      return Array.from({ length: throughWeek }, (_, index) => {
        const week = index + 1;
        return {
          week,
          games: week > 3 ? null : [
            matchup(ids[index]!),
            ...(week === missingWeek ? [matchup(`${prefix}-missing-${week}`)] : []),
          ],
        };
      });
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(teamGameStatsTable).where(inArray(teamGameStatsTable.gameId, ids));
    await db.delete(gamesTable).where(inArray(gamesTable.gameId, ids));
    await db.delete(teamsTable).where(inArray(teamsTable.teamId, [a.id, b.id]));
  });

  await db.insert(teamsTable).values([
    { teamId: a.id, abbreviation: a.code, teamName: "Fixture A" },
    { teamId: b.id, abbreviation: b.code, teamName: "Fixture B" },
  ]);
  await db.insert(gamesTable).values(ids.map((gameId, index) => ({
    gameId, season, week: index + 1,
    gameDate: new Date(`2000-09-${String(index + 4).padStart(2, "0")}T18:00:00Z`),
    kickoffTime: new Date(`2000-09-${String(index + 4).padStart(2, "0")}T18:00:00Z`),
    homeTeamId: a.id, awayTeamId: b.id, gameStatus: "STATUS_FINAL",
    finalHomeScore: 17, finalAwayScore: 10,
  })));
  await db.insert(teamGameStatsTable).values(ids.flatMap((gameId, index) => [
    { gameId, season, week: index + 1, teamId: a.id, opponentTeamId: b.id,
      isHome: true, epaPerPlay: .1 * (index + 1), defensiveEpaAllowedPerPlay: -.1 },
    { gameId, season, week: index + 1, teamId: b.id, opponentTeamId: a.id,
      isHome: false, epaPerPlay: -.1, defensiveEpaAllowedPerPlay: .1 },
  ]));

  const get = async (throughWeek: number) => {
    const query = new URLSearchParams({ season: String(season), throughWeek: String(throughWeek),
      window: "season", teams: `${a.code},${b.code}` });
    const response = await fetch(`http://127.0.0.1:${address.port}/consumer/team-analytics?${query}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 400));
    return GetConsumerTeamAnalyticsResponse.parse(body);
  };

  const secondWeekGap = await get(3);
  assert.deepEqual(secondWeekGap.coverage.weeks.map(week => [week.week, week.scheduledGames,
    week.finalGames, week.statGames, week.expectedGames, week.allFinal]), [
    [1, 1, 1, 1, 1, true], [2, 1, 1, 1, 2, false], [3, 1, 1, 1, 1, true],
  ]);
  assert.deepEqual(secondWeekGap.coverage.weeks[1]!.missingMatchups,
    [`${b.id} at ${a.id} (${prefix}-missing-2)`]);
  assert.match(secondWeekGap.coverage.partialReasons.join(" "), /Week 2 is missing 1 provider schedule matchup/);
  assert.deepEqual(secondWeekGap.teams.map(team => team.observations.map(item => item.week)), [[1], [1]]);

  missingWeek = 1;
  const firstWeekGap = await get(3);
  assert.equal(firstWeekGap.coverage.weeks[0]!.finalGames, 1);
  assert.equal(firstWeekGap.coverage.weeks[0]!.statGames, 1);
  assert.equal(firstWeekGap.coverage.weeks[0]!.expectedGames, 2);
  assert.equal(firstWeekGap.coverage.weeks[0]!.allFinal, false);
  assert.deepEqual(firstWeekGap.teams.map(team => team.observations), [[], []]);
});