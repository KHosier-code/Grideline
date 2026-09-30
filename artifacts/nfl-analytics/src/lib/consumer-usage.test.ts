import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundedUsageSearch, defaultUsageFilters, discoverUsagePlayers, formatUsageMetric, MAX_USAGE_SEARCH_LENGTH, parseUsageSearch, primaryUsage, serializeUsageSearch, sortUsagePlayers, trendLabel, usageChartData } from "./consumer-usage.ts";
import { trackEvent } from "./analytics.ts";

test("usage chart transformation preserves unavailable values", () => {
  assert.deepEqual(usageChartData([
    { week: 1, metrics: { targets: { value: 4 }, carries: { value: null } } },
    { week: 2, metrics: { targets: { value: 0 }, carries: { value: 3 } } },
  ]), [
    { name: "W1", targets: 4, carries: undefined, passingYards: undefined },
    { name: "W2", targets: 0, carries: 3, passingYards: undefined },
  ]);
});

test("usage trend labels distinguish flat from unavailable", () => {
  assert.equal(trendLabel("flat"), "Flat");
  assert.equal(trendLabel("unavailable"), "Trend unavailable");
});

test("usage sorting keeps unavailable values last in either direction", () => {
  const players = [
    { playerName: "Unavailable", trend: "unavailable" as const, aggregate: { targets: { value: null } } },
    { playerName: "High", trend: "up" as const, aggregate: { targets: { value: 8 } } },
    { playerName: "Low", trend: "down" as const, aggregate: { targets: { value: 2 } } },
  ];
  assert.deepEqual(sortUsagePlayers(players, "targets", "desc").map((player) => player.playerName), ["High", "Low", "Unavailable"]);
  assert.deepEqual(sortUsagePlayers(players, "targets", "asc").map((player) => player.playerName), ["Low", "High", "Unavailable"]);
});

test("usage URLs round-trip supported filters and sort without storing defaults", () => {
  const selected = { team: "BUF", position: "QB" as const, window: "last8" as const, game: "matchup-123", search: "Josh Allen", includeZero: true, sort: "totalTd" as const, direction: "asc" as const };
  const search = serializeUsageSearch(selected);
  assert.deepEqual(parseUsageSearch(search, new Set(["matchup-123"])), selected);
  assert.equal(serializeUsageSearch(defaultUsageFilters), "");
  assert.equal(serializeUsageSearch(parseUsageSearch(search, new Set(["matchup-123"]))), search);
  assert.ok(!search.includes("playerId"));
  const washington = parseUsageSearch("?team=WSH&position=WR", new Set());
  assert.equal(washington.team, "WSH");
  assert.equal(serializeUsageSearch(washington), "team=WSH&position=WR");
});

test("usage URLs reject unknown fields and invalid values and never trust an unverified cutoff", () => {
  const search = "?team=XYZ&position=K&window=all&game=made-up&sort=playerId&direction=sideways&player=private";
  assert.deepEqual(parseUsageSearch(search, new Set(["real-game"])), defaultUsageFilters);
  assert.deepEqual(parseUsageSearch("?team=BUF&game=real-game", null), { ...defaultUsageFilters, team: "BUF" });
  assert.deepEqual(parseUsageSearch("?game=real-game", new Set(["real-game"])), { ...defaultUsageFilters, game: "real-game" });
  assert.equal(serializeUsageSearch(parseUsageSearch(search, new Set())), "");
  assert.deepEqual(parseUsageSearch("?includeZero=true&sort=relevance&direction=asc", new Set()), defaultUsageFilters);
  assert.equal(parseUsageSearch(`?search=${encodeURIComponent("x".repeat(100))}`, new Set()).search.length, MAX_USAGE_SEARCH_LENGTH);
  assert.equal(boundedUsageSearch("a\nb"), "ab");
});

