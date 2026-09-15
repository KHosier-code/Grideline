import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const routeFiles = ["settings.ts", "data-sync.ts", "models.ts", "features.ts", "predictions.ts"];

test("every mutation route in protected route modules requires an administrator", () => {
  const mutationDeclaration = /router\.(post|put|patch|delete)\s*\([\s\S]*?(?:=>|\);)/g;

  for (const routeFile of routeFiles) {
    const source = readFileSync(fileURLToPath(new URL(`./${routeFile}`, import.meta.url)), "utf8");
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
    ["dashboard.ts", '/data-health'],
    ["models.ts", '/models/lab'],
    ["models.ts", '/models/evaluations/audit'],
    ["models.ts", '/models/promotions'],
    ["models.ts", '/models/drift'],
    ["models.ts", '/admin/lifecycle-verification'],
    ["predictions.ts", '/predictions/live'],
    ["predictions.ts", '/predictions/current-week'],
    ["predictions.ts", '/predictions/games/:gameId'],
    ["predictions.ts", '/predictions/validation-failures'],
    ["predictions.ts", '/predictions/performance'],
    ["predictions.ts", '/predictions/reports'],
    ["features.ts", '/features/pregame/health'],
    ["features.ts", '/features/pregame/game/:gameId'],
    ["features.ts", '/features/audit'],
    ["features.ts", '/features/personnel-context/game/:gameId'],
    ["features.ts", '/features/personnel-context/audit'],
    ["features.ts", '/features/personnel-context/coverage'],
    ["features.ts", '/features/personnel-context/challenger-readiness'],
  ];
  for (const [routeFile, path] of sensitiveReads) {
    const source = readFileSync(fileURLToPath(new URL(`./${routeFile}`, import.meta.url)), "utf8");
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      source,
      new RegExp(`router\\.get\\(\\s*["']${escapedPath}["']\\s*,\\s*requireAdmin\\b`),
      `${routeFile} must protect ${path}`,
    );
  }
});

test("consumer API is public and read-only", () => {
  const source = readFileSync(fileURLToPath(new URL("./consumer.ts", import.meta.url)), "utf8");
  const expected = [
    "/consumer/dashboard",
    "/consumer/games",
    "/consumer/games/:gameId",
    "/consumer/performance",
    "/consumer/trends",
    "/consumer/props",
  ];
  for (const path of expected) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(source, new RegExp(`router\\.get\\(\\s*["']${escapedPath}["']`));
  }
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\s*\(/);
  assert.doesNotMatch(source, /\brequireAdmin\b/);
});