import type { RequestHandler } from "express";
import { isCbbPublic } from "../../../../lib/launch/sports-launch.mjs";
import { requireAdmin } from "./admin";

/**
 * College basketball is admin-only until its public launch
 * (lib/launch/sports-launch.mjs), then open to everyone.
 */
export function createRequireAdminUntilCbbLaunch(
  gate: RequestHandler = requireAdmin,
  now: () => number = Date.now,
): RequestHandler {
  return (req, res, next) => {
    if (isCbbPublic(now())) {
      next();
      return;
    }
    gate(req, res, next);
  };
}

export const requireAdminUntilCbbLaunch = createRequireAdminUntilCbbLaunch();
