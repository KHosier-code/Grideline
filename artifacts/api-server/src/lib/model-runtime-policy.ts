export function assertModelFittingAllowed(
  operation: string,
  environment = process.env.NODE_ENV,
) {
  if (environment !== "development" && environment !== "test") {
    throw new Error(
      `${operation} is disabled outside an explicit development or test environment. Production may only import approved already-fitted artifacts.`,
    );
  }
}

export function assertTrainingRunMutationAllowed(
  operation: string,
  environment = process.env.NODE_ENV,
) {
  if (environment !== "development" && environment !== "test") {
    throw new Error(
      `${operation} is disabled outside an explicit development or test environment. Artifact-backed model training runs are append-only.`,
    );
  }
}