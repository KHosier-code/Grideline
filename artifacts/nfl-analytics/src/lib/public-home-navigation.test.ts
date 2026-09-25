import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

test("public homepage exposes a sign-in link", () => {
  assert.match(appSource, /<Link href="\/sign-in"[^>]*data-testid="link-public-sign-in">Sign in<\/Link>/);
  assert.match(appSource, /<Route path="\/"><ConsumerShell><ConsumerHome \/><\/ConsumerShell><\/Route>/);
});

test("authenticated visitors get the consumer dashboard while admins keep a separate admin link", () => {
  assert.match(appSource, /isSignedIn \? <Link href="\/"[^>]*data-testid="link-open-dashboard">Open dashboard<\/Link>/);
  assert.match(appSource, /admin\.data === true && <Link href="\/admin"><ShieldCheck \/>Admin<\/Link>/);
});