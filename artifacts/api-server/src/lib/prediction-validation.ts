export type PredictionValidationInput = {
  projectedHomeScore?: number | null;
  projectedAwayScore?: number | null;
  projectedMargin: number | null;
  projectedTotal: number | null;
  homeWinProbability: number | null;
  awayWinProbability: number | null;
};

export type PredictionValidationFailure = {
  failedField: string;
  invalidValue: string;
  invalidType: string;
  failureReason: string;
};

function describe(value: unknown) {
  return {
    invalidValue: value === null ? "null" : typeof value === "number" && Number.isNaN(value) ? "NaN" : String(value),
    invalidType: value === null ? "null" : typeof value,
  };
}

function finiteFailure(field: string, value: unknown, required = true): PredictionValidationFailure | null {
  if (value === null || value === undefined) {
    return required ? { failedField: field, ...describe(value), failureReason: "required numeric output is missing" } : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { failedField: field, ...describe(value), failureReason: "value must be finite" };
  }
  return null;
}

export function validatePredictionOutputs(input: PredictionValidationInput): PredictionValidationFailure[] {
  const failures: PredictionValidationFailure[] = [];
  for (const [field, value] of [
    ["projectedMargin", input.projectedMargin],
    ["projectedTotal", input.projectedTotal],
    ["projectedHomeScore", input.projectedHomeScore],
    ["projectedAwayScore", input.projectedAwayScore],
    ["homeWinProbability", input.homeWinProbability],
    ["awayWinProbability", input.awayWinProbability],
  ] as const) {
    const failure = finiteFailure(field, value, field !== "projectedHomeScore" && field !== "projectedAwayScore");
    if (failure) failures.push(failure);
  }
  for (const [field, value] of [
    ["homeWinProbability", input.homeWinProbability],
    ["awayWinProbability", input.awayWinProbability],
  ] as const) {
    if (typeof value === "number" && Number.isFinite(value) && (value < 0 || value > 1)) {
      failures.push({ failedField: field, ...describe(value), failureReason: "probability must be between 0 and 1" });
    }
  }
  if (
    typeof input.homeWinProbability === "number" &&
    Number.isFinite(input.homeWinProbability) &&
    typeof input.awayWinProbability === "number" &&
    Number.isFinite(input.awayWinProbability) &&
    Math.abs(input.homeWinProbability + input.awayWinProbability - 1) > 0.001
  ) {
    failures.push({
      failedField: "probabilitySum",
      invalidValue: `${input.homeWinProbability}+${input.awayWinProbability}`,
      invalidType: "number",
      failureReason: "home and away probabilities must sum to approximately 1",
    });
  }
  return failures;
}

export function safeNoVigProbabilities(homeImplied: number, awayImplied: number) {
  if (!Number.isFinite(homeImplied) || !Number.isFinite(awayImplied) || homeImplied < 0 || awayImplied < 0) return null;
  const total = homeImplied + awayImplied;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { home: homeImplied / total, away: awayImplied / total };
}