import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOddsApiTimestamp,
  compareOddsQuotes,
  classifyMatchedAuditReason,
  classifyMatchedEvent,
  diagnoseOddsEventMatch,
  findMissingOddsMarkets,
  getObservationKey,
  hashOddsState,
  hasCompleteOddsMarket,
  isPreKickoffCapture,
  normalizeTeamName,
  oddsQuoteIsBetter,
  parseOddsTimestamp,
} from "./odds";

test("Odds API commence filters omit fractional seconds rejected by the provider", () => {
  assert.equal(
    formatOddsApiTimestamp(new Date("2026-09-17T14:00:13.923Z")),
    "2026-09-17T14:00:13Z",
  );
});
import { getExposedScheduleWeeks } from "./schedule";

test("normalizes common sportsbook team-name variants to one NFL identity", () => {
  assert.equal(normalizeTeamName("NY Giants"), normalizeTeamName("New York Giants"));
  assert.equal(normalizeTeamName("LA Rams"), normalizeTeamName("Los Angeles Rams"));
  assert.equal(normalizeTeamName("LAR"), normalizeTeamName("Los Angeles Rams"));
  assert.equal(normalizeTeamName("JAX"), normalizeTeamName("Jacksonville Jaguars"));
});

test("does not collapse different teams while normalizing", () => {
  assert.notEqual(normalizeTeamName("NY Giants"), normalizeTeamName("NY Jets"));
  assert.notEqual(normalizeTeamName("LA Rams"), normalizeTeamName("LA Chargers"));
});

test("uses latest-state hashes so an A-B-A sequence is retained", () => {
  const key = getObservationKey("fixture-game", "DraftKings", "spread", "DAL");
  const first = hashOddsState(key, -3, -110);
  const changedPrice = hashOddsState(key, -3, -105);
  const changedBack = hashOddsState(key, -3, -110);
  assert.notEqual(first, changedPrice);
  assert.equal(first, changedBack);
});

test("keeps source timestamps when they are ISO, epoch seconds, or invalid", () => {
  assert.equal(
    parseOddsTimestamp("2026-09-10T18:30:00.000Z")?.toISOString(),
    "2026-09-10T18:30:00.000Z",
  );
  assert.equal(
    parseOddsTimestamp("1789065000")?.toISOString(),
    "2026-09-10T18:30:00.000Z",
  );
  assert.equal(parseOddsTimestamp("not-a-timestamp"), null);
});

test("reports missing markets per matched game instead of hiding gaps globally", () => {
  const observed = [
    "game-a:DraftKings:spread",
    "game-a:DraftKings:moneyline",
    "game-a:DraftKings:total",
    "game-a:FanDuel:spread",
    "game-a:FanDuel:moneyline",
    "game-a:FanDuel:total",
    "game-b:DraftKings:spread",
  ];
  const missing = findMissingOddsMarkets(["game-a", "game-b"], observed);

  assert.equal(missing.includes("game-a DraftKings spread"), false);
  assert.equal(missing.includes("game-b DraftKings moneyline"), true);
  assert.equal(missing.includes("game-b FanDuel spread"), true);
  assert.equal(missing.length, 5);
  assert.equal(hasCompleteOddsMarket("spread", ["DAL", "PHI"], "DAL", "PHI"), true);
  assert.equal(hasCompleteOddsMarket("spread", ["DAL"], "DAL", "PHI"), false);
  assert.equal(hasCompleteOddsMarket("total", ["Over"], "DAL", "PHI"), false);
  assert.equal(hasCompleteOddsMarket("total", ["Over", "Under"], "DAL", "PHI"), true);
});

test("compares points before prices for spreads and totals", () => {
  const spreadAtBetterPoint = {
    market: "spread" as const,
    selection: "DAL",
    point: -2.5,
    price: -120,
  };
  const spreadAtWorsePoint = {
    market: "spread" as const,
    selection: "DAL",
    point: -3,
    price: -105,
  };
  assert.equal(oddsQuoteIsBetter(spreadAtBetterPoint, spreadAtWorsePoint), true);

  const overLowerPoint = {
    market: "total" as const,
    selection: "Over",
    point: 43.5,
    price: -120,
  };
  const overHigherPoint = {
    market: "total" as const,
    selection: "Over",
    point: 44,
    price: -105,
  };
  assert.equal(oddsQuoteIsBetter(overLowerPoint, overHigherPoint), true);
  assert.equal(compareOddsQuotes(overHigherPoint, overLowerPoint) < 0, true);

  const underHigherPoint = {
    market: "total" as const,
    selection: "Under",
    point: 44,
    price: -120,
  };
  const underLowerPoint = { ...underHigherPoint, point: 43.5 };
  assert.equal(oddsQuoteIsBetter(underHigherPoint, underLowerPoint), true);
  assert.equal(
    oddsQuoteIsBetter(
      { ...underHigherPoint, price: -105 },
      { ...underHigherPoint, price: -110 },
    ),
    true,
  );
});

