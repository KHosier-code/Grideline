import assert from "node:assert/strict";
import test from "node:test";
import {
  compareOddsQuotes,
  findMissingOddsMarkets,
  getObservationKey,
  hashOddsState,
  hasCompleteOddsMarket,
  isPreKickoffCapture,
  normalizeTeamName,
  oddsQuoteIsBetter,
  parseOddsTimestamp,
} from "./odds";

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
