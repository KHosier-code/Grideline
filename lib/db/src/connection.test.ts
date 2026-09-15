import assert from "node:assert/strict";
import test from "node:test";
import { withExplicitTlsMode } from "./connection";

test("uses verify-full when a remote connection requests TLS", () => {
  const result = new URL(
    withExplicitTlsMode(
      "postgresql://user:password@db.example.com/app?sslmode=require",
    ),
  );

  assert.equal(result.searchParams.get("sslmode"), "verify-full");
});

test("explicitly disables TLS when development provides no TLS mode", () => {
  const result = new URL(
    withExplicitTlsMode("postgresql://user:password@db-proxy.local:5432/app"),
  );

  assert.equal(result.searchParams.get("sslmode"), "disable");
});

test("replaces compatibility TLS modes and preserves other parameters", () => {
  const result = new URL(
    withExplicitTlsMode(
      "postgresql://user:password@db.example.com/app?sslmode=require&uselibpqcompat=true&application_name=gridline",
    ),
  );

  assert.equal(result.searchParams.get("sslmode"), "verify-full");
  assert.equal(result.searchParams.has("uselibpqcompat"), false);
  assert.equal(result.searchParams.get("application_name"), "gridline");
});