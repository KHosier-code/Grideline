import { and, eq, or } from "drizzle-orm";
import { db, playersTable, teamsTable, verifiedDepthEvidenceTable } from "@workspace/db";

const STATES = new Set(["verified", "unavailable", "ambiguous"]);
const AVAILABILITY = new Set(["available", "questionable", "doubtful", "out", "unknown"]);
const ROLE_CARDS = new Set([
  "QB1", "QB2", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1",
  "LT1", "LG1", "C1", "RG1", "RT1", "DT1", "DT2", "LB1", "LB2",
  "CB1", "CB2", "CB3_OR_SLOT", "FS1", "SS1", "EDGE1", "EDGE2", "K1", "P1", "LS1",
]);

export type VerifiedDepthImport = {
  teamId: string;
  playerId?: string | null;
  playerName?: string | null;
  position: string;
  role: string;
  depthRank?: number | null;
  evidenceState: "verified" | "unavailable" | "ambiguous";
  availability: "available" | "questionable" | "doubtful" | "out" | "unknown";
  injuryStatus?: string | null;
  confidence?: number | null;
  source: string;
  sourceUrl: string;
  observedAt: string;
  verifiedAt: string;
  verificationMethod: string;
  provenance: Record<string, unknown>;
  sourceHash: string;
};

export function validateVerifiedDepthImport(value: unknown): VerifiedDepthImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Verified depth evidence must be an object.");
  const row = value as Record<string, unknown>;
  const text = (key: string, required = true) => {
    const item = row[key];
    if (typeof item !== "string" || !item.trim()) {
      if (required) throw new Error(`${key} is required.`);
      return null;
    }
    return item.trim();
  };
  const evidenceState = text("evidenceState")!;
  if (!STATES.has(evidenceState)) throw new Error("evidenceState must be verified, unavailable, or ambiguous.");
  const availability = text("availability")!;
  if (!AVAILABILITY.has(availability)) throw new Error("availability must be available, questionable, doubtful, out, or unknown.");
  const sourceUrl = text("sourceUrl")!;
  let parsedUrl: URL;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new Error("sourceUrl must be a valid URL."); }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("sourceUrl must use http or https.");
  const observedAt = text("observedAt")!;
  const verifiedAt = text("verifiedAt")!;
  const observed = new Date(observedAt);
  const verified = new Date(verifiedAt);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(verified.getTime())) throw new Error("observedAt and verifiedAt must be valid timestamps.");
  if (observed > verified) throw new Error("observedAt must be at or before verifiedAt.");
  if (verified.getTime() > Date.now()) throw new Error("verifiedAt cannot be in the future.");
  const teamId = text("teamId")!;
  const position = text("position")!;
  const role = text("role")!.toUpperCase();
  if (!ROLE_CARDS.has(role)) throw new Error("role must be a supported verified role card.");
  const playerId = text("playerId", false);
  const playerName = text("playerName", false);
  const depthRankValue = row.depthRank;
  const depthRank = depthRankValue === null || depthRankValue === undefined ? null
    : typeof depthRankValue === "number" && Number.isInteger(depthRankValue) && depthRankValue > 0 ? depthRankValue : null;
  if (depthRankValue !== null && depthRankValue !== undefined && depthRank === null) throw new Error("depthRank must be a positive integer.");
  if (evidenceState === "verified" && (!playerId || !playerName || depthRank === null)) {
    throw new Error("Verified evidence requires playerId, playerName, and depthRank.");
  }
  const rolePosition = role.startsWith("CB") ? "CB"
    : role.replace(/(?:[123]|_OR_SLOT)$/g, "");
  if (position.toUpperCase() !== rolePosition) {
    throw new Error(`position must match role ${role}.`);
  }
  // `role` identifies the audited lineup slot; `depthRank` is the ladder
  // within that slot. This permits evidence-backed backups such as WR1 rank 2
  // without inventing a new audit role card.
  const confidenceValue = row.confidence;
  const confidence = confidenceValue === null || confidenceValue === undefined ? null
    : typeof confidenceValue === "number" && Number.isInteger(confidenceValue) && confidenceValue >= 0 && confidenceValue <= 100 ? confidenceValue : null;
  if (confidenceValue !== null && confidenceValue !== undefined && confidence === null) throw new Error("confidence must be an integer from 0 to 100.");
  const provenance = row.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) throw new Error("provenance must be an object.");
  const sourceHash = text("sourceHash")!;
  if (!/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error("sourceHash must be a SHA-256 hex digest.");
  return {
    teamId, playerId, playerName, position, role, depthRank, evidenceState: evidenceState as VerifiedDepthImport["evidenceState"],
    availability: availability as VerifiedDepthImport["availability"], injuryStatus: text("injuryStatus", false),
    confidence, source: text("source")!, sourceUrl, observedAt: observed.toISOString(), verifiedAt: verified.toISOString(),
    verificationMethod: text("verificationMethod")!, provenance: provenance as Record<string, unknown>, sourceHash,
  };
}

export async function importVerifiedDepthEvidence(value: unknown) {
  const row = validateVerifiedDepthImport(value);
  const normalizedTeam = row.teamId.toUpperCase();
  const [team] = await db.select().from(teamsTable).where(or(
    eq(teamsTable.teamId, row.teamId),
    eq(teamsTable.abbreviation, normalizedTeam),
  )).limit(1);
  if (!team) throw new Error("teamId must identify a current canonical NFL team.");
  if (row.evidenceState === "verified") {
    const [player] = await db.select().from(playersTable).where(and(
      eq(playersTable.playerId, row.playerId!),
      eq(playersTable.teamId, team.teamId),
    )).limit(1);
    if (!player) throw new Error("Verified playerId must identify a current player on the selected team.");
    if (player.name.trim() !== row.playerName?.trim()) throw new Error("playerName must match the canonical player record.");
  }
  const [inserted] = await db.insert(verifiedDepthEvidenceTable).values({
    ...row,
    teamId: team.teamId,
    observedAt: new Date(row.observedAt),
    verifiedAt: new Date(row.verifiedAt),
  }).returning();
  return inserted;
}