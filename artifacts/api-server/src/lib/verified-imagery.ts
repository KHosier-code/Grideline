import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, identitySourceImportsTable, imageryReviewsTable, imagerySourceRowsTable, nflversePlayerIdentitiesTable } from "@workspace/db";
import { NFLVERSE_TEAM_ALIASES } from "./personnel-context-derivation";
import { logger } from "./logger";

export const TEAM_IMAGE_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv";
export const ROSTER_IMAGE_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv";
export const IMAGE_PARSER_VERSION = "verified-imagery-v2";

export const PLAYER_HEADSHOT_RIGHTS = {
  status: "not_approved" as "not_approved" | "approved",
  approvedHosts: [] as string[],
  reviewedHost: "static.www.nfl.com",
  reviewedUse: "Public display of player portraits in Game Detail",
  review: "No grant for NFL-hosted photographs established; use the portrait placeholder.",
  termsUrl: "https://www.nfl.com/legal/terms/",
};
type Team = { teamId: string; abbreviation: string; name: string };
type TeamRow = { team_abbr: string; team_name: string; team_logo_espn: string };
type RosterRow = { gsis_id: string; espn_id: string; pfr_id: string; pff_id: string; esb_id: string; smart_id: string; headshot_url: string };
type CrosswalkRow = { gsisId: string; espnId: string | null; pfrId: string | null; pffId: string | null; esbId: string | null; smartId: string | null };
type Issue = { id: string; reason: string };
type Source = { url: string; sha256: string; fetchedAt: string; rows: number; version: string; stale?: boolean; importId?: number };

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

/** Only a separately licensed, explicitly approved host may reach a consumer. */
export function approvedPlayerHeadshotUrl(value: string | null | undefined) {
  const safe = safeImageUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return PLAYER_HEADSHOT_RIGHTS.status === "approved" &&
    PLAYER_HEADSHOT_RIGHTS.approvedHosts.includes(url.hostname) && !url.port ? safe : null;
}
export function unapprovedHeadshotHosts(rows: Pick<RosterRow, "headshot_url">[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const safe = safeImageUrl(row.headshot_url);
    if (!safe || approvedPlayerHeadshotUrl(safe)) continue;
    const host = new URL(safe).hostname;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([host, rows]) => ({ host, rows }));
}

/** Log only previously unseen hosts on a newly persisted release; never include image URLs or player identities. */
export function newHeadshotHostAlert(
  current: Pick<RosterRow, "headshot_url">[],
  previous: Pick<RosterRow, "headshot_url">[] | null,
) {
  const known = new Set([PLAYER_HEADSHOT_RIGHTS.reviewedHost, ...PLAYER_HEADSHOT_RIGHTS.approvedHosts,
    ...unapprovedHeadshotHosts(previous ?? []).map(entry => entry.host)]);
  const newlySeen = unapprovedHeadshotHosts(current).filter(entry => !known.has(entry.host));
  if (!newlySeen.length) return null;
  // Provider-controlled hosts may be numerous or malformed: keep log payloads bounded and DNS-only.
  const safeHosts = newlySeen.filter(({ host }) => host.length <= 253 &&
    host.split(".").every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9-]+$/.test(label)));
  return {
    event: "unapproved_player_headshot_hosts_detected",
    severity: "warning",
    hosts: safeHosts.slice(0, 10),
    additionalHostCount: newlySeen.length - Math.min(safeHosts.length, 10),
  } as const;
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
  return { photos, byTyped, unmatched, ambiguous, missingUrl: [...new Map(missingUrl.map(issue => [issue.id, issue])).values()], duplicateRosterIds,
    unapprovedHosts: unapprovedHeadshotHosts(rows) };
}

export type ImageApproval = { sourceHash: string; imageUrl: string; imageHash: string; decision: string };
export function approvedReviewUrl(id: string, url: string | undefined, sourceHash: string | undefined, approvals: Map<string, ImageApproval>) {
  const approval = approvals.get(id);
  if (!url || !sourceHash || !approvedPlayerHeadshotUrl(url) || approval?.decision !== "approved"
    || approval.sourceHash !== sourceHash || approval.imageUrl !== url || !/^[a-f0-9]{64}$/.test(approval.imageHash))
    return null;
  return `/api/verified-imagery/player/${encodeURIComponent(id)}`;
}

