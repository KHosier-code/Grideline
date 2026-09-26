import test from "node:test";
import assert from "node:assert/strict";
import {
  cutoffSafeRedZoneGames,
  coveredRedZoneWindow,
  deriveRedZoneGameFacts,
  groupRedZoneAppearancesByPlayerTeam,
  hasPlayerStatAppearance,
  redZoneShare,
  redZoneCoveragePeriodLabel,
  redZonePlayerFactForAppearance,
  redZoneReplacementGameIds,
  selectLastThreeAppearances,
  type RedZonePlay,
} from "./red-zone-opportunities";

const play = (overrides: Partial<RedZonePlay>): RedZonePlay => ({
  gameId: "grid-game", sourceGameId: "2026_01_BUF_HOU", season: 2026, week: 1,
  seasonType: "REG", playId: "1", teamId: "BUF", opponentTeamId: "HOU",
  yardline100: 20, passAttempt: false, rushAttempt: false, receiverId: null,
  rusherId: null, noPlay: false, twoPointAttempt: false, kneel: false,
  spike: false, passTouchdown: false, rushTouchdown: false, ...overrides,
});

test("zone boundaries overlap and targets include incomplete passes; carries count credited scrambles", () => {
  const result = deriveRedZoneGameFacts([
    play({ playId: "target20", passAttempt: true, receiverId: "wr", receiverName: "Receiver", yardline100: 20 }),
    play({ playId: "target10", passAttempt: true, receiverId: "wr", yardline100: 10 }),
    play({ playId: "target5", passAttempt: true, receiverId: "wr", yardline100: 5, passTouchdown: true }),
    play({ playId: "target5-other", passAttempt: true, receiverId: "other", yardline100: 5 }),
    play({ playId: "scramble", rushAttempt: true, rusherId: "qb", rusherName: "Quarterback", yardline100: 5, rushTouchdown: true }),
    play({ playId: "outside", passAttempt: true, receiverId: "wr", yardline100: 21 }),
  ]);
  const at20 = result.players.find((fact) => fact.playerId === "wr" && fact.zone === 20)!;
  const at10 = result.players.find((fact) => fact.playerId === "wr" && fact.zone === 10)!;
  const at5 = result.players.find((fact) => fact.playerId === "wr" && fact.zone === 5)!;
  const qb = result.players.find((fact) => fact.playerId === "qb" && fact.zone === 5)!;
  assert.equal(at20.targets, 3);
  assert.equal(at10.targets, 2);
  assert.equal(at5.receivingTouchdowns, 1);
  assert.equal(qb.carries, 1);
  assert.equal(qb.rushingTouchdowns, 1);
  const fiveYardTeam = result.teams.find((fact) => fact.zone === 5)!;
  assert.equal(fiveYardTeam.targets, 2);
  assert.equal(redZoneShare(at5.targets, fiveYardTeam.targets), 0.5);
  assert.equal(result.teams.find((fact) => fact.zone === 5)?.carries, 1);
});

test("two-point, kneel, spike, no-play, null yardline, and uncredited attempts are excluded", () => {
  const excluded = [
    play({ playId: "2pt", passAttempt: true, receiverId: "p", twoPointAttempt: true }),
    play({ playId: "kneel", rushAttempt: true, rusherId: "p", kneel: true }),
    play({ playId: "spike", passAttempt: true, receiverId: "p", spike: true }),
    play({ playId: "no-play", passAttempt: true, receiverId: "p", noPlay: true }),
    play({ playId: "null-yard", passAttempt: true, receiverId: "p", yardline100: null }),
    play({ playId: "missing-id-target", passAttempt: true }),
    play({ playId: "missing-id-carry", rushAttempt: true }),
    play({ playId: "post", passAttempt: true, receiverId: "p", seasonType: "POST" }),
  ];
  const result = deriveRedZoneGameFacts(excluded);
  assert.deepEqual(result.players, []);
  assert.ok(result.teams.every((fact) => fact.targets === 0 && fact.carries === 0));
});

test("duplicate play IDs are counted once and corrected complete imports replace the game aggregate", () => {
  const duplicate = play({ passAttempt: true, receiverId: "p" });
  const initial = deriveRedZoneGameFacts([duplicate, duplicate]);
  assert.equal(initial.deduplicatedPlayCount, 1);
  assert.equal(initial.players[0]?.targets, 1);
  const corrected = deriveRedZoneGameFacts([play({ ...duplicate, yardline100: 21 })]);
  assert.equal(corrected.players[0]?.targets, 0);
  assert.equal(corrected.teams.find((fact) => fact.zone === 20)?.targets, 0);
  assert.throws(() => redZoneReplacementGameIds([]), /No usable team denominator facts/);
  assert.deepEqual(redZoneReplacementGameIds([{ gameId: "g1" }, { gameId: "g1" }]), ["g1"]);
});

