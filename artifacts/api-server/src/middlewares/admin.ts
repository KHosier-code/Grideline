import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { readFileSync } from "node:fs";

// Development-only browser release check. Never consulted with production or live Clerk keys.
const themeAdminGrantPath = "/tmp/gridline-theme-admin-grant.json";
function isTemporaryThemeAdmin(userId: string | null | undefined): boolean {
  if (!userId || process.env.NODE_ENV !== "development" || !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) return false;
  try {
    const grant: unknown = JSON.parse(readFileSync(themeAdminGrantPath, "utf8"));
    if (!grant || typeof grant !== "object") return false;
    const { userId: grantedId, expiresAt } = grant as Record<string, unknown>;
    return grantedId === userId && typeof expiresAt === "number" && expiresAt > Date.now() && expiresAt <= Date.now() + 10 * 60_000;
  } catch {
    return false;
  }
}

type AuthResolver = (req: Request) => ReturnType<typeof getAuth>;

export function sessionRole(
  req: Request,
  authResolver: AuthResolver = getAuth,
): string | null {
  const claims = authResolver(req).sessionClaims as Record<string, unknown> | undefined;
  const metadata = claims?.metadata as Record<string, unknown> | undefined;
  const publicMetadata = claims?.publicMetadata as Record<string, unknown> | undefined;
  const snakeCasePublicMetadata = claims?.public_metadata as Record<string, unknown> | undefined;
  const role = claims?.role ?? metadata?.role ?? publicMetadata?.role ?? snakeCasePublicMetadata?.role;
  return typeof role === "string" ? role : null;
}

export function getAdminAuthStatus(req: Request, authResolver: AuthResolver = getAuth) {
  const auth = authResolver(req);
  const configuredIds = [
    process.env.ADMIN_USER_IDS,
    process.env.ADDITIONAL_ADMIN_USER_IDS,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const role = sessionRole(req, authResolver);
  const clerkRoleAdmin = role === "admin";
  const isAdmin = Boolean(auth.userId && (configuredIds.includes(auth.userId) || clerkRoleAdmin || isTemporaryThemeAdmin(auth.userId)));
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

export function createRequireAdmin(authResolver: AuthResolver = getAuth): RequestHandler {
  return (req, res, next) => {
    const status = getAdminAuthStatus(req, authResolver);
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
}

export const requireAdmin: RequestHandler = createRequireAdmin();