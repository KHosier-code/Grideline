import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, identitySourceImportsTable, nflversePlayerIdentitiesTable } from "@workspace/db";
import { NFLVERSE_TEAM_ALIASES } from "./personnel-context-derivation";

export const TEAM_IMAGE_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv";
export const ROSTER_IMAGE_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv";
export const IMAGE_PARSER_VERSION = "verified-imagery-v1";
type Team = { teamId: string; abbreviation: string; name: string };
type TeamRow = { team_abbr: string; team_name: string; team_logo_espn: string };
type RosterRow = { gsis_id: string; espn_id: string; pfr_id: string; pff_id: string; esb_id: string; smart_id: string; headshot_url: string };
type CrosswalkRow = { gsisId: string; espnId: string | null; pfrId: string | null; pffId: string | null; esbId: string | null; smartId: string | null };
type Issue = { id: string; reason: string };
type Source = { url: string; sha256: string; fetchedAt: string; rows: number; version: string };

/** CSV records, including embedded newlines and escaped quotes. Reject malformed or truncated downloads. */
export function parseImageCsv<T extends string>(csv: string, required: readonly T[]): Record<T, string>[] {
  const records: string[][] = [];
  let record: string[] = [], field = "", quoted = false, endedQuote = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else field += c;
    } else if (c === '"' && !field && !endedQuote) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      record.push(field.trim()); field = ""; endedQuote = false;
      if (c !== ",") {
        if (record.some(Boolean)) records.push(record);
        record = [];
        if (c === "\r" && input[i + 1] === "\n") i++;
      }
    } else {
      if (endedQuote) throw new Error("Malformed image CSV quoting");
      field += c;
    }
  }
  if (quoted) throw new Error("Truncated image CSV");
  if (field || record.length) { record.push(field.trim()); records.push(record); }
  const [headers, ...rows] = records;
  if (!headers || !required.every(key => headers.includes(key))) throw new Error(`Image CSV missing headers: ${required.filter(key => !headers?.includes(key)).join(", ")}`);
  if (!rows.length) throw new Error("Image CSV has no data");
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error("Malformed image CSV row");
    return Object.fromEntries(required.map(key => [key, values[headers.indexOf(key)] ?? ""])) as Record<T, string>;
  });
}

export function safeImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const club = (value: string) => NFLVERSE_TEAM_ALIASES[value.trim().toUpperCase()] ?? value.trim().toUpperCase();
const nameKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function reconcileTeamImages(teams: Team[], rows: TeamRow[]) {
  const logos = new Map<string, string>();
  const unmatched: Issue[] = [], ambiguous: Issue[] = [];
  const claims = new Map<string, TeamRow[]>();
  for (const row of rows) {
    const byAbbreviation = teams.filter(team => Boolean(row.team_abbr) && club(row.team_abbr) === club(team.abbreviation));
    const byName = teams.filter(team => Boolean(row.team_name) && nameKey(row.team_name) === nameKey(team.name));
    const matches = [...new Map([...byAbbreviation, ...byName].map(team => [team.teamId, team])).values()];
    // Abbreviation and name must not point at different clubs.
    if (matches.length !== 1) {
      (matches.length ? ambiguous : unmatched).push({ id: `${row.team_abbr}:${row.team_name}`, reason: matches.length ? "multiple schedule clubs" : "no schedule club" });
    } else claims.set(matches[0]!.teamId, [...(claims.get(matches[0]!.teamId) ?? []), row]);
  }
  for (const team of teams) {
    const candidates = claims.get(team.teamId) ?? [];
    if (candidates.length > 1) ambiguous.push({ id: team.teamId, reason: "multiple source logo rows" });
    else if (candidates.length === 1) {
      const url = safeImageUrl(candidates[0]!.team_logo_espn);
      if (url) logos.set(team.teamId, url);
      else unmatched.push({ id: team.teamId, reason: "missing or unsafe logo URL" });
    } else unmatched.push({ id: team.teamId, reason: "no source logo row" });
  }
  return { logos, unmatched, ambiguous };
}

