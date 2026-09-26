import test from "node:test";
import assert from "node:assert/strict";
import { buildDefenseVsPosition, type DefenseInputs } from "./defense-vs-position";

const cutoff = new Date("2026-10-01T18:00:00Z");
const weeks = [1, 2, 3, 4, 5, 6];
function fixture(): DefenseInputs {
  const games = weeks.map((week) => ({
    gameId: `g${week}`, season: 2026, week,
    kickoffTime: new Date(`2026-09-${String(week + 1).padStart(2, "0")}T18:00:00Z`),
    gameStatus: week === 6 ? "STATUS_SCHEDULED" : "STATUS_FINAL",
    homeTeamId: "def", awayTeamId: "off",
  }));
  const stat = (week: number, playerId: string, position: string, teamId = "KC", opponentTeamId = "LA") => ({
    id: week * 10, playerId, playerName: playerId, position, teamId, opponentTeamId,
    season: 2026, seasonType: "REG", week,
    attempts: 0, passingYards: 0, passingTds: 0, interceptions: 0,
    carries: 0, rushingYards: 0, rushingTds: 0, targets: 0, receptions: 0,
    receivingYards: 0, receivingTds: 0, sourceUpdatedAt: new Date("2026-09-02T00:00:00Z"),
  });
  const stats = weeks.flatMap((week) => [
    stat(week, `qb${week}`, "QB", "KC", "LA"),
    stat(week, `opqb${week}`, "QB", "LAR", "KC"),
    { ...stat(week, `wr${week}`, "WR", "LAR", "KC"), targets: week * 2, receptions: week, receivingYards: week * 10, receivingTds: 1 },
    { ...stat(week, `wr2-${week}`, "WR", "LAR", "KC"), targets: 1, receptions: 0, receivingYards: 0, receivingTds: 0 },
    { ...stat(week, `rb${week}`, "RB", "LAR", "KC"), carries: 3, rushingTds: 1, receivingTds: 2 },
  ]);
  const rzTeams = [1, 2, 4, 5].flatMap((week) => ["KC", "LA"].flatMap((teamId) => (week === 5 ? [20] : [20, 10]).map((zone) => ({
    gameId: `g${week}`, season: 2026, week, seasonType: "REG", teamId,
    opponentTeamId: teamId === "KC" ? "LA" : "KC", zone, ingestedAt: new Date("2026-09-02T00:00:00Z"),
  }))));
  const rzPlayers = [1, 2, 4].flatMap((week) => [20, 10].map((zone) => ({
    gameId: `g${week}`, season: 2026, week, seasonType: "REG", teamId: "LAR",
    playerId: `rb${week}`, position: "RB", zone, carries: week, targets: 0,
    ingestedAt: new Date("2026-09-02T00:00:00Z"),
  })));
  return {
    games, stats, rzTeams, rzPlayers,
    sources: ["player_stats", "pbp"].map((dataset) => ({ dataset, season: 2026, status: "success" })),
    teams: [{ teamId: "def", abbreviation: "KC" }, { teamId: "off", abbreviation: "LAR" }],
  } as unknown as DefenseInputs;
}

const defense = (data: DefenseInputs, window: "season" | "last3" | "last5" | "last2Weeks" = "season", excludedGameId?: string, time = cutoff) =>
  buildDefenseVsPosition(data, 2026, time, excludedGameId, window)
    .defenses.find((team) => team.teamId === "def")!.positions as Record<string, Record<string, {
       perGame: number | null; total: number | null; coveredGames: number; completedGames: number; coveredWeeks: number[]; missingWeeks: number[];
    }>>;

test("two receivers count as one defensive game; completed zero and missing PBP differ", () => {
  const wr = defense(fixture()).WR;
  assert.equal(wr.targets.coveredGames, 4);
  assert.equal(wr.targets.total, (3 + 5 + 9 + 11));
  assert.equal(wr.targets.perGame, 7);
  assert.deepEqual(wr.targets.coveredWeeks, [1, 2, 4, 5]);
  assert.deepEqual(wr.targets.missingWeeks, [3]);
  const data = fixture();
  for (const row of data.stats) if (row.week === 2 && row.position === "WR") row.targets = 0;
  const zero = defense(data).WR.targets;
  assert.equal(zero.coveredGames, 4);
  assert.equal(zero.total, 23);
  data.stats.find((row) => row.week === 2 && row.position === "WR")!.targets = null;
  assert.equal(defense(data).WR.targets.coveredGames, 3);
  assert.deepEqual(defense(data).WR.targets.missingWeeks, [2, 3]);
});

test("missing position rows and ambiguous identities never become verified zeroes", () => {
  const data = fixture();
  const withZero = data.stats.filter((row) => row.week === 2 && row.position === "WR");
  for (const row of withZero) row.targets = 0;
  assert.equal(defense(data).WR.targets.coveredGames, 4);
  assert.equal(defense(data).WR.targets.total, 23); // actual WR rows with zero values

  data.stats = data.stats.filter((row) => !(row.week === 2 && row.position === "WR"));
  assert.equal(defense(data).WR.targets.coveredGames, 3);
  assert.deepEqual(defense(data).WR.targets.missingWeeks, [2, 3]);
  data.stats.push({ ...withZero[0]!, position: null });
  assert.equal(defense(data).WR.targets.coveredGames, 3);
  assert.equal(defense(data).RB.carries.coveredGames, 3); // unresolved position might be RB too
  data.sources.find((source) => source.dataset === "player_stats")!.status = "partial";
  assert.equal(defense(data).WR.targets.coveredGames, 0);
});

