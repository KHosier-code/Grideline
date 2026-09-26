import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConsumerTeamAnalytics as buildWithFixture,
  canonicalizeTeamAnalyticsStats,
  type TeamAnalyticsGame,
  type TeamAnalyticsOptions,
  type TeamAnalyticsStat,
  type TeamAnalyticsTeam,
} from "./consumer-team-analytics";

function buildConsumerTeamAnalytics(
  games: TeamAnalyticsGame[],
  stats: TeamAnalyticsStat[],
  teams: TeamAnalyticsTeam[],
  options: TeamAnalyticsOptions,
) {
  return buildWithFixture(games, stats, teams, {
    ...options,
    fixtureWeeks: Array.from({ length: options.throughWeek }, (_, index) => ({
      week: index + 1,
      games: games.filter((game) => game.week === index + 1).map((game) => ({
        gameId: game.gameId, homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId,
      })),
    })),
  });
}

function statFor(
  game: {
    gameId: string;
    week: number;
    homeTeamId: string;
    awayTeamId: string;
  },
  teamId: string,
  opponentTeamId: string,
  isHome: boolean,
  metrics: Partial<{
    epaPerPlay: number | null;
    defensiveEpaAllowedPerPlay: number | null;
    offensiveSuccessRate: number | null;
    defensiveSuccessRate: number | null;
  }> = {},
) {
  return {
    gameId: `nflverse-${game.gameId}`,
    week: game.week,
    teamId,
    opponentTeamId,
    isHome,
    epaPerPlay: null,
    defensiveEpaAllowedPerPlay: null,
    offensiveSuccessRate: null,
    defensiveSuccessRate: null,
    ...metrics,
  };
}

test("team analytics selects only complete weeks and averages persisted game EPA equally", () => {
  const now = new Date("2025-10-01T00:00:00.000Z");
  const teams = [
    { teamId: "a", abbreviation: "AAA", name: "Team A", logoUrl: null },
    { teamId: "b", abbreviation: "BBB", name: "Team B", logoUrl: null },
    { teamId: "c", abbreviation: "CCC", name: "Team C", logoUrl: null },
  ];
  const games = [
    { gameId: "w1", week: 1, kickoffTime: new Date("2025-09-01T00:00:00.000Z"), gameStatus: "STATUS_FINAL", finalHomeScore: 20, finalAwayScore: 10, homeTeamId: "a", awayTeamId: "b" },
    { gameId: "w2", week: 2, kickoffTime: new Date("2025-09-08T00:00:00.000Z"), gameStatus: "STATUS_FINAL", finalHomeScore: 17, finalAwayScore: 14, homeTeamId: "a", awayTeamId: "c" },
    { gameId: "w3-current", week: 3, kickoffTime: new Date("2025-10-02T00:00:00.000Z"), gameStatus: "STATUS_SCHEDULED", finalHomeScore: null, finalAwayScore: null, homeTeamId: "b", awayTeamId: "c" },
  ];
  const stats = [
    statFor(games[0]!, "a", "b", true, { epaPerPlay: 1, defensiveEpaAllowedPerPlay: -0.5, offensiveSuccessRate: 0.4, defensiveSuccessRate: 0.3 }),
    statFor(games[0]!, "b", "a", false, { epaPerPlay: -0.2, defensiveEpaAllowedPerPlay: 0.8, offensiveSuccessRate: 0.2, defensiveSuccessRate: 0.5 }),
    statFor(games[1]!, "a", "c", true, { epaPerPlay: 3, defensiveEpaAllowedPerPlay: null, offensiveSuccessRate: 0.6, defensiveSuccessRate: null }),
    statFor(games[1]!, "c", "a", false, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0.1, offensiveSuccessRate: 0.5, defensiveSuccessRate: 0.4 }),
  ];

  const response = buildConsumerTeamAnalytics(games, stats, teams, {
    season: 2025,
    throughWeek: 3,
    window: "last3",
    now,
  });

  const teamA = response.teams.find((team) => team.teamId === "a")!;
  assert.equal(teamA.offenseEpa, 2);
  assert.equal(teamA.defenseEpa, -0.5);
  assert.equal(teamA.offenseSamples, 2);
  assert.equal(teamA.defenseSamples, 1);
  assert.equal(teamA.selectedGames, 2);
  assert.deepEqual(teamA.observations.map((observation) => observation.week), [1, 2]);
  assert.equal(teamA.observations[0]!.opponent, "BBB");
  assert.equal(teamA.observations[1]!.defenseEpa, null);
  assert.deepEqual(response.coverage.weeks, [
    { week: 1, scheduledGames: 1, expectedGames: 1, missingMatchups: [], fixtureVerified: true, finalGames: 1, statGames: 1, allFinal: true },
    { week: 2, scheduledGames: 1, expectedGames: 1, missingMatchups: [], fixtureVerified: true, finalGames: 1, statGames: 1, allFinal: true },
    { week: 3, scheduledGames: 1, expectedGames: 1, missingMatchups: [], fixtureVerified: true, finalGames: 0, statGames: 0, allFinal: false },
  ]);
  assert.ok(response.coverage.partialReasons.some((reason) => reason.includes("Week 3 is not final-complete")));
  assert.match(response.source, /averaged equally \(not play-weighted\)/);
});

