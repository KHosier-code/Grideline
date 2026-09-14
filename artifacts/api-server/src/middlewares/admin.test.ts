import test from "node:test";
import assert from "node:assert/strict";
import { createRequireAdmin } from "./admin";

type AuthContext = {
  userId: string | null;
  sessionClaims?: Record<string, unknown>;
};

type Result = {
  statusCode: number | null;
  body: Record<string, unknown> | null;
  nextCalled: boolean;
};

async function invoke(auth: AuthContext, adminUserIds?: string): Promise<Result> {
  const previousAdminUserIds = process.env.ADMIN_USER_IDS;
  if (adminUserIds === undefined) {
    delete process.env.ADMIN_USER_IDS;
  } else {
    process.env.ADMIN_USER_IDS = adminUserIds;
  }

  const result: Result = { statusCode: null, body: null, nextCalled: false };
  const requireAdmin = createRequireAdmin(() => auth as never);
  const response = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      result.body = body;
      return this;
    },
  };

  try {
    requireAdmin({} as never, response as never, () => {
      result.nextCalled = true;
    });
  } finally {
    if (previousAdminUserIds === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = previousAdminUserIds;
    }
  }
  return result;
}

test("requireAdmin rejects anonymous requests with 401", async () => {
  const result = await invoke({ userId: null });

  assert.equal(result.statusCode, 401);
  assert.equal(result.body?.error, "Authentication required.");
  assert.equal(result.nextCalled, false);
});

test("requireAdmin rejects authenticated non-admin users with 403", async () => {
  const result = await invoke({ userId: "user_member" });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body?.error, "Administrator access required.");
  assert.equal(result.nextCalled, false);
});

test("requireAdmin allows users listed in ADMIN_USER_IDS", async () => {
  const result = await invoke({ userId: "user_configured_admin" }, "user_configured_admin");

  assert.equal(result.statusCode, null);
  assert.equal(result.body, null);
  assert.equal(result.nextCalled, true);
});

test("requireAdmin allows an admin role claim", async () => {
  const result = await invoke({
    userId: "user_role_admin",
    sessionClaims: { role: "admin" },
  });

  assert.equal(result.statusCode, null);
  assert.equal(result.body, null);
  assert.equal(result.nextCalled, true);
});