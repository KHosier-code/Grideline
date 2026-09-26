import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { primaryUsage, sortUsagePlayers, trendLabel, usageChartData } from "./consumer-usage.ts";
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

test("public navigation and signed-out routing expose player usage", () => {
  const source = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");
  const publicRoutes = source.split("if (!isSignedIn) return")[1]?.split("return <RoutedErrorBoundary><Switch>")[0];
  assert.ok(publicRoutes, "signed-out routes must exist");
  assert.match(publicRoutes, /<Route path="\/usage"><ConsumerShell><ConsumerUsage \/><\/ConsumerShell><\/Route>/);
  assert.match(source, /\{ href: '\/usage', label: 'Player Usage'/);
});

test("position-aware overview uses observed volume and yardage without mixing roles", () => {
  const source = readFileSync(fileURLToPath(new URL("../pages/consumer/ConsumerUsage.tsx", import.meta.url)), "utf8");
  for (const name of ["attempts", "completions", "passingYards", "passingTds", "rushingYards", "receivingYards"]) assert.match(source, new RegExp(`['"]${name}['"]`));
  assert.deepEqual(primaryUsage({ position: "QB" }), { volume: "attempts", volumeLabel: "Att", yards: "passingYards" });
  assert.deepEqual(primaryUsage({ position: "RB" }), { volume: "carries", volumeLabel: "Carries", yards: "rushingYards" });
  assert.deepEqual(primaryUsage({ position: "WR" }), { volume: "targets", volumeLabel: "Targets", yards: "receivingYards" });
  const players = [
    { playerName: "No record", position: "QB", trend: "unavailable" as const, aggregate: { attempts: { value: null }, passingYards: { value: null } } },
    { playerName: "Runner", position: "RB", trend: "flat" as const, aggregate: { carries: { value: 9 }, rushingYards: { value: 40 } } },
    { playerName: "Passer", position: "QB", trend: "up" as const, aggregate: { attempts: { value: 25 }, passingYards: { value: 250 } } },
  ];
  assert.deepEqual(sortUsagePlayers(players, "primaryVolume", "desc").map(p => p.playerName), ["Passer", "Runner", "No record"]);
  assert.deepEqual(sortUsagePlayers(players, "primaryYards", "asc").map(p => p.playerName), ["Runner", "Passer", "No record"]);
});

test("usage page has a compact filter toolbar, separately readable mobile list and keyboard-accessible details", () => {
  const source = readFileSync(fileURLToPath(new URL("../pages/consumer/ConsumerUsage.tsx", import.meta.url)), "utf8");
  assert.match(source, /availableTeams\.map/);
  for (const filter of ["team", "position", "window", "game"]) assert.match(source, new RegExp(`select-usage-${filter}`));
  assert.match(source, /<details className="mt-3/);
  assert.match(source, /button-usage-reset/);
  assert.match(source, /setGame\(''\)/);
  assert.match(source, /table-usage-players/);
  assert.match(source, /list-usage-players/);
  assert.match(source, /hidden lg:block/);
  assert.match(source, /lg:hidden/);
  assert.doesNotMatch(source, /min-w-\[1290px\]|colSpan=/);
  assert.match(source, /aria-sort=/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /<Dialog open=/);
  assert.match(source, /<DialogTitle/);
  assert.match(source, /<DialogDescription/);
  assert.match(source, /list-usage-game-history/);
  assert.match(source, /redZoneAvailable && \(game\.metrics\.redZoneTouches\?\.available/);
  assert.match(source, /sourceCoverage\.includedGames/);
  assert.match(source, /redZoneAvailable/);
  assert.match(source, /redZoneEnabled && <Link href="\/red-zone"/);
});

test("usage keeps loading, empty, partial, and missing-stat explanations visible", () => {
  const source = readFileSync(fileURLToPath(new URL("../pages/consumer/ConsumerUsage.tsx", import.meta.url)), "utf8");
  assert.match(source, /query\.isLoading \? <ConsumerLoading/);
  assert.match(source, /query\.isError/);
  assert.match(source, /No players found/);
  assert.match(source, /query\.data\.status === 'partial'/);
  assert.match(source, /A dash means unavailable, not zero/);
  assert.match(source, /Observed stats only; no touchdown forecast probabilities/);
});

test("usage interactions emit bounded analytics without player or game identifiers", () => {
  const source = readFileSync(fileURLToPath(new URL("../pages/consumer/ConsumerUsage.tsx", import.meta.url)), "utf8");
  assert.match(source, /usage_filter_changed/);
  assert.match(source, /usage_sort_changed/);
  assert.match(source, /usage_row_toggled/);
  assert.match(source, /value: value \? 'specific_game' : 'all'/);
  assert.doesNotMatch(source, /trackEvent\([^)]*playerId/s);
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