import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export const NFLVERSE_PLAYER_CROSSWALK_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv.gz";

const cachePath = join(process.cwd(), ".cache", "nflverse", "players.csv.gz");
const providerColumns = [
  "gsis_id",
  "espn_id",
  "pfr_id",
  "nfl_id",
  "esb_id",
  "pff_id",
  "otc_id",
] as const;

export type VerifiedPlayerCrosswalk = {
  displayName: string;
  position: string | null;
  latestTeam: string | null;
  providerIds: Record<string, string>;
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

export function parseVerifiedPlayerCrosswalkCsv(csv: string) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift() ?? "").map((header) => header.replace(/^\uFEFF/, ""));
  const column = new Map(headers.map((header, index) => [header, index]));
  return lines.flatMap((line): VerifiedPlayerCrosswalk[] => {
    const values = parseCsvLine(line);
    const text = (name: string) => values[column.get(name) ?? -1]?.trim() || null;
    const providerIds = Object.fromEntries(providerColumns.flatMap((name) => {
      const value = text(name);
      return value ? [[name, value]] : [];
    }));
    const displayName = text("display_name");
    return displayName && Object.keys(providerIds).length > 0
      ? [{
          displayName,
          position: text("position"),
          latestTeam: text("latest_team"),
          providerIds,
        }]
      : [];
  });
}

export async function loadVerifiedPlayerCrosswalk(options?: { refresh?: boolean }) {
  let compressed: Buffer;
  try {
    if (options?.refresh) throw new Error("refresh requested");
    compressed = await readFile(cachePath);
  } catch {
    const response = await fetch(NFLVERSE_PLAYER_CROSSWALK_URL, {
      headers: { Accept: "application/octet-stream", "User-Agent": "Gridline/0.2 (nflverse player crosswalk)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`nflverse player crosswalk request failed with HTTP ${response.status}`);
    }
    compressed = Buffer.from(await response.arrayBuffer());
    await mkdir(join(process.cwd(), ".cache", "nflverse"), { recursive: true });
    const temporaryPath = `${cachePath}.tmp`;
    await writeFile(temporaryPath, compressed);
    await rename(temporaryPath, cachePath);
  }
  const fingerprint = createHash("sha256").update(compressed).digest("hex");
  return {
    rows: parseVerifiedPlayerCrosswalkCsv(gunzipSync(compressed).toString("utf8")),
    fingerprint,
    sourceUrl: NFLVERSE_PLAYER_CROSSWALK_URL,
  };
}