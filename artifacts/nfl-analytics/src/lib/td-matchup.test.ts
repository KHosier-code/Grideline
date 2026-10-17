import test from "node:test";
import assert from "node:assert/strict";
import { defenseEase, tdMatchupTones } from "./td-matchup.ts";

test("defense ease reads each rank in the right direction", () => {
  // Allows the most TDs, yards and red-zone looks; worst red-zone defense; worst EPA defense: easiest.
  assert.equal(defenseEase({ tdsRank: 1, yardsRank: 1, redZoneOppsRank: 1, allowedTripsPerGameRank: 32, allowedTdRateRank: 32, epaRank: 32 }), 1);
  assert.equal(defenseEase({ tdsRank: 32, yardsRank: 32, redZoneOppsRank: 32, allowedTripsPerGameRank: 1, allowedTdRateRank: 1, epaRank: 1 }), 0);
  // Missing ranks are skipped, not counted as average.
  assert.equal(defenseEase({ tdsRank: 1, epaRank: null }), 1);
  assert.equal(defenseEase({}), null);
});

test("tags blend the Vegas total with the defense, within each position", () => {
  const rb = (key: string, implied: number, rank: number) => ({ key, position: "RB", implied, defense: { tdsRank: rank, epaRank: 33 - rank } });
  const players = [
    rb("high-soft", 30, 1), rb("high-avg", 28, 16), rb("mid", 23, 16), rb("mid2", 22, 16), rb("low-avg", 17, 16), rb("low-hard", 15, 32),
    // A WR is ranked against WRs only.
    { key: "wr", position: "WR", implied: 15, defense: { tdsRank: 32 } },
  ];
  const tones = tdMatchupTones(players);
  assert.equal(tones.get("high-soft")!.tone, "favorable");
  assert.equal(tones.get("mid")!.tone, "neutral");
  assert.equal(tones.get("low-hard")!.tone, "tough");
  assert.equal(tones.get("wr")!.tone, "neutral"); // alone in its group
  // A soft defense can't make up for the lowest team total on the board.
  assert.notEqual(tdMatchupTones([rb("a", 30, 16), rb("b", 29, 16), rb("c", 15, 1), rb("d", 28, 16)]).get("c")!.tone, "favorable");
});
