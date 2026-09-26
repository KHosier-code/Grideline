import { pool } from "@workspace/db";
import type { Feed } from "./feed-schedule";

// Session locks prevent duplicate jobs across API replicas. Manual syncs share them.
export async function withFeedLock<T>(feed: Feed, work: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  const key = feed === "injuries" ? 731401 : feed === "nflverse" ? 731402 : 731403;
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [key]);
    locked = result.rows[0].locked;
    if (!locked) return null;
    return await work();
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch (error) {
        client.release(true);
        throw error;
      }
    }
    client.release();
  }
}