test("discovery matches names without inventing evidence or treating missing volume as zero", () => {
  const player = (name: string, position: string, metric: string, value: number | null, available = value !== null, games = [1]) => ({
    playerId: name, playerName: name, teamId: "BUF", position, trend: "flat" as const,
    aggregate: { [metric]: { value, available } }, games,
    sourceCoverage: { includedGames: games.length, requestedGames: 2 },
  });
  const players = [
    player("Josh Allen", "QB", "attempts", 30), player("Zero QB", "QB", "attempts", 0),
    player("Null RB", "RB", "carries", null), player("Zero RB", "RB", "carries", 0),
    player("Zero WR", "WR", "targets", 0), player("Zero TE", "TE", "targets", 0),
    player("Unavailable WR", "WR", "targets", 0, false),
    player("No games", "WR", "targets", 4, true, []),
  ];
  assert.deepEqual(discoverUsagePlayers(players, "", false).map(p => p.playerName), ["Josh Allen", "Null RB", "Unavailable WR"]);
  assert.deepEqual(discoverUsagePlayers(players, " zErO ", true).map(p => p.playerName), ["Zero QB", "Zero RB", "Zero WR", "Zero TE"]);
  assert.deepEqual(discoverUsagePlayers(players, "not here", true), []);
  assert.equal(discoverUsagePlayers(players, "", true).length, 7);
});

test("default relevance compares role-adjusted usage and observed coverage with deterministic ties", () => {
  const player = (playerName: string, playerId: string, position: string, volume: number | null, includedGames = 5) => ({
    playerName, playerId, teamId: "BUF", position, trend: "flat" as const,
    aggregate: { [primaryUsage({ position }).volume]: { value: volume, available: volume !== null } },
    sourceCoverage: { includedGames, requestedGames: 5 },
  });
  const players = [
    player("QB raw volume", "q", "QB", 50), player("WR regular", "w", "WR", 35),
    player("WR partial", "p", "WR", 35, 2), player("RB full", "r", "RB", 75),
    player("Missing", "m", "TE", null), player("RB full", "r2", "RB", 75),
  ];
  assert.deepEqual(sortUsagePlayers(players, "relevance", "desc").map(p => p.playerId), ["r", "r2", "w", "q", "p", "m"]);
  assert.equal(sortUsagePlayers([player("Alphabetical QB", "qa", "QB", 100), player("Zed WR", "wz", "WR", 60)], "relevance", "desc")[0]?.playerId, "wz");
  assert.deepEqual(sortUsagePlayers(players, "primaryVolume", "desc").map(p => p.playerId), ["r", "r2", "q", "p", "w", "m"]);
  assert.deepEqual(sortUsagePlayers(players, "name", "asc").map(p => p.playerId), ["m", "q", "r", "r2", "p", "w"]);
});

test("usage-specific metric units preserve zero and unavailable", () => {
  assert.equal(formatUsageMetric(0), "0");
  assert.equal(formatUsageMetric(312.0), "312");
  assert.equal(formatUsageMetric(0, "percent"), "0.0%");
  assert.equal(formatUsageMetric(0.235, "percent"), "23.5%");
  assert.equal(formatUsageMetric(7.26, "average"), "7.3");
  assert.equal(formatUsageMetric(null), "—");
});

test("public navigation and signed-out routing expose player usage", () => {
  const source = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
  const publicRoutes = source.split("if (!isSignedIn) return")[1]?.split("return <RoutedErrorBoundary><Switch>")[0];
  assert.ok(publicRoutes, "signed-out routes must exist");
  assert.match(publicRoutes, /<Route path="\/usage"><ConsumerShell><ConsumerUsage \/><\/ConsumerShell><\/Route>/);
  const shell = readFileSync(fileURLToPath(new URL("../components/ConsumerShellView.tsx", import.meta.url)), "utf8");
  assert.match(shell, /\{ href: '\/usage', label: 'Player Usage'/);
  assert.match(source, /import\('@\/pages\/consumer\/PlayerUsage'\)/);
});

test("usage analytics copies bounded payloads without blocking interactions", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { umami: { track: () => undefined } },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (url: string, init: RequestInit) => {
      requests.push({ url, body: String(init.body) });
      return Promise.reject(new Error("analytics unavailable"));
    },
  });

  try {
    assert.doesNotThrow(() => trackEvent("usage_filters_reset", {
      had_team: true,
      had_position: false,
      had_game: false,
      window: "last5",
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests[0]?.url, "/api/analytics/usage-event");
    assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
      eventName: "usage_filters_reset",
      hadTeam: true,
      hadPosition: false,
      hadGame: false,
      window: "last5",
    });
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  }
});