test("shares remain unavailable when a denominator is zero or missing", () => {
  assert.equal(redZoneShare(0, 0), null);
  assert.equal(redZoneShare(2, null), null);
  assert.equal(redZoneShare(2, 4), 0.5);
});

test("all-null statistic placeholders do not become appearances or zero-count players", () => {
  assert.equal(hasPlayerStatAppearance({
    completions: null, attempts: null, passingYards: null, passingTds: null,
    carries: null, rushingYards: null, rushingTds: null, targets: null,
    receptions: null, receivingYards: null, receivingTds: null,
  }), false);
  assert.equal(hasPlayerStatAppearance({ attempts: 0 }), true);
});

test("positive verified snaps plus complete team PBP preserve observed zero; missing evidence stays unavailable", () => {
  const appearance = { gameId: "g1", teamId: "BUF" };
  const zero = redZonePlayerFactForAppearance([], appearance, 20, true, true);
  assert.equal(zero?.targets, 0);
  assert.equal(zero?.carries, 0);
  assert.equal(redZonePlayerFactForAppearance([], appearance, 20, false, true), undefined);
  assert.equal(redZonePlayerFactForAppearance([], appearance, 20, true, false), undefined);
});

test("last three selects each player's own completed appearances", () => {
  const kickoff = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T18:00:00Z`);
  const rows = [
    { playerId: "p", gameId: "g1", kickoffTime: kickoff(1), week: 1 },
    { playerId: "q", gameId: "q1", kickoffTime: kickoff(2), week: 1 },
    { playerId: "p", gameId: "g2", kickoffTime: kickoff(8), week: 2 },
    { playerId: "p", gameId: "g3", kickoffTime: kickoff(15), week: 3 },
    { playerId: "p", gameId: "g4", kickoffTime: kickoff(22), week: 4 },
    { playerId: "p", gameId: "future", kickoffTime: kickoff(29), week: 5 },
  ];
  assert.deepEqual([...selectLastThreeAppearances(rows.filter((row) => row.gameId !== "future"))], [
    ["p", ["g2", "g3", "g4"]], ["q", ["q1"]],
  ]);
});

test("cutoff excludes target game, future games, unfinished games, and postseason", () => {
  const cutoff = new Date("2026-10-01T18:00:00Z");
  const games = [
    { gameId: "prior", season: 2026, week: 3, kickoffTime: new Date("2026-09-24T18:00:00Z"), gameStatus: "STATUS_FINAL" },
    { gameId: "cutoff", season: 2026, week: 4, kickoffTime: cutoff, gameStatus: "STATUS_FINAL" },
    { gameId: "future", season: 2026, week: 5, kickoffTime: new Date("2026-10-08T18:00:00Z"), gameStatus: "STATUS_FINAL" },
    { gameId: "live", season: 2026, week: 2, kickoffTime: new Date("2026-09-17T18:00:00Z"), gameStatus: "STATUS_IN_PROGRESS" },
    { gameId: "post", season: 2026, week: 19, kickoffTime: new Date("2027-01-10T18:00:00Z"), gameStatus: "STATUS_FINAL" },
  ];
  assert.deepEqual(cutoffSafeRedZoneGames(games, 2026, new Date("2026-10-02T00:00:00Z"), "cutoff")
    .map((game) => game.gameId), ["prior"]);
});

test("traded player facts retain team-at-game identity and zero-opportunity appearances", () => {
  const result = deriveRedZoneGameFacts([
    play({ gameId: "kc-game", sourceGameId: "2026_01_KC_BUF", playId: "1", teamId: "KC",
      opponentTeamId: "BUF", passAttempt: true, receiverId: "traded", receiverName: "Traded WR", yardline100: 25 }),
    play({ gameId: "buf-game", sourceGameId: "2026_08_BUF_MIA", playId: "1", teamId: "BUF",
      opponentTeamId: "MIA", passAttempt: true, receiverId: "traded", receiverName: "Traded WR", yardline100: 10 }),
  ]);
  const playerFacts = result.players.filter((fact) => fact.playerId === "traded");
  assert.equal(playerFacts.length, 6);
  assert.equal(new Set(playerFacts.map((fact) => fact.teamId)).size, 2);
  assert.equal(playerFacts.find((fact) => fact.gameId === "kc-game" && fact.zone === 20)?.targets, 0);
  assert.equal(playerFacts.find((fact) => fact.gameId === "buf-game" && fact.zone === 10)?.targets, 1);
  const kcPlayerFact = playerFacts.find((fact) => fact.gameId === "kc-game" && fact.zone === 20)!;
  const kcDenominator = result.teams.find((fact) => fact.gameId === "kc-game" && fact.zone === 20)!;
  const bufPlayerFact = playerFacts.find((fact) => fact.gameId === "buf-game" && fact.zone === 10)!;
  const bufDenominator = result.teams.find((fact) => fact.gameId === "buf-game" && fact.zone === 10)!;
  assert.equal(redZoneShare(kcPlayerFact.targets, kcDenominator.targets), null);
  assert.equal(redZoneShare(bufPlayerFact.targets, bufDenominator.targets), 1);
});

test("unfiltered traded players partition by team after last3 selects across teams", () => {
  const kickoff = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T18:00:00Z`);
  const appearances = [
    { playerId: "traded", gameId: "kc1", kickoffTime: kickoff(1), week: 1, teamId: "KC" },
    { playerId: "traded", gameId: "buf2", kickoffTime: kickoff(8), week: 2, teamId: "BUF" },
    { playerId: "traded", gameId: "buf3", kickoffTime: kickoff(15), week: 3, teamId: "BUF" },
    { playerId: "traded", gameId: "kc4", kickoffTime: kickoff(22), week: 4, teamId: "KC" },
  ];
  const seasonRows = groupRedZoneAppearancesByPlayerTeam(appearances, "season");
  assert.deepEqual(seasonRows.map((row) => [row.playerId, row.teamId,
    row.appearances.map((appearance) => appearance.gameId)]), [
    ["traded", "KC", ["kc1", "kc4"]],
    ["traded", "BUF", ["buf2", "buf3"]],
  ]);
  const lastThreeRows = groupRedZoneAppearancesByPlayerTeam(appearances, "last3");
  assert.deepEqual(lastThreeRows.map((row) => [row.teamId,
    row.appearances.map((appearance) => appearance.gameId)]), [
    ["BUF", ["buf2", "buf3"]],
    ["KC", ["kc4"]],
  ]);
  const filteredLastThree = groupRedZoneAppearancesByPlayerTeam(appearances, "last3", "KC");
  assert.deepEqual(filteredLastThree.map((row) =>
    row.appearances.map((appearance) => appearance.gameId)), [["kc4"]]);
});