test("season window excludes incomplete weeks and missing stats never become numeric zeroes", () => {
  const now = new Date("2024-10-01T00:00:00.000Z");
  const teams = [
    { teamId: "a", abbreviation: "AAA", name: "Team A", logoUrl: null },
    { teamId: "b", abbreviation: "BBB", name: "Team B", logoUrl: null },
  ];
  const games = [
    { gameId: "final", week: 1, kickoffTime: new Date("2024-09-01T00:00:00.000Z"), gameStatus: "STATUS_FINAL", finalHomeScore: 0, finalAwayScore: 0, homeTeamId: "a", awayTeamId: "b" },
    { gameId: "missing-score", week: 2, kickoffTime: new Date("2024-09-08T00:00:00.000Z"), gameStatus: "STATUS_FINAL", finalHomeScore: null, finalAwayScore: 10, homeTeamId: "a", awayTeamId: "b" },
  ];
  const response = buildConsumerTeamAnalytics(games, [], teams, {
    season: 2024,
    throughWeek: 2,
    window: "season",
    now,
    selectedTeamIds: ["a"],
  });

  assert.equal(response.teams.length, 1);
  assert.equal(response.teams[0]!.selectedGames, 1);
  assert.equal(response.teams[0]!.observations[0]!.offenseEpa, null);
  assert.equal(response.teams[0]!.offenseEpa, null);
  assert.equal(response.teams[0]!.offenseSamples, 0);
  assert.deepEqual(response.coverage.weeks, [
    { week: 1, scheduledGames: 1, expectedGames: 1, missingMatchups: [], fixtureVerified: true, finalGames: 1, statGames: 0, allFinal: true },
    { week: 2, scheduledGames: 1, expectedGames: 1, missingMatchups: [], fixtureVerified: true, finalGames: 0, statGames: 0, allFinal: false },
  ]);
});

test("a week waits for every scheduled result and both reconciled team stat rows", () => {
  const now = new Date("2025-09-30T00:00:00Z");
  const teams = [
    { teamId: "a", abbreviation: "AAA", name: "A", logoUrl: null },
    { teamId: "b", abbreviation: "BBB", name: "B", logoUrl: null },
    { teamId: "c", abbreviation: "CCC", name: "C", logoUrl: null },
  ];
  const game = (id: string, week: number, status: string, awayTeamId = "b") => ({
    gameId: id, week, kickoffTime: new Date("2025-09-01T00:00:00Z"),
    gameStatus: status, finalHomeScore: status === "STATUS_FINAL" ? 10 : null,
    finalAwayScore: status === "STATUS_FINAL" ? 7 : null,
    homeTeamId: "a", awayTeamId,
  });
  const first = game("first", 1, "STATUS_FINAL");
  const second = game("second", 2, "STATUS_FINAL");
  const third = game("third", 2, "STATUS_SCHEDULED", "c");
  const pair = (g: typeof first, value: number) => [
    statFor(g, "AAA", g.awayTeamId === "b" ? "BBB" : "CCC", true, { epaPerPlay: value }),
    statFor(g, g.awayTeamId === "b" ? "BBB" : "CCC", "AAA", false, { epaPerPlay: -value }),
  ];
  const read = (games: typeof first[], stats: ReturnType<typeof statFor>[]) =>
    buildConsumerTeamAnalytics(games, stats, teams, { season: 2025, throughWeek: 2, window: "season", now });
  const partial = read([first, second, third], [...pair(first, 1), ...pair(second, 2)]);
   assert.deepEqual(partial.coverage.weeks[1], { week: 2, scheduledGames: 2, expectedGames: 2, missingMatchups: [], fixtureVerified: true, finalGames: 1, statGames: 1, allFinal: false });
  assert.equal(partial.teams[0]!.offenseEpa, 1);
  const final = { ...third, gameStatus: "STATUS_FINAL", finalHomeScore: 10, finalAwayScore: 7 };
  const delayed = read([first, second, final], [...pair(first, 1), ...pair(second, 2)]);
   assert.deepEqual(delayed.coverage.weeks[1], { week: 2, scheduledGames: 2, expectedGames: 2, missingMatchups: [], fixtureVerified: true, finalGames: 2, statGames: 1, allFinal: true });
  const covered = read([first, second, final], [...pair(first, 1), ...pair(second, 2), ...pair(final, 3)]);
   assert.deepEqual(covered.coverage.weeks[1], { week: 2, scheduledGames: 2, expectedGames: 2, missingMatchups: [], fixtureVerified: true, finalGames: 2, statGames: 2, allFinal: true });
  assert.equal(covered.teams[0]!.offenseEpa, 2);
});

