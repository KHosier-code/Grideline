import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

function findWorkspaceRoot(start = process.cwd()) {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    current = dirname(current);
  }
  throw new Error("Could not locate the workspace root for the promotion safety gate.");
}

export async function runPromotionSafetyGate() {
  const workspaceRoot = findWorkspaceRoot();
  const command = "pnpm --filter @workspace/scripts run test:prediction-safety";
  try {
    const result = await execFileAsync("pnpm", [
      "--filter",
      "@workspace/scripts",
      "run",
      "test:prediction-safety",
    ], {
      cwd: workspaceRoot,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      status: "passed" as const,
      command,
      output: `${result.stdout}${result.stderr}`.trim(),
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
    throw new Error(`Promotion safety gate failed. ${output || failure.message || "No diagnostic output was produced."}`);
  }
}