import assert from "node:assert/strict";
import test from "node:test";
import { bestBookPrice, normalizePlayerName, parsePropOutcomes, type TouchdownPropsReport } from "./td-props";

test("player names match across punctuation, accents and suffixes", () => {
  assert.equal(normalizePlayerName("D.J. Moore"), normalizePlayerName("DJ Moore"));
  assert.equal(normalizePlayerName("Kenneth Walker III"), "kenneth walker");
  assert.equal(normalizePlayerName("Amon-Ra St. Brown"), "amonra st brown");
  assert.equal(normalizePlayerName("Marvin Harrison Jr."), "marvin harrison");
});

test("anytime-TD outcomes keep the Yes side per book", () => {
  const players = parsePropOutcomes({ bookmakers: [
    { key: "draftkings", markets: [{ key: "player_anytime_td", outcomes: [
      { name: "Yes", description: "Jahmyr Gibbs", price: -150 },
      { name: "No", description: "Jahmyr Gibbs", price: 115 },
    ] }] },
    { key: "fanduel", markets: [{ key: "player_anytime_td", outcomes: [{ name: "Yes", description: "Jahmyr Gibbs", price: -140 }] }] },
  ] });
  assert.deepEqual(players["jahmyr gibbs"], [{ book: "draftkings", price: -150 }, { book: "fanduel", price: -140 }]);
});

test("best price is the highest payout for the player's own game", () => {
  const report: TouchdownPropsReport = { capturedAt: "2026-10-03T14:00:00Z", creditsRemaining: 400, events: [
    { eventId: "a", teams: ["DET", "CAR"], commence: "2026-10-04T17:00:00Z",
      players: { "jahmyr gibbs": [{ book: "draftkings", price: -150 }, { book: "fanduel", price: -140 }] } },
    { eventId: "b", teams: ["SEA", "LAC"], commence: "2026-10-04T20:05:00Z",
      players: { "jahmyr gibbs": [{ book: "draftkings", price: 500 }] } },
  ] };
  const best = bestBookPrice(report, "Jahmyr Gibbs", "DET");
  assert.equal(best?.price, -140);
  assert.equal(best?.book, "fanduel");
  assert.equal(bestBookPrice(report, "Jahmyr Gibbs", "NYJ"), null);
  assert.equal(bestBookPrice(null, "Jahmyr Gibbs", "DET"), null);
});