test("nflverse aliases canonicalize to persisted schedule team ids and lastN counts team games across bye weeks", () => {
  const now = new Date("2025-10-01T00:00:00.000Z");
  const teams = [
    { teamId: "espn-was", abbreviation: "WSH", name: "Washington", logoUrl: null },
    { teamId: "espn-atl", abbreviation: "ATL", name: "Atlanta", logoUrl: null },
    { teamId: "espn-kc", abbreviation: "KC", name: "Kansas City", logoUrl: null },
  ];
  const game = (gameId: string, week: number, homeTeamId: string, awayTeamId: string) => ({
    gameId,
    week,
    kickoffTime: new Date(`2025-09-${String(week + 1).padStart(2, "0")}T00:00:00.000Z`),
    gameStatus: "STATUS_FINAL",
    finalHomeScore: 20,
    finalAwayScore: 10,
    homeTeamId,
    awayTeamId,
  });
  const games = [
    game("a-w1", 1, "espn-was", "espn-atl"),
    game("a-w2", 2, "espn-was", "espn-kc"),
    game("bye-w3", 3, "espn-atl", "espn-kc"),
    game("a-w4", 4, "espn-was", "espn-atl"),
    game("a-w5", 5, "espn-was", "espn-kc"),
  ];
  const stats = [
    statFor(games[0]!, "WAS", "ATL", true, { epaPerPlay: 1, offensiveSuccessRate: 0.4 }),
    statFor(games[0]!, "ATL", "WAS", false, { epaPerPlay: 0 }),
    statFor(games[1]!, "WSH", "KC", true, { epaPerPlay: 2, offensiveSuccessRate: 0.5 }),
    statFor(games[1]!, "KC", "WSH", false, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0 }),
    statFor(games[2]!, "ATL", "KC", true, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0 }),
    statFor(games[2]!, "KC", "ATL", false, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0 }),
    statFor(games[3]!, "WAS", "ATL", true, { epaPerPlay: 4, offensiveSuccessRate: 0.6 }),
    statFor(games[3]!, "ATL", "WAS", false, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0 }),
    statFor(games[4]!, "WAS", "KC", true, { epaPerPlay: 5, offensiveSuccessRate: 0.7 }),
    statFor(games[4]!, "KC", "WAS", false, { epaPerPlay: 0, defensiveEpaAllowedPerPlay: 0 }),
  ];

  const response = buildConsumerTeamAnalytics(games, stats, teams, {
    season: 2025,
    throughWeek: 5,
    window: "last3",
    now,
    selectedTeamIds: ["espn-was"],
  });
  const washington = response.teams[0]!;
  assert.equal(washington.teamId, "espn-was");
  assert.deepEqual(washington.observations.map((observation) => observation.week), [2, 4, 5]);
  assert.equal(washington.offenseEpa, (2 + 4 + 5) / 3);
  assert.equal(washington.defenseEpa, null);
  assert.equal(washington.defenseSamples, 0);
  assert.equal(washington.observations[0]!.opponent, "KC");
  assert.equal(response.coverage.weeks.length, 5);
});

