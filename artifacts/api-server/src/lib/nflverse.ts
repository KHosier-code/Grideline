export const nflverseBaseUrl = "https://github.com/nflverse/nflverse-data/releases/download";

export function getNflverseHealth() {
  return {
    status: "stale" as const,
    detail: "Public historical datasets are available; historical sync has not been run yet.",
    lastUpdated: null,
    requestsToday: 0,
    requestsThisMonth: 0,
    remainingQuota: null,
  };
}