import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

export function sessionRole(req: Parameters<RequestHandler>[0]): string | null {
  const claims = getAuth(req).sessionClaims as Record<string, unknown> | undefined;
  const metadata = claims?.metadata as Record<string, unknown> | undefined;
  const publicMetadata = claims?.publicMetadata as Record<string, unknown> | undefined;
  const snakeCasePublicMetadata = claims?.public_metadata as Record<string, unknown> | undefined;
  const role = claims?.role ?? metadata?.role ?? publicMetadata?.role ?? snakeCasePublicMetadata?.role;
  return typeof role === "string" ? role : null;
}

export function getAdminAuthStatus(req: Parameters<RequestHandler>[0]) {
  const auth = getAuth(req);
  const configuredIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const role = sessionRole(req);
  const clerkRoleAdmin = role === "admin";
  const isAdmin = Boolean(auth.userId && (configuredIds.includes(auth.userId) || clerkRoleAdmin));
  return {
    authenticated: Boolean(auth.userId),
    userId: auth.userId ?? null,
    sessionRole: role,
    clerkRoleAdmin,
    adminUserIdsConfigured: configuredIds.length > 0,
    isAdmin,
    requiredAdminUserId: auth.userId && !isAdmin ? auth.userId : null,
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const status = getAdminAuthStatus(req);
  if (!status.authenticated) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (!status.isAdmin) {
    res.status(403).json({
      error: "Administrator access required.",
      userId: status.userId,
      adminUserIdsConfigured: status.adminUserIdsConfigured,
      requiredAdminUserId: status.requiredAdminUserId,
    });
    return;
  }
  next();
};