test("season and last3 show covered week one totals with two requested, one included appearance", () => {
  const appearances = [
    { playerId: "p", gameId: "w1", kickoffTime: new Date("2026-09-10T18:00:00Z"), week: 1, teamId: "DET" },
    { playerId: "p", gameId: "w2", kickoffTime: new Date("2026-09-17T18:00:00Z"), week: 2, teamId: "DET" },
  ];
  const coveredKeys = new Set(["w1:DET"]);
  const season = groupRedZoneAppearancesByPlayerTeam(appearances, "season")[0]!;
  const last3 = groupRedZoneAppearancesByPlayerTeam(appearances, "last3")[0]!;
  for (const group of [season, last3]) {
    const window = coveredRedZoneWindow(group.appearances, coveredKeys);
    assert.deepEqual(window.included.map((appearance) => appearance.gameId), ["w1"]);
    assert.equal(window.requestedGames, 2);
    assert.equal(window.includedGames, 1);
    assert.deepEqual(window.coveredWeeks, [1]);
    assert.deepEqual(window.missingWeeks, [2]);
    assert.deepEqual(window.missingGames, ["w2"]);
    assert.equal(window.firstCoveredKickoff, "2026-09-10T18:00:00.000Z");
    assert.equal(window.lastCoveredKickoff, "2026-09-10T18:00:00.000Z");
  }
  const weekOneFact = { gameId: "w1", targets: 2, teamTargets: 4 };
  assert.equal(coveredRedZoneWindow(season.appearances, coveredKeys).included
    .reduce((total, appearance) => total + (appearance.gameId === weekOneFact.gameId ? weekOneFact.targets : 0), 0), 2);
  assert.equal(coveredRedZoneWindow(season.appearances, coveredKeys).included
    .reduce((total, appearance) => total + (appearance.gameId === weekOneFact.gameId ? weekOneFact.teamTargets : 0), 0), 4);
  assert.equal(redZoneCoveragePeriodLabel([1], [2]), "Play-by-play coverage: covered week 1; unavailable week 2.");
});

test("last3 selects the three most recent appearances before dropping uncovered weeks", () => {
  const appearances = [0, 1, 2, 3].map((week) => ({
    playerId: "p",
    gameId: `w${week}`,
    kickoffTime: new Date(`2026-09-${String(3 + week * 7).padStart(2, "0")}T18:00:00Z`),
    week,
    teamId: "DET",
  }));
  const requested = groupRedZoneAppearancesByPlayerTeam(appearances, "last3")[0]!.appearances;
  assert.deepEqual(requested.map((appearance) => appearance.gameId), ["w1", "w2", "w3"]);
  const window = coveredRedZoneWindow(requested, new Set(["w0:DET", "w1:DET"]));
  assert.deepEqual(window.included.map((appearance) => appearance.gameId), ["w1"]);
  assert.equal(window.requestedGames, 3);
  assert.equal(window.includedGames, 1);
  assert.deepEqual(window.coveredWeeks, [1]);
  assert.deepEqual(window.missingWeeks, [2, 3]);
});