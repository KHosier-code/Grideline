import assert from "node:assert/strict";
import test from "node:test";
import type { TouchdownPickRow } from "@workspace/db";
import { boardForWeek, fairAmericanOdds, topTenRecord } from "./touchdown-board";

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
  const board = Array.from({ length: 12 }, (_, index) => ({ ...pick(`p${index}`, 0.5 - index / 100, SUN), generatedAt: new Date() }));
  const results = new Map(board.map((entry, index) => [entry.playerId, index % 2 === 0]));
  assert.deepEqual(topTenRecord([{ board, results }]), { weeksGraded: 1, topTenPicks: 10, topTenHits: 5 });
  const partial = new Map([...results].slice(0, 5));
  assert.deepEqual(topTenRecord([{ board, results: partial }]), { weeksGraded: 0, topTenPicks: 0, topTenHits: 0 });
});