test("stat identity canonicalization fails closed for unknown and ambiguous source team ids", () => {
  const teams = [
    { teamId: "espn-was", abbreviation: "WAS", name: "Washington", logoUrl: null },
    { teamId: "espn-wsh", abbreviation: "WSH", name: "Ambiguous Washington", logoUrl: null },
  ];
  const games = [{
    gameId: "espn-game",
    week: 1,
    kickoffTime: new Date("2025-09-01T00:00:00.000Z"),
    gameStatus: "STATUS_FINAL",
    finalHomeScore: 10,
    finalAwayScore: 0,
    homeTeamId: "espn-was",
    awayTeamId: "espn-wsh",
  }];
  const unknownStat = statFor(games[0]!, "unknown", "WAS", true);
  const ambiguousSourceStat = statFor(games[0]!, "WSH", "WAS", false);
  const now = new Date("2025-10-01T00:00:00.000Z");
  assert.throws(
    () => canonicalizeTeamAnalyticsStats([unknownStat], games, teams, now),
    /Cannot map/,
  );
  assert.throws(
    () => canonicalizeTeamAnalyticsStats([ambiguousSourceStat], games, teams, now),
    /maps to multiple canonical teams/,
  );
});

test("source game ids reconcile by exact season-week-team orientation; wrong and ambiguous matchups fail closed", () => {
  const now = new Date("2025-10-01T00:00:00.000Z");
  const teams = [
    { teamId: "espn-was", abbreviation: "WAS", name: "Washington", logoUrl: null },
    { teamId: "espn-atl", abbreviation: "ATL", name: "Atlanta", logoUrl: null },
  ];
  const game = {
    gameId: "401872656",
    week: 1,
    kickoffTime: new Date("2025-09-01T00:00:00.000Z"),
    gameStatus: "STATUS_FINAL",
    finalHomeScore: 10,
    finalAwayScore: 0,
    homeTeamId: "espn-was",
    awayTeamId: "espn-atl",
  };
  const sourceStat = {
    ...statFor(game, "WAS", "ATL", true, { epaPerPlay: 0.75 }),
    gameId: "2025_01_WAS_ATL",
  };
  const mapped = canonicalizeTeamAnalyticsStats([sourceStat], [game], teams, now);
  assert.equal(mapped.stats[0]!.gameId, "401872656");
  assert.equal(mapped.stats[0]!.teamId, "espn-was");
  assert.equal(mapped.unmatchedStatsByWeek.size, 0);
  assert.equal(sourceStat.gameId, "2025_01_WAS_ATL");

  assert.throws(
    () => canonicalizeTeamAnalyticsStats(
      [statFor(game, "WAS", "ATL", false)],
      [game],
      teams,
      now,
    ),
    /home\/away orientation/,
  );
  assert.throws(
    () => canonicalizeTeamAnalyticsStats(
      [sourceStat],
      [game, { ...game, gameId: "same-matchup-duplicate" }],
      teams,
      now,
    ),
    /ambiguously matches 2 scheduled games/,
  );
  assert.throws(
    () => canonicalizeTeamAnalyticsStats(
      [sourceStat, statFor(game, "WSH", "ATL", true)],
      [game],
      teams,
      now,
    ),
    /Multiple persisted team-game stat rows/,
  );
});

