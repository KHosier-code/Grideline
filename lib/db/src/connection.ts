export function withExplicitTlsMode(connectionString: string): string {
  const url = new URL(connectionString);
  const configuredTlsMode = url.searchParams.get("sslmode");
  const tlsMode =
    configuredTlsMode === null || configuredTlsMode === "disable"
      ? "disable"
      : "verify-full";
  url.searchParams.set("sslmode", tlsMode);
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}