export function reconcilePlayerImages(rows: RosterRow[], crosswalk: CrosswalkRow[]) {
  const byGsis = new Map<string, RosterRow[]>();
  const byTyped = new Map<string, Set<string>>();
  const ambiguous: Issue[] = [], unmatched: Issue[] = [], missingUrl: Issue[] = [], duplicateRosterIds: Issue[] = [];
  for (const row of crosswalk) {
    for (const [key, value] of Object.entries(row)) {
      if (!value) continue;
      const typed = `${key}:${value}`;
      const targets = byTyped.get(typed) ?? new Set<string>();
      targets.add(row.gsisId); byTyped.set(typed, targets);
    }
  }
  for (const [key, targets] of byTyped) if (targets.size > 1) ambiguous.push({ id: key, reason: `conflicting crosswalk: ${[...targets].sort().join(", ")}` });
  for (const row of rows) {
    // A direct GSIS ID is preferred; other identifiers may only establish identity when GSIS is absent.
    const candidates = new Set<string>();
    if (row.gsis_id) candidates.add(row.gsis_id);
    else for (const [key, value] of [["espnId", row.espn_id], ["pfrId", row.pfr_id], ["pffId", row.pff_id], ["esbId", row.esb_id], ["smartId", row.smart_id]]) {
      if (value) for (const id of byTyped.get(`${key}:${value}`) ?? []) candidates.add(id);
    }
    const id = row.gsis_id || `espn:${row.espn_id || "missing"}`;
    if (!safeImageUrl(row.headshot_url)) missingUrl.push({ id, reason: "missing or unsafe headshot URL" });
    if (row.gsis_id) {
      const contradictory = ([
        ["espnId", row.espn_id], ["pfrId", row.pfr_id], ["pffId", row.pff_id],
        ["esbId", row.esb_id], ["smartId", row.smart_id],
      ] as const).some(([key, value]) => {
        const matches = value ? byTyped.get(`${key}:${value}`) : undefined;
        return matches && (matches.size !== 1 || !matches.has(row.gsis_id));
      });
      if (contradictory) {
        ambiguous.push({ id, reason: "roster GSIS conflicts with typed crosswalk" });
        continue;
      }
    }
    if (candidates.size !== 1) {
      (candidates.size ? ambiguous : unmatched).push({ id, reason: candidates.size ? "conflicting typed IDs" : "no verified GSIS identity" });
      continue;
    }
    const gsis = [...candidates][0]!;
    byGsis.set(gsis, [...(byGsis.get(gsis) ?? []), row]);
  }
  const photos = new Map<string, string>();
  for (const [gsis, records] of byGsis) {
    const urls = new Set(records.map(row => safeImageUrl(row.headshot_url)).filter((url): url is string => !!url));
    if (records.length > 1) duplicateRosterIds.push({ id: gsis, reason: `${records.length} season roster observations` });
    if (urls.size > 1) ambiguous.push({ id: gsis, reason: "conflicting roster headshot URLs" });
    else if (records.length > 1 && urls.size === 1 && records.some(row => !safeImageUrl(row.headshot_url)))
      ambiguous.push({ id: gsis, reason: "conflicting roster URL presence" });
    else if (!urls.size) { /* Already counted from raw roster rows above. */ }
    else photos.set(gsis, [...urls][0]!);
  }
  return { photos, byTyped, unmatched, ambiguous, missingUrl: [...new Map(missingUrl.map(issue => [issue.id, issue])).values()], duplicateRosterIds };
}

export function playerHeadshot(id: string, result: ReturnType<typeof reconcilePlayerImages>) {
  if (result.photos.has(id)) return result.photos.get(id)!;
  // Bare identifiers must resolve to one GSIS across all typed namespaces.
  const targets = new Set<string>();
  for (const namespace of ["espnId", "pfrId", "pffId", "esbId", "smartId"]) {
    for (const gsis of result.byTyped.get(`${namespace}:${id}`) ?? []) targets.add(gsis);
  }
  return targets.size === 1 ? result.photos.get([...targets][0]!) ?? null : null;
}

