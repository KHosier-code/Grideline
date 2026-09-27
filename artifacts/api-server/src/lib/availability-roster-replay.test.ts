import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import {
  db, pool, dataSyncRunsTable, espnRosterObservationsTable, gamesTable, identitySourceImportsTable,
  injuriesTable, nflversePlayerIdentitiesTable, nflverseSourceFilesTable, playerGameStatsTable, teamsTable,
} from "@workspace/db";
import { GetConsumerPlayerPositionMatchupResponse } from "@workspace/api-zod";
import { readPlayerEligibilityEvidence, qualifyPlayerEligibility } from "./availability-roster";
import { playerPositionMatchupHandler } from "../routes/consumer";
import { logger } from "./logger";

test("persisted as-of roster replay withholds player-position forecasts on conflicts and omissions", async (t) => {
  const target = await pool.query(
    "SELECT current_database() AS name, inet_server_addr()::text AS address, pg_is_in_recovery() AS replica",
  );
  assert.equal(process.env.GRIDLINE_ROSTER_REPLAY_FIXTURE, "1");
  assert.equal(target.rows[0]?.name, "gridline_roster_replay_fixture");
  assert.match(target.rows[0]?.address ?? "", /^127\.0\.0\.1(?:\/32)?$/);
  assert.equal(target.rows[0]?.replica, false);
  // All writes stay in the short-lived local cluster started by the test script.
  const prefix = randomUUID().replace(/-/g, "");
  const numeric = BigInt(`0x${prefix.slice(0, 12)}`).toString();
  const season = 3000 + Number(BigInt(`0x${prefix.slice(0, 12)}`) % 100000n);
  const homeId = `8${numeric}`;
  const awayId = `9${numeric}`;
  const home = `H${prefix.slice(0, 9).toUpperCase()}`;
  const away = `A${prefix.slice(0, 9).toUpperCase()}`;
  const playerId = `replay-${prefix}`;
  const latePlayerId = `late-${prefix}`;
  const providerId = `7${numeric}`;
  const gameId = `replay-game-${prefix}`;
  const at = (day: number, hour: number) => new Date(Date.UTC(2090, 8, day, hour));
  const kickoff = at(22, 18);
  const sourceUrl = `fixture://${prefix}`;
  let clock = at(20, 12);
  const app = express();
  app.use((req, _res, next) => { req.log = logger; next(); });
  app.get("/consumer/player-position-matchup", playerPositionMatchupHandler(() => clock));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  await db.insert(teamsTable).values([
    { teamId: homeId, abbreviation: home, teamName: "Replay Home" },
    { teamId: awayId, abbreviation: away, teamName: "Replay Away" },
  ]);
  await db.insert(gamesTable).values([
    ...[1, 2, 3].map((week) => ({
      gameId: `${gameId}-${week}`, season, week,
      gameDate: at(week + 1, 18), kickoffTime: at(week + 1, 18),
      homeTeamId: homeId, awayTeamId: awayId, gameStatus: "STATUS_FINAL",
    })),
    { gameId, season, week: 4, gameDate: kickoff, kickoffTime: kickoff,
      homeTeamId: homeId, awayTeamId: awayId, gameStatus: "STATUS_SCHEDULED" },
  ]);
  await db.insert(nflverseSourceFilesTable).values({
    dataset: "player_stats", season, sourceUrl, status: "success", completedAt: at(19, 12),
  });
  await db.insert(playerGameStatsTable).values([playerId, latePlayerId].flatMap((id) =>
    [1, 2, 3].map((week) => ({
      playerId: id, playerName: id, position: "WR", teamId: home, opponentTeamId: away,
      season, week, seasonType: "REG", targets: 6, receptions: 4,
      receivingYards: 50, sourceUpdatedAt: at(19, 12),
    }))));
  const [receipt] = await db.insert(identitySourceImportsTable).values({
    sourceNamespace: "test-fixture:nflverse", sourceUrl,
    sourceContentHash: prefix, canonicalRowsHash: prefix, rowCount: 2,
  }).returning({ id: identitySourceImportsTable.id });
  assert.ok(receipt);
  await db.insert(nflversePlayerIdentitiesTable).values([
    { importId: receipt.id, gsisId: playerId, displayName: playerId,
      espnId: providerId, rowFingerprint: `${prefix}-1`, observedAt: at(20, 10) },
    { importId: receipt.id, gsisId: latePlayerId, displayName: latePlayerId,
      espnId: `6${numeric}`, rowFingerprint: `${prefix}-2`, observedAt: at(20, 17) },
  ]);
  // The injury feed mentions a different player; omission cannot certify clearance.
  await db.insert(injuriesTable).values({
    playerId: `5${numeric}`, teamId: homeId, sourceHash: prefix,
    gameStatus: "Active", snapshotTimestamp: at(20, 11),
  });

  const teamIds = [homeId, awayId, ...Array.from({ length: 30 }, (_, i) => `${i + 1000}`)];
  const makeRun = async (observedAt: Date, assignment: string, complete = true) => {
    const startedAt = new Date(observedAt.getTime() - 60_000);
    const completedAt = new Date(observedAt.getTime() + 60_000);
    const rows = teamIds.map((teamId, i) => ({
      playerId: i === 0 ? providerId : `${i + 100000}`,
      teamId: i === 0 ? assignment : i === 1 && assignment === awayId ? homeId : teamId,
      playerName: `Replay ${i}`, position: "WR", activeStatus: "Active",
      sourcePath: `/teams/${i === 0 ? assignment : i === 1 && assignment === awayId ? homeId : teamId}/roster`,
      sourceHash: prefix, observedAt,
    }));
    // The later incomplete run has metadata claiming 32 teams, but a missing row.
    const stored = complete ? rows : rows.slice(0, -1);
    const [run] = await db.insert(dataSyncRunsTable).values({
      provider: "espn-complete-rosters", status: "success", startedAt, completedAt,
      recordsProcessed: 32,
      metadata: { retrievedAt: observedAt.toISOString(), observationKind: "complete-espn-rosters",
        responseComplete: true, teamCount: 32, teams: teamIds, observedCount: 32 },
    }).returning({ id: dataSyncRunsTable.id });
    assert.ok(run);
    await db.insert(espnRosterObservationsTable).values(stored.map((row) => ({ ...row, runId: run.id })));
  };
  await makeRun(at(20, 11), homeId);

  const evidence = (id = playerId) =>
    readPlayerEligibilityEvidence(id, home, away, gameId, clock, kickoff);
  const route = async (id = playerId) => {
    const selection = encodeURIComponent(`${id}:${home}`);
    const response = await fetch(`http://127.0.0.1:${address.port}/consumer/player-position-matchup?game=${gameId}&position=WR&window=season&player=${selection}`);
    const raw = await response.json();
    const body = GetConsumerPlayerPositionMatchupResponse.parse(raw);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.selected?.playerId, id, JSON.stringify(body.candidates));
    assert.ok(Object.values(body.projections).every((projection) =>
      (projection as { value: number | null }).value === null));
    return body.projections.receivingYards.reason as string;
  };
  let current = await evidence();
  assert.equal(current.roster?.team, home);
  assert.equal(current.gameRoster, null);
  assert.equal(current.injury, null);
  assert.match(await route(), /Game-specific active roster is missing/);
  assert.match(qualifyPlayerEligibility({ ...current, asOf: at(21, 21), gameRoster: {
    providerId, team: home, gameId, status: "Active", observedAt: at(21, 20),
    publicationAt: at(21, 19), sourceUrl: "fixture://independent-game-roster",
    sourceHash: `${prefix}-game`, complete: true,
  } }).reason, /Recent affirmative injury clearance is missing/);

  await makeRun(at(20, 13), awayId);
  clock = at(20, 14);
  current = await evidence();
  assert.equal(current.roster?.team, away);
  assert.match(qualifyPlayerEligibility(current).reason, /Current complete team roster/);
  assert.match(await route(), /Current complete team roster/);

  await makeRun(at(20, 15), homeId, false);
  clock = at(20, 16);
  current = await evidence();
  assert.equal(current.roster, null, "never fall back to the older valid run");
  assert.match(await route(), /Current complete team roster/);

  assert.equal((await evidence(latePlayerId)).identity, null, "post-cutoff mapping cannot qualify");
  assert.match(await route(latePlayerId), /Current player identity is missing/);
  clock = at(22, 16); // older than 48 hours, still before kickoff
  assert.equal((await evidence()).identity, null, "stale mapping cannot qualify");
  assert.match(await route(), /Current player identity is missing/);
});