test("orphan historical stats without schedule evidence are excluded with explicit partial coverage", () => {
  const now = new Date("2025-10-01T00:00:00.000Z");
  const teams = [
    { teamId: "a", abbreviation: "AAA", name: "Team A", logoUrl: null },
    { teamId: "b", abbreviation: "BBB", name: "Team B", logoUrl: null },
    { teamId: "c", abbreviation: "CCC", name: "Team C", logoUrl: null },
    { teamId: "d", abbreviation: "DDD", name: "Team D", logoUrl: null },
  ];
  const orphanGame = {
    gameId: "2021_01_CCC_DDD",
    week: 1,
    homeTeamId: "c",
    awayTeamId: "d",
  };
  const orphanStats = [
    statFor(orphanGame, "CCC", "DDD", true, { epaPerPlay: 0.4 }),
    statFor(orphanGame, "DDD", "CCC", false, { epaPerPlay: -0.2 }),
  ];

  const emptyScheduleResponse = buildConsumerTeamAnalytics([], orphanStats, teams, {
    season: 2021,
    throughWeek: 3,
    window: "season",
    now,
  });
  assert.equal(emptyScheduleResponse.teams.length, 4);
  assert.ok(emptyScheduleResponse.teams.every((team) => team.selectedGames === 0 && team.offenseEpa === null));
  assert.deepEqual(emptyScheduleResponse.coverage.weeks, []);
  assert.ok(emptyScheduleResponse.coverage.partialReasons.some((reason) => reason.includes("No regular-season schedule games")));
  assert.ok(emptyScheduleResponse.coverage.partialReasons.some((reason) => reason.includes("Excluded 2 persisted team-game stat rows from week 1")));

  const partialSchedule = [{
    gameId: "schedule-a-b",
    week: 1,
    kickoffTime: new Date("2025-09-01T00:00:00.000Z"),
    gameStatus: "STATUS_FINAL",
    finalHomeScore: 10,
    finalAwayScore: 7,
    homeTeamId: "a",
    awayTeamId: "b",
  }];
  const partialResponse = buildConsumerTeamAnalytics(
    partialSchedule,
    [
      statFor(partialSchedule[0]!, "AAA", "BBB", true, { epaPerPlay: 0.1 }),
      statFor(partialSchedule[0]!, "BBB", "AAA", false, { epaPerPlay: 0.2 }),
      ...orphanStats,
    ],
    teams,
    { season: 2025, throughWeek: 1, window: "season", now },
  );
  assert.equal(partialResponse.coverage.weeks[0]!.statGames, 1);
  assert.ok(partialResponse.coverage.partialReasons.some((reason) => reason.includes("Excluded 2 persisted team-game stat rows from week 1")));
  assert.equal(partialResponse.teams.find((team) => team.teamId === "c")!.selectedGames, 0);
});

test("a missing provider matchup blocks a fully final and statistically covered persisted week, including later weeks", () => {
  const now = new Date("2025-10-01T00:00:00Z");
  const teams = ["a", "b", "c", "d"].map((teamId) => ({
    teamId, abbreviation: teamId.toUpperCase(), name: teamId, logoUrl: null,
  }));
  const game = (week: number) => ({
    gameId: `game-${week}`, week, kickoffTime: new Date("2025-09-01T00:00:00Z"),
    gameStatus: "STATUS_FINAL", finalHomeScore: 10, finalAwayScore: 7,
    homeTeamId: "a", awayTeamId: "b",
  });
  const games = [game(1), game(2), game(3)];
  const stats = games.flatMap((entry) => [
    statFor(entry, "A", "B", true, { epaPerPlay: 1 }),
    statFor(entry, "B", "A", false, { epaPerPlay: -1 }),
  ]);
  const fixtureWeeks = games.map((entry) => ({
    week: entry.week,
    games: [{ gameId: entry.gameId, homeTeamId: "a", awayTeamId: "b" }],
  }));
  fixtureWeeks[1]!.games.push({ gameId: "missing", homeTeamId: "c", awayTeamId: "d" });
  const response = buildWithFixture(games, stats, teams, {
    season: 2025, throughWeek: 3, window: "season", now, fixtureWeeks,
  });
  assert.deepEqual(response.coverage.weeks[1], {
    week: 2, scheduledGames: 1, expectedGames: 2,
    missingMatchups: ["d at c (missing)"], fixtureVerified: true,
    finalGames: 1, statGames: 1, allFinal: false,
  });
  assert.match(response.coverage.partialReasons.join(" "), /Week 2 is missing 1 provider schedule matchup/);
  assert.deepEqual(response.teams.find((team) => team.teamId === "a")!.observations.map((entry) => entry.week), [1]);

  const unavailable = buildWithFixture(games, stats, teams, {
    season: 2025, throughWeek: 3, window: "season", now,
    fixtureWeeks: fixtureWeeks.map((entry) => entry.week === 2 ? { week: 2, games: null } : entry),
  });
  assert.equal(unavailable.coverage.weeks[1]!.fixtureVerified, false);
  assert.equal(unavailable.coverage.weeks[1]!.allFinal, false);
  assert.deepEqual(unavailable.teams.find((team) => team.teamId === "a")!.observations.map((entry) => entry.week), [1]);
  assert.match(unavailable.coverage.partialReasons.join(" "), /Week 2 has no verifiable provider schedule fixture/);
});