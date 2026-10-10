import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const routeFiles = ["settings.ts", "data-sync.ts", "features.ts"];

const routesDirectory = path.join(fileURLToPath(new URL("../../", import.meta.url)), "src/routes");
const routeSource = (routeFile: string) =>
  readFileSync(path.join(routesDirectory, routeFile), "utf8");

test("every mutation route in protected route modules requires an administrator", () => {
  const mutationDeclaration = /router\.(post|put|patch|delete)\s*\([\s\S]*?(?:=>|\);)/g;

  for (const routeFile of routeFiles) {
    const source = routeSource(routeFile);
    const declarations = [...source.matchAll(mutationDeclaration)];

    assert.ok(declarations.length > 0, `${routeFile} should define at least one mutation route`);
    for (const declaration of declarations) {
      assert.match(
        declaration[0],
        /\brequireAdmin\b/,
        `${routeFile} has an unguarded mutation route: ${declaration[0].split("\n")[0]}`,
      );
    }
  }
});

test("sensitive admin reads are not exposed through consumer routes", () => {
  const sensitiveReads: Array<[string, string]> = [
    ["settings.ts", '/settings'],
    ["dashboard.ts", '/dashboard/summary'],
    ["data-sync.ts", '/odds/audit'],
    ["data-sync.ts", '/admin/player-recovery/receipts'],
    ["dashboard.ts", '/data-health'],
    ["dashboard.ts", '/admin/sleeper-identity-report'],
    ["features.ts", '/features/pregame/health'],
    ["features.ts", '/features/pregame/game/:gameId'],
    ["features.ts", '/features/audit'],
    ["features.ts", '/features/personnel-context/game/:gameId'],
    ["features.ts", '/features/personnel-context/audit'],
    ["features.ts", '/features/personnel-context/coverage'],
    ["features.ts", '/features/personnel-context/challenger-readiness'],
    ["features.ts", '/features/personnel/current/team/:teamId'],
    ["features.ts", '/features/personnel/current/game/:gameId'],
    ["features.ts", '/features/personnel/current/team/:teamId/qb'],
    ["features.ts", '/features/personnel/current/team/:teamId/wr-cb'],
    ["features.ts", '/features/personnel/current/validation'],
    ["ops.ts", '/admin/ops'],
  ];
  for (const [routeFile, path] of sensitiveReads) {
    const source = routeSource(routeFile);
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      source,
      new RegExp(`router\\.get\\(\\s*["']${escapedPath}["']\\s*,\\s*requireAdmin\\b`),
      `${routeFile} must protect ${path}`,
    );
  }
});

test("consumer API is public and read-only", () => {
  const source = routeSource("consumer.ts");
  const expected = [
    "/consumer/dashboard",
    "/consumer/schedule-selection",
    "/consumer/games",
    "/consumer/games/:gameId",
    "/consumer/props",
  ];
  for (const path of expected) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`router\\.get\\(\\s*["']${escapedPath}["']`));
  }
  // The only writes are a signed-in user's own saved games, and each one
  // checks the session before doing anything.
  const writes = [...source.matchAll(/router\.(post|put|patch|delete)\(\s*["']([^"']+)["'][^\n]*\n([^\n]*)/g)];
  assert.deepEqual(writes.map((m) => `${m[1]} ${m[2]}`), [
    "put /consumer/saved-games/:gameId",
    "delete /consumer/saved-games/:gameId",
  ]);
  for (const write of writes) assert.match(write[3], /savedGameUser\(req, res\)/, `${write[2]} must require a signed-in user`);
  // Admin-only reads must say so.
  const adminRoutes = [...source.matchAll(/router\.get\(\s*["']([^"']+)["']\s*,\s*requireAdmin\b/g)].map((m) => m[1]);
  for (const path of adminRoutes) assert.match(path, /^\/admin\//, `${path} uses requireAdmin outside /admin`);
  assert.equal((source.match(/\brequireAdmin\b/g) ?? []).length, adminRoutes.length + 1, "requireAdmin is only imported and used on /admin routes");
  // Internal availability interpretation may read supplemental provider status,
  // but must not serialize provider identifiers or identity diagnostics.
  assert.doesNotMatch(
    source,
    /(?:sleeperIdentity|providerId|mappingConfidence|candidateEvidence)\s*:/i,
    "consumer responses must not expose provider identity diagnostics",
  );
});
