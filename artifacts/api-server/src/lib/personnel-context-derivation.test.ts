import test from "node:test";
import assert from "node:assert/strict";
import {
  asOfCutoff,
  derivePersonnelContext,
  normalizeTeamId,
  nflverseTeamCandidates,
  personnelNumericFeatures,
} from "./personnel-context-derivation";

test("normalizes nflverse abbreviations at the canonical team boundary", () => {
  const mapping = new Map([
    ["LAR", "lar-id"], ["LV", "lv-id"], ["LAC", "lac-id"],
    ["JAX", "jax-id"], ["WAS", "was-id"],
  ]);
  for (const [alias, canonical] of [["LA", "lar-id"], ["LAR", "lar-id"], ["OAK", "lv-id"], ["LV", "lv-id"], ["SD", "lac-id"], ["LAC", "lac-id"], ["STL", "lar-id"], ["JAC", "jax-id"], ["JAX", "jax-id"], ["WSH", "was-id"], ["WAS", "was-id"]] as const) {
    assert.equal(normalizeTeamId(alias, mapping), canonical);
  }
  assert.deepEqual(nflverseTeamCandidates("LAR").sort(), ["LA", "LAR", "STL"].sort());
  assert.equal(normalizeTeamId("unknown", mapping), "unknown");
});

const kickoff = new Date("2025-01-12T18:00:00.000Z");

test("as-of cutoff is the earlier of now and kickoff minus one millisecond", () => {
  assert.equal(
    asOfCutoff(kickoff, new Date("2025-01-12T12:00:00.000Z")).toISOString(),
    "2025-01-12T12:00:00.000Z",
  );
  assert.equal(
    asOfCutoff(kickoff, new Date("2025-01-13T12:00:00.000Z")).toISOString(),
    "2025-01-12T17:59:59.999Z",
  );
});

test("post-kickoff depth, injury, participation, and odds evidence is excluded", () => {
  const context = derivePersonnelContext({
    now: new Date("2025-01-13T00:00:00.000Z"),
    game: {
      gameId: "game-1",
      season: 2024,
      week: 19,
      kickoffTime: kickoff,
      homeTeamId: "home",
      awayTeamId: "away",
    },
    depth: [
      {
        teamId: "home",
        playerId: "qb-before",
        playerName: "Before QB",
        position: "QB",
        depthPosition: 1,
        starter: true,
        snapshotTimestamp: "2025-01-11T12:00:00.000Z",
        sourceUpdatedAt: "2025-01-11T12:00:00.000Z",
      },
      {
        teamId: "home",
        playerId: "qb-after",
        playerName: "After QB",
        position: "QB",
        depthPosition: 1,
        starter: true,
        snapshotTimestamp: "2025-01-12T20:00:00.000Z",
        sourceUpdatedAt: "2025-01-12T20:00:00.000Z",
      },
    ],
    injuries: [
      {
        teamId: "home",
        playerId: "qb-before",
        position: "QB",
        gameStatus: "Questionable",
        snapshotTimestamp: "2025-01-11T12:00:00.000Z",
        sourceUpdatedAt: "2025-01-11T12:00:00.000Z",
      },
      {
        teamId: "home",
        playerId: "qb-after",
        position: "QB",
        gameStatus: "Out",
        snapshotTimestamp: "2025-01-12T20:00:00.000Z",
        sourceUpdatedAt: "2025-01-12T20:00:00.000Z",
      },
    ],
    snaps: [
      {
        gameId: "prior",
        season: 2024,
        week: 18,
        playerId: "qb-before",
        playerName: "Before QB",
        position: "QB",
        teamId: "home",
        offensePct: 1,
        sourceUpdatedAt: "2025-01-11T10:00:00.000Z",
        kickoffTime: "2025-01-05T18:00:00.000Z",
      },
      {
        gameId: "future",
        season: 2024,
        week: 19,
        playerId: "qb-after",
        playerName: "After QB",
        position: "QB",
        teamId: "home",
        offensePct: 1,
        sourceUpdatedAt: "2025-01-12T20:00:00.000Z",
        kickoffTime: "2025-01-12T18:00:00.000Z",
      },
    ],
    qbs: [
      {
        gameId: "prior",
        season: 2024,
        week: 18,
        playerId: "qb-before",
        teamId: "home",
        dropbacks: 20,
        passAttempts: 18,
        passEpa: 4,
        passSuccesses: 10,
        interceptions: 0,
        sacks: 1,
        rushAttempts: 2,
        rushEpa: 1,
        kickoffTime: "2025-01-05T18:00:00.000Z",
        sourceUpdatedAt: "2025-01-11T10:00:00.000Z",
      },
      {
        gameId: "target",
        season: 2024,
        week: 19,
        playerId: "qb-after",
        teamId: "home",
        dropbacks: 100,
        passAttempts: 100,
        passEpa: 100,
        passSuccesses: 100,
        interceptions: 0,
        sacks: 0,
        rushAttempts: 0,
        rushEpa: 0,
        kickoffTime: "2025-01-12T18:00:000Z",
        sourceUpdatedAt: "2025-01-12T20:00:00.000Z",
      },
    ],
    priorGames: [
      { gameId: "prior", teamId: "home", kickoffTime: "2025-01-05T18:00:00.000Z", isHome: true },
    ],
    odds: [
      { sportsbook: "DraftKings", capturedAt: "2025-01-11T12:00:00.000Z", market: "spread", selection: "home", point: -3, price: -110 },
      { sportsbook: "DraftKings", capturedAt: "2025-01-12T20:00:00.000Z", market: "spread", selection: "home", point: -7, price: -110 },
    ],
  });
  assert.equal(context.sourceCutoff, "2025-01-12T17:59:59.999Z");
  assert.equal(context.teams.home.starters.some((row) => row.playerId === "qb-after"), false);
  assert.equal(context.teams.home.qb.projectedStarter?.playerId, "qb-before");
  assert.equal(context.teams.home.injuryPlayers.some((row) => row.playerId === "qb-after"), false);
  assert.equal(context.market.observations, 1);
  assert.equal(context.market.current[0]?.current.point, -3);
});

