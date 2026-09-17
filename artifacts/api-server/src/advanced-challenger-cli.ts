import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { runAdvancedChallenger } from "./lib/advanced-challenger";

export async function writeImmutable(path: string, content: string) {
  try {
    const existing = await readFile(path, "utf8");
    if (existing !== content) throw new Error(`Immutable report exists with different bytes: ${path}; choose a new version/path`);
    return "unchanged";
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Immutable report")) throw error;
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    return "created";
  }
}

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("The advanced challenger CLI is development-only");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const jsonPath = resolve(root, process.argv[2] ?? "reports/gridline-advanced-challenger-evaluation.json");
  const markdownPath = resolve(process.argv[3] ?? jsonPath.replace(/\.json$/, ".md"));
  const result = await runAdvancedChallenger();
  await mkdir(resolve(jsonPath, ".."), { recursive: true });
  await writeImmutable(jsonPath, `${JSON.stringify(result.report, null, 2)}\n`);
  await writeImmutable(markdownPath, `${result.markdown}\n`);
  console.log(JSON.stringify({ output: jsonPath, markdown: markdownPath, immutable: result.immutable, root }));
}

main().finally(() => pool.end()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});