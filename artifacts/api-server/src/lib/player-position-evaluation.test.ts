import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlayerPositionMatchups } from "./player-position-evaluation";
import { completePositionGame, type DefenseInputs } from "./defense-vs-position";
import { publisherEvidenceBeforeKickoff, verifyPlayerPositionPublisherAsset } from "./player-position-releases";

function fixture(): DefenseInputs {
  const games = Array.from({ length: 12 }, (_, n) => ({
    gameId: `g${n + 1}`, season: 2025, week: n + 1, gameStatus: "STATUS_FINAL",
    kickoffTime: new Date(Date.UTC(2025, 8, n + 1, 18)),
    homeTeamId: "a", awayTeamId: "b",
  }));
  const stats = games.flatMap(g => ["AAA", "BBB"].flatMap((team, t) =>
    ["QB", "RB", "WR", "TE"].flatMap(position => Array.from({ length: 4 }, (_, p) => ({
      playerId: `${team}-${position}-${p}`, playerName: `${team}-${position}-${p}`,
      teamId: team, opponentTeamId: t ? "AAA" : "BBB",
      season: 2025, week: g.week, seasonType: "REG", position,
      attempts: 20 + p, passingYards: 200 + p,
      carries: 3 + p, rushingYards: 20 + p,
      targets: g.week === 6 ? 0 : 2 + p, receivingYards: 10 + p,
      sourceUpdatedAt: new Date("2026-02-01T00:00:00Z"),
    })))));
  const rzTeams = games.flatMap(g => ["AAA", "BBB"].map((team, t) => ({
    gameId: g.gameId, season: 2025, week: g.week, seasonType: "REG",
    teamId: team, opponentTeamId: t ? "AAA" : "BBB", zone: 20,
    ingestedAt: new Date("2026-02-01T00:00:00Z"),
  })));
  const rzPlayers = stats.map(s => ({
    gameId: `g${s.week}`, season: 2025, week: s.week, seasonType: "REG",
    teamId: s.teamId, opponentTeamId: s.opponentTeamId, zone: 20,
    playerId: s.playerId, position: s.position, ingestedAt: new Date("2026-02-01T00:00:00Z"),
  }));
  return { games, stats, rzTeams, rzPlayers,
    teams: [{ teamId: "a", abbreviation: "AAA" }, { teamId: "b", abbreviation: "BBB" }],
    sources: ["player_stats", "pbp"].map(dataset => ({
      season: 2025, dataset, status: "success",
    })),
  } as unknown as DefenseInputs;
}

test("same holdout cohort produces paired ablation and both calibration series, never live forecasts", () => {
  const report = evaluatePlayerPositionMatchups([fixture()], 2025, 2025);
  const wr = report.metrics["WR:targets"] as any;
  assert.equal(wr.defenseTrainingN, 0);
  assert.equal(wr.defenseCoveredN, 0);
  assert.equal(wr.pairedPlayerOnly.n, wr.pairedDefenseContext.n);
  assert.equal(wr.pairedPlayerOnlyCalibration.reduce((sum: number, b: { n: number }) => sum + b.n, 0),
    wr.defenseCoveredN);
  assert.equal(wr.pairedDefenseCalibration.reduce((sum: number, b: { n: number }) => sum + b.n, 0),
    wr.defenseCoveredN);
  assert.equal(wr.enabledLive, false);
  assert.equal(wr.releaseReadiness.currentRosterAndGameStatusVerified, false);
  assert.equal(wr.releaseReadiness.publicationChronologyVerified, false);
  assert.equal(report.missing.archivedPregameReleaseMissing > 0, true);
});

test("a missing PBP identity or null participant removes defensive coverage, not player outcomes", () => {
  const input = fixture();
  const game = input.games[6]!;
  const canonical = (id: string | null) => id === "a" || id === "AAA" ? "AAA"
    : id === "b" || id === "BBB" ? "BBB" : null;
  assert.ok(completePositionGame(input, game, "BBB", "AAA", "WR", "targets", canonical));
  input.rzPlayers = input.rzPlayers.filter(r => !(r.gameId === "g7" && r.playerId === "BBB-WR-0"));
  assert.equal(completePositionGame(input, game, "BBB", "AAA", "WR", "targets", canonical), null);
  input.stats.find(r => r.week === 8 && r.playerId === "BBB-WR-1")!.targets = null;
  assert.equal(completePositionGame(input, input.games[7]!, "BBB", "AAA", "WR", "targets", canonical), null);
  const partial = evaluatePlayerPositionMatchups([input], 2025, 2025);
  assert.equal((partial.metrics["WR:targets"] as any).enabledLive, false);
});

