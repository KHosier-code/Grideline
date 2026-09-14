import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type PromotionSafetyGateResult = {
  status: "passed" | "failed";
  checkedAt: string;
  candidateModelVersion: string;
  predictionValidation: { passed: number; total: number };
  leakage: { passed: number; total: number };
  failureDetails: string[];
};

export class PromotionSafetyGateError extends Error {
  constructor(public readonly result: PromotionSafetyGateResult) {
    super("Promotion safety gate failed.");
    this.name = "PromotionSafetyGateError";
  }
}

function findWorkspaceRoot(start = process.cwd()) {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    current = dirname(current);
  }
  throw new Error("Could not locate the workspace root for the promotion safety gate.");
}

function parseTestSummaries(output: string) {
  const totals = [...output.matchAll(/^ℹ tests (\d+)$/gm)].map((match) => Number(match[1]));
  const passed = [...output.matchAll(/^ℹ pass (\d+)$/gm)].map((match) => Number(match[1]));
  return {
    predictionValidation: { passed: passed[0] ?? 0, total: totals[0] ?? 0 },
    leakage: { passed: passed[1] ?? 0, total: totals[1] ?? 0 },
  };
}

function sanitizedFailureDetails(output: string, workspaceRoot: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.replaceAll(workspaceRoot, "<workspace>").trim())
    .filter((line) => line.startsWith("✖") || /AssertionError|failed|error/i.test(line))
    .slice(-12)
    .map((line) => line.slice(0, 300));
}

export async function runPromotionSafetyGate(candidateModelVersion: string): Promise<PromotionSafetyGateResult> {
  const workspaceRoot = findWorkspaceRoot();
  const checkedAt = new Date().toISOString();
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
    const output = `${result.stdout}${result.stderr}`.trim();
    return {
      status: "passed" as const,
      checkedAt,
      candidateModelVersion,
      ...parseTestSummaries(output),
      failureDetails: [],
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
    const result: PromotionSafetyGateResult = {
      status: "failed",
      checkedAt,
      candidateModelVersion,
      ...parseTestSummaries(output),
      failureDetails: sanitizedFailureDetails(output || failure.message || "Safety command failed without diagnostic output.", workspaceRoot),
    };
    if (!result.failureDetails.length) result.failureDetails.push("Safety checks failed without a reportable test detail.");
    throw new PromotionSafetyGateError(result);
  }
}