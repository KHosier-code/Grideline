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