test("inferred starters remain non-official and numeric Phase 7 features are auditable", () => {
  const context = derivePersonnelContext({
    now: new Date("2025-01-01T00:00:00.000Z"),
    game: { gameId: "game-2", season: 2024, week: 1, kickoffTime: "2025-01-12T18:00:00.000Z", homeTeamId: "h", awayTeamId: "a" },
    depth: [],
    injuries: [],
    snaps: [{
      gameId: "prior",
      season: 2024,
      week: 18,
      playerId: "p1",
      playerName: "Inferred Player",
      position: "WR",
      teamId: "h",
      offensePct: 0.9,
      sourceUpdatedAt: "2024-12-30T00:00:00.000Z",
      kickoffTime: "2024-12-29T18:00:00.000Z",
    }],
    qbs: [],
    priorGames: [],
    odds: [],
  });
  const starter = context.teams.h.starters[0];
  assert.equal(starter?.official, false);
  assert.equal(starter?.inferred, true);
  assert.equal(starter?.classification, "inferred");
  assert.ok(starter?.evidence.length);
  assert.ok(context.teams.h.sourceHierarchy.includes("nflverse recent snap-count/participation inference"));
  assert.ok(context.teams.h.missingRequiredPositions.includes("QB"));
  assert.equal(context.weather.available, false);
  assert.match(context.dataConfidence.label, /not betting confidence/);
  assert.ok(Object.hasOwn(personnelNumericFeatures(context), "personnel.data_confidence"));
});

