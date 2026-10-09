import assert from "node:assert/strict";
import test from "node:test";
import type { TouchdownPickRow } from "@workspace/db";
import {
  boardForWeek, bookComparison, bookFairProbability, decimalOdds, expectedValue, fairAmericanOdds, isValuePick, topTenRecord, valueRecord,
} from "./touchdown-board";

const factors = {
  targetsPerGame: null, carriesPerGame: null, targetShare: null, carryShare: null, redZoneTouchesPerGame: null,
  redZoneShare: null, goalLineShare: null, teamImpliedPoints: null, opponentTdsAllowedRatio: null, recentTdRate: null,
};
const pick = (playerId: string, probability: number, kickoff: string): TouchdownPickRow => ({
  playerId, name: playerId, position: "RB", team: "AAA", opponent: "BBB", isHome: true, kickoff, probability,
  injuryStatus: null, factors,
});
const THU = "2026-10-02T00:15:00Z";
const SUN = "2026-10-04T17:00:00Z";

test("Thursday players keep the ranking published before Thursday", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("thu", 0.4, THU), pick("sun", 0.3, SUN)] },
    // Saturday run: Thursday game already played, so only Sunday players.
    { generatedAt: new Date("2026-10-03T12:00:00Z"), picks: [pick("sun", 0.35, SUN)] },
  ];
  const board = boardForWeek(runs, new Date("2026-10-03T13:00:00Z"));
  assert.deepEqual(board.map((entry) => [entry.playerId, entry.probability]), [["thu", 0.4], ["sun", 0.35]]);
});

test("a run made after kickoff never replaces the pre-game number", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("thu", 0.4, THU)] },
    { generatedAt: new Date("2026-10-02T12:00:00Z"), picks: [pick("thu", 0.9, THU)] },
  ];
  assert.equal(boardForWeek(runs, new Date("2026-10-03T00:00:00Z"))[0].probability, 0.4);
});

test("a player dropped from the latest run before their game is removed", () => {
  const runs = [
    { generatedAt: new Date("2026-09-29T12:00:00Z"), picks: [pick("out", 0.5, SUN), pick("sun", 0.3, SUN)] },
    { generatedAt: new Date("2026-10-03T12:00:00Z"), picks: [pick("sun", 0.3, SUN)] },
  ];
  assert.deepEqual(boardForWeek(runs, new Date("2026-10-03T13:00:00Z")).map((entry) => entry.playerId), ["sun"]);
});

test("fair odds", () => {
  assert.equal(fairAmericanOdds(0.5), -100);
  assert.equal(fairAmericanOdds(0.25), 300);
  assert.equal(fairAmericanOdds(0.6), -150);
});

test("top-10 record only counts fully graded weeks", () => {
  const board = Array.from({ length: 12 }, (_, index) => ({ ...pick(`p${index}`, 0.5 - index / 100, SUN), generatedAt: new Date(), lockedAt: new Date() }));
  const results = new Map(board.map((entry, index) => [entry.playerId, index % 2 === 0]));
  const record = topTenRecord([{ week: 4, board, results }]);
  assert.deepEqual([record.weeksGraded, record.topTenPicks, record.topTenHits], [1, 10, 5]);
  assert.ok(Math.abs(record.expectedHits - 4.55) < 0.06, `${record.expectedHits}`);
  assert.deepEqual(record.priced, { picks: 0, hits: 0, units: 0 });
  const partial = new Map([...results].slice(0, 5));
  assert.equal(topTenRecord([{ board, results: partial }]).weeksGraded, 0);
});

test("top-10 profit uses each pick's book price and skips unpriced picks", () => {
  const board = Array.from({ length: 10 }, (_, index) => ({ ...pick(`p${index}`, 0.4, SUN), generatedAt: new Date(), lockedAt: new Date() }));
  const results = new Map(board.map((entry, index) => [entry.playerId, index < 4]));
  // Hits at -150 pay 0.667 each; misses lose 1; p9 has no price.
  const record = topTenRecord([{ week: 5, board, results, price: (entry) => entry.playerId === "p9" ? null : -150 }]);
  assert.deepEqual(record.priced, { picks: 9, hits: 4, units: -2.33 });
  assert.equal(record.weeks[0].pricedPicks, 9);
});

test("value picks are top-5 picks priced longer than fair odds", () => {
  assert.equal(decimalOdds(150), 2.5);
  assert.equal(decimalOdds(-200), 1.5);
  assert.ok(Math.abs(expectedValue(0.6, -120) - 0.1) < 1e-9);
  assert.equal(isValuePick(1, 0.6, -120), true);   // fair is -150, book pays more
  assert.equal(isValuePick(1, 0.6, -200), false);  // book pays less than fair
  assert.equal(isValuePick(6, 0.6, -120), false);  // outside the top 5
  assert.equal(isValuePick(1, 0.6, null), false);  // no price captured
});

test("value record counts graded value picks at 1 unit each", () => {
  const board = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ ...pick(id, 0.6 - index * 0.01, SUN), generatedAt: new Date(), lockedAt: new Date() }));
  const prices: Record<string, number> = { a: -120, b: 110, c: -300, d: 150, f: 400 };
  const results = new Map([["a", true], ["b", false], ["c", true], ["f", true]]);
  const record = valueRecord([{ week: 4, board, results, price: (entry) => prices[entry.playerId] ?? null }]);
  // a wins at -120 (+0.83), b loses (-1); c isn't value; d has no result yet; e has no price; f is outside the top 5.
  assert.deepEqual(record, { picks: 2, hits: 1, units: -0.17, weeks: [{ week: 4, picks: 2, hits: 1, units: -0.17 }] });
});

test("book chance takes the cut out and averages the books", () => {
  // +150 implies 40%; with a 20% cut the fair chance is 33.3%.
  assert.ok(Math.abs(bookFairProbability([150])! - 0.4 / 1.2) < 1e-9);
  assert.ok(Math.abs(bookFairProbability([150, 100])! - 0.45 / 1.2) < 1e-9);
  assert.equal(bookFairProbability([]), null);
});

test("book comparison scores both sets of chances on the same players", () => {
  const rows = [
    { week: 4, probability: 0.6, bookProbability: 0.5, scored: true },
    { week: 4, probability: 0.2, bookProbability: 0.3, scored: false },
    { week: 5, probability: 0.5, bookProbability: 0.5, scored: false },
  ];
  const result = bookComparison(rows);
  assert.equal(result.players, 3);
  assert.equal(result.weeks, 2);
  assert.equal(result.modelBrier, Math.round(((0.16 + 0.04 + 0.25) / 3) * 10000) / 10000);
  assert.equal(result.bookBrier, Math.round(((0.25 + 0.09 + 0.25) / 3) * 10000) / 10000);
  assert.ok(result.modelLogLoss! < result.bookLogLoss!);
  assert.equal(bookComparison([]).modelBrier, null);
});

test("a touchdown run received after kickoff doesn't change that game's board", () => {
  const before = { generatedAt: new Date("2026-10-04T14:00:00Z"), picks: [pick("p", 0.3, SUN)] };
  const late = { generatedAt: new Date("2026-10-04T15:00:00Z"), receivedAt: new Date("2026-10-04T18:00:00Z"), picks: [pick("p", 0.9, SUN)] };
  const [entry] = boardForWeek([before, late], new Date("2026-10-05T00:00:00Z"));
  assert.equal(entry.probability, 0.3);
});
