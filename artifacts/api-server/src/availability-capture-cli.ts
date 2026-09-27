import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { captureVerifiedPlayerAvailability, type AvailabilityCapture } from "./lib/availability-source";

async function main() {
  if (process.argv.length !== 3) throw new Error("Usage: availability-capture-cli <reviewed-captures.json>");
  const captures: unknown = JSON.parse(await readFile(process.argv[2]!, "utf8"));
  if (!Array.isArray(captures) || captures.length === 0 || captures.length > 50) {
    throw new Error("Expected a nonempty array of reviewed source observations (maximum 50)");
  }
  for (const input of captures as AvailabilityCapture[]) {
    const id = await captureVerifiedPlayerAvailability(input);
    process.stdout.write(`${input.gameId} ${input.playerId} ${input.kind}: ${id}\n`);
  }
}
main().catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; })
  .finally(() => pool.end());