test("weather snapshots are cutoff-safe and confidence exposes fixed weights", () => {
  const context = derivePersonnelContext({
    now: new Date("2025-01-12T12:00:00.000Z"),
    game: { gameId: "weather-game", season: 2024, week: 19, kickoffTime: kickoff, homeTeamId: "h", awayTeamId: "a" },
    depth: [], injuries: [], snaps: [], qbs: [], priorGames: [], odds: [],
    weather: [
      {
        gameId: "weather-game", source: "National Weather Service api.weather.gov",
        fetchedAt: "2025-01-12T11:00:00.000Z", validTime: kickoff,
        indoorOutdoor: "outdoor", temperature: 38, sustainedWind: 12,
        precipitationProbability: 20, humidity: 60,
      },
      {
        gameId: "weather-game", source: "National Weather Service api.weather.gov",
        fetchedAt: "2025-01-12T19:00:00.000Z", validTime: kickoff,
        indoorOutdoor: "outdoor", temperature: 99,
      },
    ],
  });
  assert.equal(context.weather.available, true);
  assert.equal(context.weather.temperature, 38);
  assert.deepEqual(context.dataConfidence.weights, {
    qbCertainty: 0.2,
    personnelCompleteness: 0.2,
    injuryFreshness: 0.15,
    sportsbookFreshness: 0.15,
    weatherAvailability: 0.1,
    sampleQuality: 0.2,
  });
  assert.equal(context.dataConfidence.notBetting, true);
});

test("source timestamps at or after kickoff cannot enter pregame-v4 context", () => {
  const context = derivePersonnelContext({
    now: new Date("2025-01-13T00:00:00.000Z"),
    game: { gameId: "boundary-game", season: 2024, week: 19, kickoffTime: kickoff, homeTeamId: "h", awayTeamId: "a" },
    depth: [], injuries: [], snaps: [], qbs: [], priorGames: [],
    odds: [{
      sportsbook: "DraftKings", capturedAt: "2025-01-12T12:00:00.000Z",
      sourceTimestamp: kickoff, market: "spread", selection: "h", point: -3, price: -110,
    }],
    weather: [{
      gameId: "boundary-game", source: "National Weather Service api.weather.gov",
      fetchedAt: "2025-01-12T12:00:00.000Z", forecastGeneratedAt: kickoff,
      validTime: kickoff, indoorOutdoor: "outdoor", temperature: 40,
    }],
  });
  assert.equal(context.market.observations, 0);
  assert.equal(context.weather.available, false);
});

test("post-cutoff participation backfills cannot change QB or OL context", () => {
  const cutoffKickoff = new Date("2025-01-12T18:00:00.000Z");
  const context = derivePersonnelContext({
    now: new Date("2025-01-12T12:00:00.000Z"),
    game: { gameId: "backfill-game", season: 2024, week: 19, kickoffTime: cutoffKickoff, homeTeamId: "h", awayTeamId: "a" },
    depth: [{
      teamId: "h", playerId: "qb-depth", playerName: "Depth QB", position: "QB", depthPosition: 1, starter: true,
      source: "espn_depth_chart", classification: "published_secondary",
      snapshotTimestamp: "2025-01-11T00:00:00.000Z", sourceUpdatedAt: "2025-01-11T00:00:00.000Z",
    }, {
      teamId: "h", playerId: "lt-depth", playerName: "Depth LT", position: "LT", depthPosition: 1, starter: true,
      source: "espn_depth_chart", classification: "published_secondary",
      snapshotTimestamp: "2025-01-11T00:00:00.000Z", sourceUpdatedAt: "2025-01-11T00:00:00.000Z",
    }],
    injuries: [], snaps: [{
      gameId: "prior", season: 2024, week: 18, playerId: "lt-depth", playerName: "Depth LT", position: "LT", teamId: "h",
      offensePct: 1, kickoffTime: "2025-01-05T18:00:00.000Z", sourceUpdatedAt: "2025-01-13T00:00:00.000Z",
    }], qbs: [{
      gameId: "prior", season: 2024, week: 18, playerId: "qb-depth", teamId: "h", dropbacks: 20, passAttempts: 20,
      passEpa: 1, passSuccesses: 10, interceptions: 0, sacks: 1, rushAttempts: 0, rushEpa: 0,
      kickoffTime: "2025-01-05T18:00:00.000Z", sourceUpdatedAt: "2025-01-13T00:00:00.000Z",
    }], priorGames: [], odds: [],
  });
  assert.equal(context.teams.h.qb.metricsSampleGames, 0);
  assert.equal(context.teams.h.qb.projectedStarter?.playerId, "qb-depth");
  assert.equal(context.teams.h.starters.find((starter) => starter.playerId === "lt-depth")?.recentSnapShare, null);
  assert.equal(context.teams.h.olContinuity.returningStartersFromPriorWeek, null);
});