test("last three covered games retain intervening missing week and exclude upcoming game and postseason", () => {
  const data = fixture();
  data.stats.push({ ...data.stats[0]!, playerId: "post", position: "WR", seasonType: "POST", week: 5, targets: 1000 });
  assert.deepEqual(defense(data, "last3").WR.targets.coveredWeeks, [2, 4, 5]);
  assert.deepEqual(defense(data, "last3").WR.targets.missingWeeks, [3]);
  assert.deepEqual(defense(data, "last5").WR.targets.coveredWeeks, [1, 2, 4, 5]);
  assert.deepEqual(defense(data, "season", "g5", new Date("2026-09-06T18:00:00Z")).WR.targets.coveredWeeks, [1, 2, 4]);
  assert.equal(defense(data).WR.targets.total, 28);
});

test("aliases, trades, distinct TD types and partial red-zone coverage stay separate", () => {
  const data = fixture();
  data.stats.find((row) => row.playerId === "wr5")!.teamId = "LA";
  const result = defense(data);
  assert.equal(result.WR.targets.total, 28); // LA resolves to LAR
  assert.equal(result.RB.rushingTds.total, 4);
  assert.equal(result.RB.receivingTds.total, 8);
  assert.deepEqual(result.RB.rz10Carries.coveredWeeks, [1, 2, 4]);
  assert.deepEqual(result.RB.rz10Carries.missingWeeks, [3, 5]);
  assert.equal(result.RB.rz10Carries.perGame, 7 / 3);
  data.stats.find((row) => row.playerId === "wr5")!.teamId = "BUF"; // traded record not a LAR opponent
  assert.equal(defense(data).WR.targets.total, 18);
});

function fullWeeks() {
  const data = fixture();
  // Independent final matchups establish the schedule's two 16-game weeks.
  // Week 3 has one final and fifteen scheduled games, so it cannot displace 2.
  for (const week of [1, 2, 3]) for (let i = 1; i <= 15; i++) {
    data.games.push({
      gameId: `other-${week}-${i}`, season: 2026, week,
      kickoffTime: new Date(`2026-09-${String(week + 1).padStart(2, "0")}T19:00:00Z`),
      gameStatus: week === 3 ? "STATUS_SCHEDULED" : "STATUS_FINAL",
      homeTeamId: `home-${i}`, awayTeamId: `away-${i}`,
    });
    if (week === 1) data.teams.push(
      { teamId: `home-${i}`, abbreviation: `H${i}` },
      { teamId: `away-${i}`, abbreviation: `A${i}` },
    );
  }
  return data;
}

test("two globally completed weeks, not two covered games or a partial third week", () => {
  const data = fullWeeks();
  const result = buildDefenseVsPosition(data, 2026, cutoff, undefined, "last2Weeks");
  assert.deepEqual(result.selectedWeeks, [1, 2]);
  assert.equal(result.windowReason, null);
  assert.deepEqual(defense(data, "last2Weeks").WR.targets.coveredWeeks, [1, 2]);
  assert.equal(defense(data, "last2Weeks").WR.targets.total, 8);
  assert.equal(defense(data, "last2Weeks").WR.targets.completedGames, 2);
  data.stats.find(r => r.playerId === "wr2-2")!.targets = null;
  assert.deepEqual(defense(data, "last2Weeks").WR.targets.coveredWeeks, [1]);
  assert.deepEqual(defense(data, "last2Weeks").WR.targets.missingWeeks, [2]);
  assert.equal(defense(data, "last2Weeks").WR.targets.total, 3);
  data.stats.find(r => r.playerId === "wr2-2")!.targets = 0;
  data.stats.filter(r => r.week === 2 && r.position === "WR").forEach(r => { r.targets = 0; });
  assert.equal(defense(data, "last2Weeks").WR.targets.total, 3);
  assert.equal(defense(data, "last2Weeks").WR.targets.coveredGames, 2);
});

test("pregame cutoffs reject later reimports, while later retrospective reads use observed history", () => {
  const data = fullWeeks();
  data.stats.forEach(row => { row.sourceUpdatedAt = new Date("2026-09-26T15:01:51Z"); });
  const early = new Date("2026-09-26T12:00:00Z");
  const result = buildDefenseVsPosition(data, 2026, early, undefined, "last2Weeks");
  assert.deepEqual(result.selectedWeeks, [1, 2]);
  assert.equal(defense(data, "last2Weeks", undefined, early).WR.targets.coveredGames, 0);
  assert.match(result.defenses.find(r => r.teamId === "def")!.positions.WR.targets.reason!, /imported after this cutoff/);
  assert.equal(defense(data, "last2Weeks", undefined, cutoff).WR.targets.total, 8);
  // A cutoff inside Week 2 cannot treat its final status as a pregame result.
  const beforeTwo = buildDefenseVsPosition(data, 2026, new Date("2026-09-03T18:30:00Z"), undefined, "last2Weeks");
  assert.deepEqual(beforeTwo.selectedWeeks, [1]);
});