export function resolvePlayerImageId(id: string, result: ReturnType<typeof reconcilePlayerImages>) {
  if (result.photos.has(id)) return id;
  // Bare identifiers must resolve to one GSIS across all typed namespaces.
  const targets = new Set<string>();
  for (const namespace of ["espnId", "pfrId", "pffId", "esbId", "smartId"]) {
    for (const gsis of result.byTyped.get(`${namespace}:${id}`) ?? []) targets.add(gsis);
  }
  return targets.size === 1 ? [...targets][0]! : null;
}
export function playerHeadshot(id: string, result: ReturnType<typeof reconcilePlayerImages>, sourceHash?: string, approvals: Map<string, ImageApproval> = new Map()) {
  const gsis = resolvePlayerImageId(id, result);
  if (!gsis) return null;
  const url = approvedReviewUrl(gsis, result.photos.get(gsis), sourceHash, approvals);
  return url ? `/api/verified-imagery/player/${encodeURIComponent(id)}` : null;
}

type ImageState = {
  sources: { teams: Source | null; roster: Source | null; players: Source | null };
  teams: ReturnType<typeof reconcileTeamImages>;
  players: ReturnType<typeof reconcilePlayerImages>;
  teamRows: TeamRow[];
  crosswalkError: string | null;
  sourceErrors: string[];
  approvals: Map<string, ImageApproval>;
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
export function currentImageEvidence() { return cached?.state ?? null; }
export function invalidateImageEvidence() { cached = null; }

export async function fetchCandidateImage(url: string) {
  const safe = safeImageUrl(url);
  if (!safe || safe !== url || new URL(safe).port || ![PLAYER_HEADSHOT_RIGHTS.reviewedHost, ...PLAYER_HEADSHOT_RIGHTS.approvedHosts].includes(new URL(safe).hostname))
    throw new Error("Image host is not reviewed");
  const response = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: { "User-Agent": "Gridline/1.0 (imagery review)" } });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 3_000_000)
    throw new Error("Image fetch failed or exceeded size limit");
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (!response.body) throw new Error("Image body unavailable");
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 3_000_000) { await response.body.cancel(); throw new Error("Image exceeded size limit"); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!type) throw new Error("Unsupported image bytes");
  return { bytes, type, hash: createHash("sha256").update(bytes).digest("hex") };
}

