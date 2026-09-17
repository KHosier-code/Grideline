import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type PackageJson = {
  scripts?: Record<string, string>;
};

const workspaceRoot = new URL("../../", import.meta.url);

function readPackageJson(relativePath: string): PackageJson {
  return JSON.parse(
    readFileSync(new URL(relativePath, workspaceRoot), "utf8"),
  ) as PackageJson;
}

function requireScript(packageJson: PackageJson, scriptName: string): string {
  const script = packageJson.scripts?.[scriptName];
  assert.ok(script, `Expected package script "${scriptName}" to exist`);
  return script;
}

function countLiteral(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const rootPackage = readPackageJson("package.json");
const apiPackage = readPackageJson("artifacts/api-server/package.json");

test("standalone API typecheck rebuilds shared declarations", () => {
  const pretypecheck = requireScript(apiPackage, "pretypecheck");

  assert.match(pretypecheck, /pnpm --dir \.\.\/\.\. run typecheck:libs/);
  assert.match(pretypecheck, /WORKSPACE_LIBS_PREBUILT/);
  assert.match(pretypecheck, /!= "1"/);
});

test("root typecheck builds shared declarations exactly once", () => {
  const rootTypecheck = requireScript(rootPackage, "typecheck");
  const apiPretypecheck = requireScript(apiPackage, "pretypecheck");

  assert.equal(countLiteral(rootTypecheck, "run typecheck:libs"), 1);
  assert.match(rootTypecheck, /WORKSPACE_LIBS_PREBUILT=1/);

  const apiBuildsWhenRootSignalIsSet =
    /WORKSPACE_LIBS_PREBUILT/.test(apiPretypecheck) &&
    /!= "1"/.test(apiPretypecheck)
      ? 0
      : countLiteral(apiPretypecheck, "run typecheck:libs");

  assert.equal(
    countLiteral(rootTypecheck, "run typecheck:libs") +
      apiBuildsWhenRootSignalIsSet,
    1,
  );
});

test("root fast regression checks include this contract without typechecking", () => {
  const rootFastTests = requireScript(rootPackage, "test:fast");

  assert.match(
    rootFastTests,
    /--filter @workspace\/scripts run test:typecheck-script-contract/,
  );
  assert.doesNotMatch(rootFastTests, /\b(?:build|typecheck)\b(?!-script-contract)/);
});