test("does not treat a missing quote as better and freezes at the kickoff boundary", () => {
  const quote = {
    market: "moneyline" as const,
    selection: "DAL",
    point: null,
    price: -150,
  };
  assert.equal(oddsQuoteIsBetter(undefined, quote), false);
  assert.equal(oddsQuoteIsBetter(quote, undefined), true);

  const kickoff = new Date("2026-09-10T19:00:00.000Z");
  assert.equal(isPreKickoffCapture(new Date("2026-09-10T18:59:59.999Z"), kickoff), true);
  assert.equal(isPreKickoffCapture(kickoff, kickoff), false);
  assert.equal(isPreKickoffCapture(new Date("2026-09-10T19:00:00.001Z"), kickoff), false);
  // Provider source time must not override the local capture boundary.
  assert.equal(isPreKickoffCapture(new Date("2026-09-10T18:59:59.999Z"), kickoff), true);
});

const fixtureKickoff = new Date("2026-09-10T19:00:00.000Z");
const fixtureGame = {
  gameId: "gridline-1",
  kickoffTime: fixtureKickoff,
  homeTeamId: "DAL",
  awayTeamId: "PHI",
  homeAbbreviation: "DAL",
  awayAbbreviation: "PHI",
  homeTeamName: "Dallas Cowboys",
  awayTeamName: "Philadelphia Eagles",
};

test("retains the existing 36-hour nearest matching behavior while exposing candidates", () => {
  const result = diagnoseOddsEventMatch(
    {
      id: "provider-1",
      home_team: "Dallas",
      away_team: "Philadelphia Eagles",
      commence_time: fixtureKickoff.toISOString(),
    },
    [fixtureGame],
  );
  assert.equal(result.game?.gameId, "gridline-1");
  assert.equal(result.reason, null);
  assert.deepEqual(result.candidates, [{
    gridlineGameId: "gridline-1",
    kickoffTime: fixtureKickoff.toISOString(),
    timeDifferenceMinutes: 0,
  }]);

  const outside = diagnoseOddsEventMatch(
    {
      id: "provider-outside",
      home_team: "Dallas",
      away_team: "Philadelphia Eagles",
      commence_time: new Date(fixtureKickoff.getTime() + 36 * 60 * 60 * 1000 + 1).toISOString(),
    },
    [fixtureGame],
  );
  assert.equal(outside.game, null);
  assert.equal(outside.reason, "outside_tolerance");
  assert.equal(outside.candidates[0]?.gridlineGameId, "gridline-1");
});

test("diagnoses invalid fields, missing teams, and nearest-candidate ambiguity", () => {
  const invalid = diagnoseOddsEventMatch(
    { id: "bad", home_team: "Dallas", away_team: null, commence_time: "bad-time" },
    [fixtureGame],
  );
  assert.equal(invalid.reason, "invalid_fields");

  const noTeams = diagnoseOddsEventMatch(
    {
      id: "no-team",
      home_team: "New York Giants",
      away_team: "Philadelphia Eagles",
      commence_time: fixtureKickoff.toISOString(),
    },
    [fixtureGame],
  );
  assert.equal(noTeams.reason, "no_matching_teams");

  const second = {
    ...fixtureGame,
    gameId: "gridline-2",
    kickoffTime: new Date(fixtureKickoff.getTime() + 30_000),
  };
  const ambiguous = diagnoseOddsEventMatch(
    {
      id: "ambiguous",
      home_team: "Dallas",
      away_team: "Philadelphia Eagles",
      commence_time: new Date(fixtureKickoff.getTime() + 15_000).toISOString(),
    },
    [fixtureGame, second],
  );
  assert.equal(ambiguous.game, null);
  assert.equal(ambiguous.reason, "ambiguity");
  assert.deepEqual(
    ambiguous.candidates.map((candidate) => candidate.gridlineGameId),
    ["gridline-1", "gridline-2"],
  );

  const missing = diagnoseOddsEventMatch(
    {
      id: "missing-schedule",
      home_team: "Dallas",
      away_team: "Philadelphia Eagles",
      commence_time: fixtureKickoff.toISOString(),
    },
    [],
  );
  assert.equal(missing.reason, "missing_schedule");
});

test("expands only within the exposed regular/postseason week bounds", () => {
  assert.deepEqual(getExposedScheduleWeeks(18), [18, 19, 20]);
  assert.deepEqual(getExposedScheduleWeeks(21), [21, 22]);
  assert.deepEqual(getExposedScheduleWeeks(22), [22]);
  assert.deepEqual(getExposedScheduleWeeks(23), []);
});

test("keeps matched audit reasons explicit for saved, duplicate, and empty observations", () => {
  assert.equal(classifyMatchedAuditReason(2, 0), "saved_observation");
  assert.equal(classifyMatchedAuditReason(0, 3), "duplicate_observation");
  assert.equal(classifyMatchedAuditReason(0, 0), "no_observations");
});

test("marks a matched event as post-kickoff without changing matching", () => {
  assert.deepEqual(
    classifyMatchedEvent(fixtureKickoff, new Date(fixtureKickoff.getTime() + 1)),
    { outcome: "matched_post_kickoff_skipped", reason: "postkickoff" },
  );
  assert.deepEqual(
    classifyMatchedEvent(fixtureKickoff, new Date(fixtureKickoff.getTime() - 1)),
    { outcome: "matched_saved", reason: null },
  );
});