export async function latestImageReviews() {
  const rows = await db.select().from(imageryReviewsTable).orderBy(desc(imageryReviewsTable.id));
  return new Map(rows.map(row => [row.playerId, row] as const).reverse());
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

type ImageFile = Awaited<ReturnType<typeof download>>;
export async function verifiedImages(teams: Team[]): Promise<ImageState> {
  // Team mappings depend on the current schedule; cache only immutable source evidence, not schedule joins.
  const evidence = cached && cached.expires > Date.now() ? cached.state : await (pending ??= (async () => {
    const [teamDownload, rosterDownload, importsResult, reviewsResult] = await Promise.allSettled([
      download(TEAM_IMAGE_SOURCE), download(ROSTER_IMAGE_SOURCE),
      db.select().from(identitySourceImportsTable)
        .where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
        .orderBy(desc(identitySourceImportsTable.id)).limit(1),
      latestImageReviews(),
    ]);
    const teamFile = teamDownload.status === "fulfilled" ? teamDownload.value : null;
    const rosterFile = rosterDownload.status === "fulfilled" ? rosterDownload.value : null;
    const sourceErrors: string[] = [];
    const parsed = <T extends string>(file: typeof teamFile, fields: readonly T[], label: string) => {
      if (!file) { sourceErrors.push(`${label} download unavailable`); return [] as Record<T, string>[]; }
      try { return parseImageCsv(file.text, fields); }
      catch { sourceErrors.push(`${label} CSV invalid`); return [] as Record<T, string>[]; }
    };
    const resolve = async <T extends string>(label: ImageLabel, file: ImageFile | null, fields: readonly T[]) => {
      const rows = parsed(file, fields, label === "roster" ? "2026 roster" : "teams");
      if (rows.length && file) {
        try { await storeImageRows(label, file, fields, rows); }
        catch { sourceErrors.push(`${label} persisted evidence unavailable`); }
        return { rows, source: { url: file.url, sha256: file.sha256, fetchedAt: file.fetchedAt,
          rows: rows.length, version: IMAGE_PARSER_VERSION } satisfies Source };
      }
      try {
        const saved = await loadImageRows(label, label === "roster" ? ROSTER_IMAGE_SOURCE : TEAM_IMAGE_SOURCE, fields);
        if (saved) {
          sourceErrors.push(`${label} using stale verified evidence from ${saved.source.fetchedAt}`);
          return saved;
        }
        sourceErrors.push(`${label} has no valid persisted evidence`);
      } catch { sourceErrors.push(`${label} persisted evidence could not be read`); }
      return { rows: [] as Record<T, string>[], source: null };
    };
    const [teamEvidence, rosterEvidence] = await Promise.all([
      resolve("teams", teamFile, teamFields), resolve("roster", rosterFile, rosterFields),
    ]);
    const teamRows = teamEvidence.rows;
    const rosterRows = rosterEvidence.rows;
    if (!teamRows.length && !rosterRows.length) throw new Error(`Both imagery sources unavailable: ${sourceErrors.join("; ")}`);
    const imports = importsResult.status === "fulfilled" ? importsResult.value : [];
    const imported = imports[0];
    const crosswalk = imported ? await db.select({
      gsisId: nflversePlayerIdentitiesTable.gsisId, espnId: nflversePlayerIdentitiesTable.espnId,
      pfrId: nflversePlayerIdentitiesTable.pfrId, pffId: nflversePlayerIdentitiesTable.pffId,
      esbId: nflversePlayerIdentitiesTable.esbId, smartId: nflversePlayerIdentitiesTable.smartId,
    }).from(nflversePlayerIdentitiesTable).where(eq(nflversePlayerIdentitiesTable.importId, imported.id)) : [];
    const state: ImageState = {
      sources: { teams: teamEvidence.source,
        roster: rosterEvidence.source,
         players: imported ? { url: imported.sourceUrl, sha256: imported.sourceContentHash, fetchedAt: imported.importedAt.toISOString(), rows: imported.rowCount, version: imported.parserVersion, importId: imported.id } : null },
      teams: reconcileTeamImages([], teamRows), teamRows, sourceErrors,
      crosswalkError: imported ? null : "Versioned nflverse player crosswalk unavailable",
      players: reconcilePlayerImages(rosterRows, crosswalk),
       approvals: reviewsResult.status === "fulfilled" ? reviewsResult.value : new Map(),
    };
     if (reviewsResult.status === "rejected") sourceErrors.push("Image review evidence unavailable");
    // Store source rows separately so mapping is recomputed when schedule teams change.
    cached = { state, expires: Date.now() + (sourceErrors.length ? 5 * 60_000 : 6 * 60 * 60_000) };
    lastError = null;
    return state;
  })().finally(() => { pending = null; }));
  return { ...evidence, teams: reconcileTeamImages(teams, evidence.teamRows) };
}

export async function safeVerifiedImages(teams: Team[]) {
  try { return await verifiedImages(teams); }
  catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    const stale = staleVerifiedImages(cached?.state ?? null, teams);
    return stale ? { ...stale, sourceErrors: [...stale.sourceErrors, `refresh failed: ${lastError}`],
      sources: { ...stale.sources,
        teams: stale.sources.teams && { ...stale.sources.teams, stale: true },
        roster: stale.sources.roster && { ...stale.sources.roster, stale: true } } } : null;
  }
}
/** A failed refresh can reuse only previously verified evidence, never ESPN schedule logos. */
export function staleVerifiedImages(state: ImageState | null, teams: Team[]) {
  return state ? { ...state, teams: reconcileTeamImages(teams, state.teamRows) } : null;
}
export function imageryFailure() { return lastError; }

/** Reject malformed, partial, or tampered persisted rows before any identity reconciliation. */
export function validPersistedImageRows(
  rows: unknown, receipt: { canonicalRowsHash: string; rowCount: number; sourceContentHash: string; sourceUrl: string; parserVersion: string; sourceHeaders: string[] },
  url: string, fields: readonly string[],
): rows is Record<string, string>[] {
  return receipt.sourceUrl === url && receipt.parserVersion === IMAGE_PARSER_VERSION
    && /^[a-f0-9]{64}$/.test(receipt.sourceContentHash)
    && Array.isArray(receipt.sourceHeaders) && fields.every(field => receipt.sourceHeaders.includes(field))
    && Array.isArray(rows) && rows.length > 0 && rows.length === receipt.rowCount
    && rows.every(row => row !== null && typeof row === "object" && !Array.isArray(row)
      && fields.every(field => typeof row[field] === "string"))
    && hashRows(rows as Record<string, string>[], fields) === receipt.canonicalRowsHash;
}

