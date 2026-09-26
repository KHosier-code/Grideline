export function isRedZoneFeatureEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.GRIDLINE_RED_ZONE_ENABLED === "1";
}