import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { desc, eq, lte, sql } from "drizzle-orm";
import {
  db, identitySourceImportsTable, nflversePlayerIdentitiesTable,
  playerIdentityCrosswalkRevisionsTable, sleeperPlayerSnapshotsTable,
} from "@workspace/db";

export const NFLVERSE_PLAYERS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv.gz";
export const NFLVERSE_PLAYERS_PARSER_VERSION = "v2-latest-team";
export const NFLVERSE_REQUIRED_PLAYER_HEADERS = [
  "gsis_id", "display_name", "position", "latest_team", "status",
  "espn_id", "pfr_id", "pff_id", "otc_id", "esb_id", "nfl_id", "smart_id",
] as const;

export type NflversePlayerRow = {
  gsis_id: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  position_group: string | null;
  team: string | null;
  status: string | null;
  espn_id: string | null;
  pfr_id: string | null;
  pff_id: string | null;
  otc_id: string | null;
  esb_id: string | null;
  nfl_id: string | null;
  smart_id: string | null;
  source_row: Record<string, string | null>;
};

function csvFields(line: string) {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { values.push(value); value = ""; }
    else value += char;
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field");
  values.push(value);
  return values;
}

/** Parse the decompressed CSV without evaluating or trusting provider content. */
export function parseNflversePlayersCsv(csv: string): {
  headers: string[];
  rows: NflversePlayerRow[];
} {
  const records: string[] = [];
  let record = "", quoted = false;
  for (const char of csv.replace(/^\uFEFF/, "")) {
    if (char === '"') quoted = !quoted;
    if ((char === "\n" || char === "\r") && !quoted) {
      if (record) records.push(record);
      record = "";
    } else if (char !== "\r" || quoted) record += char;
  }
  if (record) records.push(record);
  const lines = records.filter((line) => line.length > 0);
  if (!lines.length) throw new Error("nflverse players CSV is empty");
  const headers = csvFields(lines[0]!).map((header) => header.trim());
  for (const required of NFLVERSE_REQUIRED_PLAYER_HEADERS) {
    if (!headers.includes(required)) throw new Error(`nflverse players CSV missing required header: ${required}`);
  }
  const index = new Map(headers.map((header, i) => [header, i]));
  const value = (values: string[], header: string) => {
    const raw = values[index.get(header) ?? -1] ?? "";
    return raw.trim() || null;
  };
  const rows: NflversePlayerRow[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const values = csvFields(line);
    const gsisId = value(values, "gsis_id");
    const displayName = value(values, "display_name");
    if (!gsisId || !displayName) throw new Error("nflverse players CSV contains a row without gsis_id/display_name");
    if (seen.has(gsisId)) throw new Error(`nflverse players CSV contains duplicate gsis_id: ${gsisId}`);
    seen.add(gsisId);
    const sourceRow = Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() || null]));
    rows.push({
      gsis_id: gsisId, display_name: displayName,
      first_name: value(values, "first_name"), last_name: value(values, "last_name"),
      position: value(values, "position"), position_group: value(values, "position_group"),
      team: value(values, "latest_team"), status: value(values, "status"),
      espn_id: value(values, "espn_id"), pfr_id: value(values, "pfr_id"),
      pff_id: value(values, "pff_id"), otc_id: value(values, "otc_id"),
      esb_id: value(values, "esb_id"), nfl_id: value(values, "nfl_id"),
      smart_id: value(values, "smart_id"), source_row: sourceRow,
    });
  }
  return { headers, rows };
}