async function loadImageRows<T extends string>(label: ImageLabel, url: string, fields: readonly T[]) {
  const [receipt] = await db.select().from(identitySourceImportsTable).where(and(
    eq(identitySourceImportsTable.sourceNamespace, `nflverse-imagery-${label}`),
    eq(identitySourceImportsTable.sourceUrl, url),
    eq(identitySourceImportsTable.parserVersion, IMAGE_PARSER_VERSION),
  )).orderBy(desc(identitySourceImportsTable.importedAt), desc(identitySourceImportsTable.id)).limit(1);
  if (!receipt) return null;
  const [payload] = await db.select().from(imagerySourceRowsTable)
    .where(eq(imagerySourceRowsTable.importId, receipt.id)).limit(1);
  if (!validPersistedImageRows(payload?.rows, receipt, url, fields)) return null;
  return {
    rows: payload!.rows as Record<T, string>[],
    source: { url, sha256: receipt.sourceContentHash, fetchedAt: receipt.importedAt.toISOString(),
      rows: receipt.rowCount, version: receipt.parserVersion, stale: true } satisfies Source,
  };
}

type ImageLabel = "teams" | "roster";

async function storeImageRows(label: ImageLabel, file: ImageFile, fields: readonly string[], rows: Record<string, string>[]) {
  const alert = await db.transaction(async tx => {
    const namespace = `nflverse-imagery-${label}`;
    if (label === "roster") await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nflverse-imagery-roster-refresh'))`);
    // The unique source receipt is the cross-process deduplication key. Only its winner alerts.
    const [previous] = label === "roster" ? await tx.select().from(identitySourceImportsTable).where(and(
      eq(identitySourceImportsTable.sourceNamespace, namespace),
      eq(identitySourceImportsTable.sourceUrl, file.url),
      eq(identitySourceImportsTable.parserVersion, IMAGE_PARSER_VERSION),
    )).orderBy(desc(identitySourceImportsTable.id)).limit(1) : [];
    const [created] = await tx.insert(identitySourceImportsTable).values({
      sourceNamespace: namespace, sourceUrl: file.url, sourceContentHash: file.sha256,
      parserVersion: IMAGE_PARSER_VERSION, canonicalRowsHash: hashRows(rows, fields),
      sourceHeaders: [...fields], rowCount: rows.length, importedAt: new Date(file.fetchedAt),
      provenance: { fetchedAt: file.fetchedAt, dataset: label, season: label === "roster" ? 2026 : null },
    }).onConflictDoNothing().returning({ id: identitySourceImportsTable.id });
    const existing = created ? null : (await tx.select().from(identitySourceImportsTable).where(and(
      eq(identitySourceImportsTable.sourceNamespace, namespace),
      eq(identitySourceImportsTable.sourceContentHash, file.sha256),
      eq(identitySourceImportsTable.parserVersion, IMAGE_PARSER_VERSION),
    )).limit(1))[0];
    if (existing && (existing.canonicalRowsHash !== hashRows(rows, fields) || existing.sourceUrl !== file.url))
      throw new Error("Imagery source receipt mismatch");
    const id = created?.id ?? existing?.id;
    if (!id) throw new Error("Imagery source receipt unavailable");
    await tx.insert(imagerySourceRowsTable).values({ importId: id, rows }).onConflictDoNothing();
    if (label !== "roster" || !created) return null;
    const [previousPayload] = previous ? await tx.select().from(imagerySourceRowsTable)
      .where(eq(imagerySourceRowsTable.importId, previous.id)).limit(1) : [];
    // Invalid prior evidence cannot suppress a new-host warning.
    const priorRows = previous && validPersistedImageRows(previousPayload?.rows, previous, file.url, fields)
      ? previousPayload!.rows as RosterRow[] : null;
    return newHeadshotHostAlert(rows as RosterRow[], priorRows);
  });
  if (alert) logger.warn(alert, "New unapproved player headshot hosts in roster release");
}

// JSONB does not preserve object-key order. Hash in the declared CSV field order
// so a receipt made from parsed rows still verifies after a database round trip.
const hashRows = (rows: Record<string, string>[], fields: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(rows.map(row =>
    Object.fromEntries(fields.map(field => [field, row[field]]))))).digest("hex");
