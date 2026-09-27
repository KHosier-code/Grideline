import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  db, pool, identitySourceImportsTable, imagerySourceRowsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin";
import imageryRouter from "../routes/verified-imagery";
import {
  IMAGE_PARSER_VERSION, invalidateImageEvidence, ROSTER_IMAGE_SOURCE,
  safeVerifiedImages, TEAM_IMAGE_SOURCE, verifiedImages,
} from "./verified-imagery";

type Report = {
  status: string;
  reason: string | null;
  sources: { teams: { stale?: boolean } | null; roster: { stale?: boolean } | null };
  candidates: { playerId: string; imageUrl: string }[];
};

const run = promisify(execFile);
const childSchema = process.env.GRIDLINE_IMAGERY_TEST_SCHEMA;

test("imagery persistence runs in a disposable development database schema", {
  skip: Boolean(childSchema),
}, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Imagery persistence fixture may only run in development");
  }
  const client = await pool.connect();
  const schema = `imagery_test_${randomUUID().replaceAll("-", "")}`;
  try {
    const identity = await client.query(`SELECT current_database() AS db, current_user AS role,
      pg_is_in_recovery() AS replica, inet_server_addr() IS NULL AS local_proxy`);
    const target = identity.rows[0];
    if (identity.rows.length !== 1 || target.db !== "heliumdb" || target.role !== "postgres"
      || target.replica || !target.local_proxy) {
      throw new Error("Refusing imagery fixture writes on an unverified development database");
    }
    await client.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["identity_source_imports", "imagery_source_rows"]) {
      await client.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    for (const table of ["nflverse_player_identities", "imagery_reviews", "teams", "players", "player_game_stats"]) {
      await client.query(`CREATE VIEW "${schema}"."${table}" AS SELECT * FROM public."${table}"`);
    }
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(), GRIDLINE_IMAGERY_TEST_SCHEMA: schema };
    delete childEnv.NODE_TEST_CONTEXT;
    const { stdout, stderr } = await run(process.execPath, ["--test", "--test-reporter=tap", fileURLToPath(import.meta.url)], {
      env: childEnv,
      timeout: 60_000,
    });
    assert.match(stdout + stderr, /ok \d+ - persisted imagery survives a cold cache and outage/);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});