type ImageState = {
  sources: { teams: Source | null; roster: Source | null; players: Source | null };
  teams: ReturnType<typeof reconcileTeamImages>;
  players: ReturnType<typeof reconcilePlayerImages>;
  teamRows: TeamRow[];
  crosswalkError: string | null;
  sourceErrors: string[];
};
let cached: { state: ImageState; expires: number } | null = null;
let pending: Promise<ImageState> | null = null;
let lastError: string | null = null;
/** Keep optional remote imagery outside the request path, even on a cold start. */
export function createImageRefreshGate(refresh: () => Promise<unknown>, now: () => number = Date.now) {
  let inFlight = false;
  let retryAt = 0;
  return (stale: boolean) => {
    if (!stale || inFlight || now() < retryAt) return;
    inFlight = true;
    retryAt = now() + 5 * 60_000;
    void Promise.resolve().then(refresh).catch(() => {
      // The awaited admin report can expose the recorded source failure.
    }).finally(() => { inFlight = false; });
  };
}
const scheduleConsumerRefresh = createImageRefreshGate(() => safeVerifiedImages([]));
export function consumerVerifiedImages(teams: Team[]) {
  scheduleConsumerRefresh(!cached || cached.expires <= Date.now());
  return staleVerifiedImages(cached?.state ?? null, teams);
}
async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Gridline/1.0 (verified imagery)" } });
  if (!response.ok) throw new Error(`Image source returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 12_000_000) throw new Error("Image CSV size out of bounds");
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sha256: createHash("sha256").update(bytes).digest("hex"), fetchedAt: new Date().toISOString(), url };
}
const teamFields = ["team_abbr", "team_name", "team_logo_espn"] as const;
const rosterFields = ["gsis_id", "espn_id", "pfr_id", "pff_id", "esb_id", "smart_id", "headshot_url"] as const;
export async function verifiedImages(teams: Team[]): Promise<ImageState> {
  // Team mappings depend on the current schedule; cache only immutable source evidence, not schedule joins.
  const evidence = cached && cached.expires > Date.now() ? cached.state : await (pending ??= (async () => {
    const [teamDownload, rosterDownload, importsResult] = await Promise.allSettled([
      download(TEAM_IMAGE_SOURCE), download(ROSTER_IMAGE_SOURCE),
      db.select().from(identitySourceImportsTable)
        .where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
        .orderBy(desc(identitySourceImportsTable.id)).limit(1),
    ]);
    const teamFile = teamDownload.status === "fulfilled" ? teamDownload.value : null;
    const rosterFile = rosterDownload.status === "fulfilled" ? rosterDownload.value : null;
    const sourceErrors: string[] = [];
    const parsed = <T extends string>(file: typeof teamFile, fields: readonly T[], label: string) => {
      if (!file) { sourceErrors.push(`${label} download unavailable`); return [] as Record<T, string>[]; }
      try { return parseImageCsv(file.text, fields); }
      catch { sourceErrors.push(`${label} CSV invalid`); return [] as Record<T, string>[]; }
    };
    const teamRows = parsed(teamFile, teamFields, "teams");
    const rosterRows = parsed(rosterFile, rosterFields, "2026 roster");
    if (!teamRows.length && !rosterRows.length) throw new Error(`Both imagery sources unavailable: ${sourceErrors.join("; ")}`);
    // Retain the exact source fingerprint even across API restarts. These
    // receipts are separate from the versioned players crosswalk import.
    const retain = async <T extends string>(label: string, file: typeof teamFile, fields: readonly T[], rows: Record<T, string>[]) => {
      if (!file || !rows.length) return;
      await db.insert(identitySourceImportsTable).values({
        sourceNamespace: `nflverse-imagery-${label}`,
        sourceUrl: file.url,
        sourceContentHash: file.sha256,
        parserVersion: IMAGE_PARSER_VERSION,
        canonicalRowsHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        sourceHeaders: [...fields],
        rowCount: rows.length,
        importedAt: new Date(file.fetchedAt),
        provenance: { fetchedAt: file.fetchedAt, dataset: label, season: label === "roster" ? 2026 : null },
      }).onConflictDoNothing();
    };
    const receipts = await Promise.allSettled([
      retain("teams", teamFile, teamFields, teamRows),
      retain("roster", rosterFile, rosterFields, rosterRows),
    ]);
    receipts.forEach((result, index) => {
      if (result.status === "rejected") sourceErrors.push(`${index ? "2026 roster" : "teams"} provenance receipt unavailable`);
    });
    const imports = importsResult.status === "fulfilled" ? importsResult.value : [];
    const imported = imports[0];
    const crosswalk = imported ? await db.select({
      gsisId: nflversePlayerIdentitiesTable.gsisId, espnId: nflversePlayerIdentitiesTable.espnId,
      pfrId: nflversePlayerIdentitiesTable.pfrId, pffId: nflversePlayerIdentitiesTable.pffId,
      esbId: nflversePlayerIdentitiesTable.esbId, smartId: nflversePlayerIdentitiesTable.smartId,
    }).from(nflversePlayerIdentitiesTable).where(eq(nflversePlayerIdentitiesTable.importId, imported.id)) : [];
    const source = (downloaded: typeof teamFile, rows: number): Source => ({
      url: downloaded!.url, sha256: downloaded!.sha256, fetchedAt: downloaded!.fetchedAt, rows, version: IMAGE_PARSER_VERSION,
    });
    const state: ImageState = {
      sources: { teams: teamRows.length ? source(teamFile, teamRows.length) : null,
        roster: rosterRows.length ? source(rosterFile, rosterRows.length) : null,
        players: imported ? { url: imported.sourceUrl, sha256: imported.sourceContentHash, fetchedAt: imported.importedAt.toISOString(), rows: imported.rowCount, version: imported.parserVersion } : null },
      teams: reconcileTeamImages([], teamRows), teamRows, sourceErrors,
      crosswalkError: imported ? null : "Versioned nflverse player crosswalk unavailable",
      players: reconcilePlayerImages(rosterRows, crosswalk),
    };
    // Store source rows separately so mapping is recomputed when schedule teams change.
    cached = { state, expires: Date.now() + 6 * 60 * 60_000 };
    lastError = null;
    return state;
  })().finally(() => { pending = null; }));
  return { ...evidence, teams: reconcileTeamImages(teams, evidence.teamRows) };
}

export async function safeVerifiedImages(teams: Team[]) {
  try { return await verifiedImages(teams); }
  catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return staleVerifiedImages(cached?.state ?? null, teams);
  }
}
/** A failed refresh can reuse only previously verified evidence, never ESPN schedule logos. */
export function staleVerifiedImages(state: ImageState | null, teams: Team[]) {
  return state ? { ...state, teams: reconcileTeamImages(teams, state.teamRows) } : null;
}
export function imageryFailure() { return lastError; }