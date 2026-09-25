import assert from "node:assert/strict";
import test from "node:test";
import {
  completeGameMarketObservation,
  consumerMarketFreshnessMinutes,
} from "./consumer-market-freshness";

const kickoff = new Date("2026-09-20T17:00:00Z");

test("market freshness follows the configured odds cadence with a delay margin", () => {
  assert.equal(consumerMarketFreshnessMinutes(kickoff, new Date("2026-09-18T17:00:00Z"), "spread"), 3_000);
  assert.equal(consumerMarketFreshnessMinutes(kickoff, new Date("2026-09-20T12:00:00Z"), "total"), 15);
  assert.equal(consumerMarketFreshnessMinutes(kickoff, new Date("2026-09-20T16:30:00Z"), "moneyline"), 8);
});

test("only a complete accepted game observation can reverify unchanged markets", () => {
  assert.equal(completeGameMarketObservation({
    outcome: "matched_saved", observationsReceived: 12, rejectedObservations: 0,
  }), true);
  assert.equal(completeGameMarketObservation({
    outcome: "matched_saved", observationsReceived: 10, rejectedObservations: 0,
  }), false);
  assert.equal(completeGameMarketObservation({
    outcome: "matched_saved", observationsReceived: 12, rejectedObservations: 1,
  }), false);
});