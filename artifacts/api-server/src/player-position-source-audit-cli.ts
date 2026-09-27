import { retrievePlayerPositionSource } from "./lib/player-position-releases";

async function main() {
  const [seasonArg, fingerprint, dataset, outputPath] = process.argv.slice(2);
  const season = Number(seasonArg);
  if (!Number.isSafeInteger(season) || !fingerprint
    || (dataset !== "pbp" && dataset !== "player_stats")) {
    throw new Error("Usage: player-position:source:audit <season> <release-fingerprint> <pbp|player_stats> [output.csv.gz]");
  }
  const { archive, publisherEvidence } = await retrievePlayerPositionSource(
    season, fingerprint, dataset, outputPath);
  process.stdout.write(JSON.stringify({
    dataset: archive.dataset, season: archive.season, sha256: archive.sha256,
    size: archive.size, objectKey: archive.objectKey, generation: archive.generation,
    publisherEvidence, verified: true, outputPath: outputPath ?? null,
  }) + "\n");
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});