export function canonicalNflverseRowsHash(rows: NflversePlayerRow[]) {
  const canonical = rows.map((row) => Object.fromEntries(
    Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
  ));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function hashDownloadedBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeNflversePlayers(bytes: Uint8Array) {
  const content = gunzipSync(bytes).toString("utf8");
  return parseNflversePlayersCsv(content);
}

/**
 * Import the authoritative player file as one append-only transaction.
 * An identical compressed source hash is a no-op, which makes daily retries
 * safe without turning an unchanged provider file into duplicate evidence.
 */
export async function syncNflversePlayers(options?: {
  fetchImpl?: typeof fetch;
  sourceUrl?: string;
  fetchedAt?: Date;
}) {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const sourceUrl = options?.sourceUrl ?? NFLVERSE_PLAYERS_URL;
  const response = await fetchImpl(sourceUrl, {
    headers: { Accept: "application/gzip", "User-Agent": "Gridline/1.0 (identity import)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`nflverse players request failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("nflverse players download was empty");
  const sourceContentHash = hashDownloadedBytes(bytes);
  const parsed = decodeNflversePlayers(bytes);
  const canonicalRowsHash = canonicalNflverseRowsHash(parsed.rows);
  const importedAt = options?.fetchedAt ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nflverse-player-identity-import'))`);
    const [existing] = await tx.select({
      id: identitySourceImportsTable.id,
      rowCount: identitySourceImportsTable.rowCount,
    }).from(identitySourceImportsTable)
      .where(sql`${identitySourceImportsTable.sourceNamespace} = 'nflverse'
        and ${identitySourceImportsTable.sourceContentHash} = ${sourceContentHash}
        and ${identitySourceImportsTable.parserVersion} = ${NFLVERSE_PLAYERS_PARSER_VERSION}`)
      .orderBy(desc(identitySourceImportsTable.id)).limit(1);
    if (existing) return {
      status: "unchanged" as const,
      importId: existing.id,
      rowCount: existing.rowCount,
      sourceContentHash,
      parserVersion: NFLVERSE_PLAYERS_PARSER_VERSION,
      canonicalRowsHash,
    };
    const [sourceImport] = await tx.insert(identitySourceImportsTable).values({
      sourceNamespace: "nflverse",
      sourceUrl,
      sourceContentHash,
      parserVersion: NFLVERSE_PLAYERS_PARSER_VERSION,
      canonicalRowsHash,
      sourceHeaders: parsed.headers,
      rowCount: parsed.rows.length,
      importedAt,
      provenance: {
        contentEncoding: "gzip",
        fetchedAt: importedAt.toISOString(),
        authoritativeDataset: "players",
        parserVersion: NFLVERSE_PLAYERS_PARSER_VERSION,
      },
    }).returning({ id: identitySourceImportsTable.id });
    if (!sourceImport) throw new Error("nflverse identity import did not return an import id");
    for (let offset = 0; offset < parsed.rows.length; offset += 500) {
      const rows = parsed.rows.slice(offset, offset + 500).map((row) => ({
        importId: sourceImport.id,
        gsisId: row.gsis_id,
        displayName: row.display_name,
        firstName: row.first_name,
        lastName: row.last_name,
        position: row.position,
        positionGroup: row.position_group,
        team: row.team,
        status: row.status,
        espnId: row.espn_id,
        pfrId: row.pfr_id,
        pffId: row.pff_id,
        otcId: row.otc_id,
        esbId: row.esb_id,
        nflId: row.nfl_id,
        smartId: row.smart_id,
        sourceRow: row.source_row,
        rowFingerprint: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        observedAt: importedAt,
      }));
      await tx.insert(nflversePlayerIdentitiesTable).values(rows);
    }
    return {
      status: "imported" as const,
      importId: sourceImport.id,
      rowCount: parsed.rows.length,
      sourceContentHash,
      canonicalRowsHash,
    };
  });
}

export const NFLVERSE_TYPED_NAMESPACES = [
  "gsis_id", "espn_id", "pfr_id", "pff_id", "otc_id", "esb_id", "nfl_id", "smart_id",
] as const;
type IdentityForCrosswalk = Pick<NflversePlayerRow, "gsis_id" | "espn_id" | "pfr_id" | "pff_id" | "otc_id" | "esb_id" | "nfl_id" | "smart_id">;

export function typedNflverseCrosswalks(rows: IdentityForCrosswalk[], importId: number, observedAt = new Date()) {
  return rows.flatMap((row) => NFLVERSE_TYPED_NAMESPACES.flatMap((namespace) => {
    const value = row[namespace];
    if (!value) return [];
    const evidenceFingerprint = createHash("sha256")
      .update(JSON.stringify({ namespace, value, gsisId: row.gsis_id, importId }))
      .digest("hex");
    return [{
      revision: 1, gridlinePlayerId: row.gsis_id, sourceNamespace: namespace,
      sourcePlayerId: value, targetNamespace: "gsis", targetPlayerId: row.gsis_id,
      evidenceMethod: "nflverse_typed_provider_id", evidenceConfidence: "high",
      firstObserved: observedAt, lastVerified: observedAt, evidenceFingerprint,
      ambiguityFlag: false, sourceImportId: importId,
      evidence: { importId, providerNamespace: namespace },
    }];
  }));
}

/**
 * A Sleeper record is admitted only when every explicit typed provider ID that
 * resolves in nflverse points at the same GSIS identity. Unknown/bare IDs are
 * deliberately ignored rather than guessed.
 */
export function deriveSleeperCrosswalks(
  sleeperRows: Array<{ sleeperPlayerId: string; providerIds: Record<string, unknown>; capturedAt: Date }>,
  nflverseRows: IdentityForCrosswalk[],
  importId: number,
) {
  const lookup = new Map<string, Set<string>>();
  for (const row of nflverseRows) for (const namespace of NFLVERSE_TYPED_NAMESPACES) {
    const value = row[namespace];
    if (value) {
      const key = `${namespace}:${value}`;
      const targets = lookup.get(key) ?? new Set<string>();
      targets.add(row.gsis_id);
      lookup.set(key, targets);
    }
  }
  return sleeperRows.flatMap((row) => {
    const targets = new Set<string>();
    let explicit = 0;
    for (const [key, raw] of Object.entries(row.providerIds)) {
      const namespace = key.toLowerCase() as typeof NFLVERSE_TYPED_NAMESPACES[number];
      if (!(NFLVERSE_TYPED_NAMESPACES as readonly string[]).includes(namespace)) continue;
      const value = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
      const matches = value ? lookup.get(`${namespace}:${value}`) : undefined;
      if (matches) { explicit += 1; for (const target of matches) targets.add(target); }
    }
    const ambiguous = explicit === 0 || targets.size !== 1;
    const target = [...targets][0] ?? "";
    const evidenceFingerprint = createHash("sha256").update(JSON.stringify({
      sleeperPlayerId: row.sleeperPlayerId, providerIds: row.providerIds, targets: [...targets].sort(), importId,
    })).digest("hex");
    return [{
      revision: 1, gridlinePlayerId: target || `unresolved:${row.sleeperPlayerId}`,
      sourceNamespace: "sleeper", sourcePlayerId: row.sleeperPlayerId,
      targetNamespace: "gsis", targetPlayerId: target || "unresolved",
      evidenceMethod: "sleeper_explicit_typed_provider_ids",
      evidenceConfidence: ambiguous ? "ambiguous" : "high",
      firstObserved: row.capturedAt, lastVerified: row.capturedAt,
      evidenceFingerprint, ambiguityFlag: ambiguous, sourceImportId: importId,
      evidence: { explicitTypedProviderCount: explicit, candidateGsisIds: [...targets].sort() },
    }];
  });
}

export async function refreshPlayerIdentityCrosswalk(sourceCapturedAt = new Date()) {
  const [latestImport] = await db.select().from(identitySourceImportsTable)
    .where(eq(identitySourceImportsTable.sourceNamespace, "nflverse"))
    .orderBy(desc(identitySourceImportsTable.id)).limit(1);
  if (!latestImport) throw new Error("Cannot refresh identity crosswalk before nflverse import");
  const nflverseRows = await db.select().from(nflversePlayerIdentitiesTable)
    .where(eq(nflversePlayerIdentitiesTable.importId, latestImport.id));
  const sleeperRows = await db.select({
    id: sleeperPlayerSnapshotsTable.id,
    sleeperPlayerId: sleeperPlayerSnapshotsTable.sleeperPlayerId,
    providerIds: sleeperPlayerSnapshotsTable.providerIds,
    capturedAt: sleeperPlayerSnapshotsTable.capturedAt,
  }).from(sleeperPlayerSnapshotsTable)
    .where(lte(sleeperPlayerSnapshotsTable.capturedAt, sourceCapturedAt));
  const latest = new Map<string, typeof sleeperRows[number]>();
  for (const row of sleeperRows) {
    const existing = latest.get(row.sleeperPlayerId);
    if (
      !existing
      || row.capturedAt > existing.capturedAt
      || (row.capturedAt.getTime() === existing.capturedAt.getTime() && row.id > existing.id)
    ) latest.set(row.sleeperPlayerId, row);
  }
  const evidence = [
    ...typedNflverseCrosswalks(nflverseRows.map((row) => ({
      gsis_id: row.gsisId, espn_id: row.espnId, pfr_id: row.pfrId, pff_id: row.pffId,
      otc_id: row.otcId, esb_id: row.esbId, nfl_id: row.nflId, smart_id: row.smartId,
    })), latestImport.id, latestImport.importedAt),
    ...deriveSleeperCrosswalks([...latest.values()], nflverseRows.map((row) => ({
      gsis_id: row.gsisId, espn_id: row.espnId, pfr_id: row.pfrId, pff_id: row.pffId,
      otc_id: row.otcId, esb_id: row.esbId, nfl_id: row.nflId, smart_id: row.smartId,
    })), latestImport.id),
  ];
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('player-identity-crosswalk-refresh'))`);
    let count = 0;
    for (let offset = 0; offset < evidence.length; offset += 500) {
      const batch = evidence.slice(offset, offset + 500);
      if (!batch.length) continue;
      const result = await tx.insert(playerIdentityCrosswalkRevisionsTable).values(batch)
        .onConflictDoNothing();
      count += result.rowCount ?? 0;
    }
    return count;
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(
    evidence.map((row) => [row.sourceNamespace, row.sourcePlayerId, row.targetPlayerId, row.evidenceFingerprint]),
  )).digest("hex");
  return { imported: inserted, evidenceFingerprint: fingerprint, importId: latestImport.id };
}