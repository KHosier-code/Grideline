import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

function metadataRole(req: Parameters<RequestHandler>[0]): unknown {
  const claims = getAuth(req).sessionClaims as Record<string, unknown> | undefined;
  const metadata = claims?.metadata as Record<string, unknown> | undefined;
  const publicMetadata = claims?.publicMetadata as Record<string, unknown> | undefined;
  return metadata?.role ?? publicMetadata?.role;
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const configuredIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isAdmin = configuredIds.includes(auth.userId) || metadataRole(req) === "admin";
  if (!isAdmin) {
    res.status(403).json({ error: "Administrator access required." });
    return;
  }
  next();
};