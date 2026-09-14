// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { buildPregameFeaturesForTesting } from "../../artifacts/api-server/src/lib/features.ts";

type TestRow = Record<string, unknown> & {
  gameId: string;
  season: number;
  week: number;
  kickoffTime: Date;
  gameDate: string;
};

function row(gameId: string, season: number, week: number, kickoffTime: string, epaPerPlay: number): TestRow {
  return {
    gameId,
    season,
    week,
    kickoffTime: new Date(kickoffTime),
    gameDate: kickoffTime.slice(0, 10),
    teamId: "TST",
    opponentTeamId: "OPP",
    isHome: true,
    plays: 50,
    epaPerPlay,
    passEpaPerDropback: epaPerPlay,
    rushEpaPerRush: epaPerPlay,
    offensiveSuccessRate: 0.5,
    passingSuccessRate: 0.5,
    rushingSuccessRate: 0.5,
    defensiveEpaAllowedPerPlay: -epaPerPlay,
    defensiveSuccessRate: 0.5,
    yardsPerPlay: 5,
    turnovers: 1,
    sackRateAllowed: 0.05,
    earlyDownEpaPerPlay: epaPerPlay,
    earlyDownPassRate: 0.5,
    earlyDownSuccessRate: 0.5,
    secondsPerPlay: 25,
    explosivePassRate: 0.1,
    explosiveRushRate: 0.1,
    passEpaAllowed: -epaPerPlay,
    rushEpaAllowed: -epaPerPlay,
    passSuccessRateAllowed: 0.5,
    rushSuccessRateAllowed: 0.5,
    defensiveSackRate: 0.05,
    earlyDownDefensiveEpa: -epaPerPlay,
    explosivePassRateAllowed: 0.1,
    explosiveRushRateAllowed: 0.1,
    thirdDownRate: 0.4,
    redZoneRate: 0.5,
    neutralScriptPassRate: 0.6,
  } as TestRow;
}

const seasons = [2021, 2022, 2023, 2024, 2025, 2026];

for (const season of seasons) {
  test(`${season}: pregame features exclude current and future regular-season data`, () => {
    const target = row(`${season}_19_TARGET`, season, 19, `${season + 1}-01-15T19:00:00.000Z`, 99);
    const sameKickoffFuture = row(`${season}_19_SAME_KICKOFF`, season, 19, `${season + 1}-01-15T19:00:00.000Z`, 88);
    const future = row(`${season}_20_FUTURE`, season, 20, `${season + 1}-01-22T19:00:00.000Z`, 77);
    const prior = [
      row(`${season}_18_PRIOR_A`, season, 18, `${season + 1}-01-08T19:00:00.000Z`, 0.2),
      row(`${season}_17_PRIOR_B`, season, 17, `${season + 1}-01-01T19:00:00.000Z`, 0.1),
      row(`${season}_16_PRIOR_C`, season, 16, `${season}-12-25T19:00:00.000Z`, 0.0),
      row(`${season}_15_PRIOR_D`, season, 15, `${season}-12-18T19:00:00.000Z`, -0.1),
      target,
      sameKickoffFuture,
      future,
    ];
    const result = buildPregameFeaturesForTesting({
      season,
      targetKickoff: target.kickoffTime,
      teamRows: prior,
      opponentRows: prior.map((item) => ({ ...item, teamId: "OPP", opponentTeamId: "TST" })) as TestRow[],
    });
    assert.equal(result.eligibleGameIds.includes(target.gameId), false, "current game leaked");
    assert.equal(result.eligibleGameIds.includes(sameKickoffFuture.gameId), false, "same-kickoff game leaked");
    assert.equal(result.eligibleGameIds.includes(future.gameId), false, "future game leaked");
    assert.deepEqual(result.eligibleGameIds.slice(0, 3), [
      `${season}_18_PRIOR_A`,
      `${season}_17_PRIOR_B`,
      `${season}_16_PRIOR_C`,
    ]);
    assert.ok(Math.abs(result.features["season_to_date.epa_per_play"] - 0.05) < 1e-9);
    assert.ok(Math.abs(result.features["last_3.epa_per_play"] - 0.1) < 1e-9);
    assert.equal(result.featureAudit["season_to_date.epa_per_play"].lastSourceGame, `${season}_18_PRIOR_A`);
  });
}

test("post-kickoff injury and sportsbook snapshots cannot enter the current feature set", () => {
  const target = row("2024_19_TARGET", 2024, 19, "2024-01-15T19:00:00.000Z", 99);
  const result = buildPregameFeaturesForTesting({
    season: 2024,
    targetKickoff: target.kickoffTime,
    teamRows: [row("2024_18_PRIOR", 2024, 18, "2024-01-08T19:00:00.000Z", 0.2), target],
  });
  const auditSources = Object.values(result.featureAudit).map((entry) => entry.sourceDataset);
  assert.equal(auditSources.includes("injuries"), false);
  assert.equal(auditSources.includes("sportsbook"), false);
  assert.equal(result.features["last_3.epa_per_play"], 0.2);
});