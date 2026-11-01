import test from "node:test";
import assert from "node:assert/strict";
import type { RequestHandler } from "express";
import { createRequireAdminUntilCbbLaunch } from "./cbb-launch";

const denied: RequestHandler = (_req, res) => { res.status(403).json({}); };

function run(at: string) {
  let status: number | null = null;
  let passed = false;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } };
  createRequireAdminUntilCbbLaunch(denied, () => Date.parse(at))({} as never, res as never, () => { passed = true; });
  return { status, passed };
}

test("college basketball API stays admin-only before launch", () => {
  assert.deepEqual(run("2026-11-30T20:00:00Z"), { status: 403, passed: false });
});

test("college basketball API opens to everyone at launch", () => {
  assert.deepEqual(run("2026-12-01T11:00:00Z"), { status: null, passed: true });
});