test("archived holdout uses only pregame versions and does not substitute a later capture", () => {
  const truth = fixture();
  const evidence = (dataset: "pbp" | "player_stats") => {
    const tag = dataset === "pbp" ? "pbp" : "stats_player";
    const name = dataset === "pbp" ? "play_by_play_2025.csv.gz" : "stats_player_week_2025.csv.gz";
    const url = `https://github.com/nflverse/nflverse-data/releases/download/${tag}/${name}`;
    const asset = { id: dataset === "pbp" ? 10 : 11, name, browser_download_url: url,
      url: `https://api.github.com/repos/nflverse/nflverse-data/releases/assets/${dataset === "pbp" ? 10 : 11}`,
      digest: `sha256:${"a".repeat(64)}`, size: 123,
      created_at: "2025-08-30T00:00:00Z", updated_at: "2025-08-31T00:00:00Z" };
    return { url, asset, proof: verifyPlayerPositionPublisherAsset({ tag_name: tag, assets: [asset] },
      dataset, 2025, url, "a".repeat(64), 123, new Date("2025-09-01T00:00:00Z"))! };
  };
  const proofs = [evidence("pbp"), evidence("player_stats")];
  const release = (beforeWeek: number) => ({
    capturedAt: new Date(Date.UTC(2025, 8, beforeWeek - 1, 19)),
    fingerprint: `release-${beforeWeek}`,
    input: {
      ...truth,
      games: truth.games.filter(g => g.week < beforeWeek),
      stats: truth.stats.filter(s => s.week < beforeWeek).map(s => ({
        ...s, sourceUpdatedAt: new Date("2025-09-01T00:00:00Z"),
      })),
      rzTeams: truth.rzTeams.filter(r => r.week < beforeWeek),
      rzPlayers: truth.rzPlayers.filter(r => r.week < beforeWeek),
      sources: truth.sources.map(s => ({ ...s, completedAt: new Date("2025-09-01T00:00:00Z"),
        sourceUrl: proofs.find(p => p.proof.dataset === s.dataset)!.url,
        sourceSha256: "a".repeat(64), fileSizeBytes: 123 })),
    },
    publisherEvidence: proofs.map(p => p.proof),
  });
  const releases = [release(9), release(10), release(11), release(12)];
  const report = evaluatePlayerPositionMatchups([truth], 2025, 2025, releases);
  const paired = (report.metrics["WR:targets"] as any).archivedAsOf;
  assert.ok(paired.trainingN > 0);
  assert.ok(paired.pairedHoldoutN > 0);
  assert.equal(paired.playerOnly.n, paired.defenseContext.n);
  assert.equal(paired.playerOnlyCalibration.reduce((n: number, b: { n: number }) => n + b.n, 0),
    paired.pairedHoldoutN);
  assert.equal((report.metrics["WR:targets"] as any).enabledLive, false);
  const late = evaluatePlayerPositionMatchups([truth], 2025, 2025,
    [{ ...release(9), capturedAt: new Date("2026-01-01T00:00:00Z") }]);
  assert.equal((late.metrics["WR:targets"] as any).archivedAsOf.pairedHoldoutN, 0);
  const changed = release(11);
  changed.publisherEvidence = changed.publisherEvidence.filter(p => p.dataset !== "pbp");
  assert.equal(publisherEvidenceBeforeKickoff(changed, 2025, truth.games[10]!.kickoffTime!), false);
  assert.equal((evaluatePlayerPositionMatchups([truth], 2025, 2025, [changed])
    .metrics["WR:targets"] as any).archivedAsOf.pairedHoldoutN, 0);
  assert.equal(verifyPlayerPositionPublisherAsset({ tag_name: "pbp", assets: [proofs[0]!.asset] },
    "pbp", 2025, proofs[0]!.url, "b".repeat(64), 123, new Date("2025-09-01T00:00:00Z")), null);
  assert.equal(verifyPlayerPositionPublisherAsset({ tag_name: "pbp", assets: [
    { ...proofs[0]!.asset, updated_at: "2025-09-12T00:00:00Z" },
  ] }, "pbp", 2025, proofs[0]!.url, "a".repeat(64), 123, new Date("2025-09-01T00:00:00Z")), null);
});