test("persisted imagery survives a cold cache and outage, but not corrupted or obsolete receipts", {
  skip: !childSchema,
}, async () => {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Imagery persistence fixture may only run in development");
  }
  const originalFetch = globalThis.fetch;
  const receiptIds: number[] = [];
  let savedTeamRows: Record<string, string>[] = [];
  let savedRosterRows: Record<string, string>[] = [];
  const fixture = randomUUID();
  const gsis = `imagery-${fixture}`;
  const schedule = [{ teamId: `team-${fixture}`, abbreviation: "LAR", name: "Los Angeles Rams" }];
  const logo = `https://images.example.org/${fixture}/logo.png`;
  const photo = `https://images.example.org/${fixture}/photo.png`;
  const csv = new Map([
    [TEAM_IMAGE_SOURCE, `team_abbr,team_name,team_logo_espn\nLA,Los Angeles Rams,${logo}\n`],
    [ROSTER_IMAGE_SOURCE, `gsis_id,espn_id,pfr_id,pff_id,esb_id,smart_id,headshot_url\n${gsis},,,,,,${photo}\n`],
  ]);
  const reportRoute = (imageryRouter as unknown as { stack: Array<{
    route?: { path: string; stack: Array<{ handle: (req: never, res: never) => Promise<void> }> };
  }> }).stack.find(layer => layer.route?.path === "/admin/verified-imagery/report")?.route;
  assert.equal(reportRoute?.stack[0]?.handle, requireAdmin);
  const report = async () => {
    let body: Report | undefined;
    let code = 200;
    const response = {
      set() { return this; },
      status(status: number) { code = status; return this; },
      json(value: Report) { body = value; return this; },
    };
    await reportRoute!.stack.at(-1)!.handle({} as never, response as never);
    assert.ok(body, "admin handler must return a report");
    return { code, body };
  };
  try {
    globalThis.fetch = async (input) => {
      const text = csv.get(String(input));
      if (text === undefined) throw new Error("Unexpected remote request in imagery test");
      return new Response(text, { status: 200 });
    };
    invalidateImageEvidence();
    const fresh = await verifiedImages(schedule);
    assert.equal(fresh.teams.logos.get(schedule[0]!.teamId), logo);
    assert.equal(fresh.players.photos.get(gsis), photo);
    assert.equal(fresh.sources.roster?.stale, undefined);
    for (const label of ["teams", "roster"]) {
      const [receipt] = await db.select().from(identitySourceImportsTable).where(and(
        eq(identitySourceImportsTable.sourceNamespace, `nflverse-imagery-${label}`),
        eq(identitySourceImportsTable.sourceContentHash, label === "teams" ? fresh.sources.teams!.sha256 : fresh.sources.roster!.sha256),
      ));
      assert.ok(receipt, `${label} download was saved in the database`);
      receiptIds.push(receipt.id);
      const [payload] = await db.select().from(imagerySourceRowsTable)
        .where(eq(imagerySourceRowsTable.importId, receipt.id));
      assert.ok(payload?.rows.length, `${label} rows were saved`);
      if (label === "teams") savedTeamRows = payload.rows;
      if (label === "roster") savedRosterRows = payload.rows;
      // Force the fixture to be the latest receipt throughout this test.
      await db.update(identitySourceImportsTable).set({ importedAt: new Date("2099-01-01T00:00:00Z") })
        .where(eq(identitySourceImportsTable.id, receipt.id));
    }
    const [teamId, rosterId] = receiptIds;
    globalThis.fetch = async () => { throw new Error("Source offline"); };
    invalidateImageEvidence(); // A new API process would also start without the in-memory state.
    const restored = await verifiedImages(schedule);
    assert.equal(restored.teams.logos.get(schedule[0]!.teamId), logo);
    assert.equal(restored.players.photos.get(gsis), photo, JSON.stringify({
      sources: restored.sources, errors: restored.sourceErrors, players: [...restored.players.photos],
    }));
    assert.equal(restored.sources.teams?.stale, true);
    assert.equal(restored.sources.roster?.stale, true);
    const staleReport = await report();
    assert.equal(staleReport.code, 200);
    assert.equal(staleReport.body.status, "stale");
    assert.equal(staleReport.body.sources.teams?.stale, true);
    assert.equal(staleReport.body.sources.roster?.stale, true);
    assert.match(staleReport.body.reason ?? "", /using stale verified evidence/);
    assert.ok(staleReport.body.candidates.some(candidate => candidate.playerId === gsis && candidate.imageUrl === photo));

    await db.update(imagerySourceRowsTable).set({ rows: [{ team_abbr: "LA", team_name: "Los Angeles Rams", team_logo_espn: "https://images.example.org/tampered.png" }] })
      .where(eq(imagerySourceRowsTable.importId, teamId!));
    invalidateImageEvidence();
    const noLogo = await verifiedImages(schedule);
    assert.equal(noLogo.teams.logos.size, 0);
    assert.equal(noLogo.players.photos.get(gsis), photo);
    assert.ok(noLogo.sourceErrors.includes("teams has no valid persisted evidence"));

    await db.update(imagerySourceRowsTable).set({ rows: savedTeamRows })
      .where(eq(imagerySourceRowsTable.importId, teamId!));
    await db.update(imagerySourceRowsTable).set({ rows: [{ ...savedRosterRows[0]!, headshot_url: "https://images.example.org/tampered.png" }] })
      .where(eq(imagerySourceRowsTable.importId, rosterId!));
    invalidateImageEvidence();
    const noPhoto = await verifiedImages(schedule);
    assert.equal(noPhoto.players.photos.size, 0);
    assert.equal(noPhoto.teams.logos.get(schedule[0]!.teamId), logo);
    assert.ok(noPhoto.sourceErrors.includes("roster has no valid persisted evidence"));

    await db.update(imagerySourceRowsTable).set({ rows: savedRosterRows })
      .where(eq(imagerySourceRowsTable.importId, rosterId!));
    await db.update(identitySourceImportsTable).set({ parserVersion: `${IMAGE_PARSER_VERSION}-obsolete` })
      .where(eq(identitySourceImportsTable.id, rosterId!));
    invalidateImageEvidence();
    const obsolete = await verifiedImages(schedule);
    assert.equal(obsolete.teams.logos.get(schedule[0]!.teamId), logo);
    assert.equal(obsolete.players.photos.size, 0, "outdated roster receipts must not assign a photo");
    assert.ok(obsolete.sourceErrors.includes("roster has no valid persisted evidence"));

    await db.update(imagerySourceRowsTable).set({ rows: [{ team_abbr: "LA", team_name: "Los Angeles Rams", team_logo_espn: "https://images.example.org/tampered.png" }] })
      .where(eq(imagerySourceRowsTable.importId, teamId!));
    invalidateImageEvidence();
    assert.equal(await safeVerifiedImages(schedule), null, "neither invalid receipt may assign an image");
    const unavailable = await report();
    assert.equal(unavailable.code, 503);
    assert.equal(unavailable.body.status, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateImageEvidence();
    await pool.end();
  }
});