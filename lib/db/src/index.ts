import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { withExplicitTlsMode } from "./connection";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: withExplicitTlsMode(process.env.DATABASE_URL),
});
export const db = drizzle(pool, { schema });

/** A separate pool a caller closes when done, e.g. the startup check, which retries while the database is down. */
export function createPool() {
  return new Pool({ connectionString: withExplicitTlsMode(process.env.DATABASE_URL!) });
}

export * from "./schema";
