import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const releaseSecurityEvidenceTable = pgTable("release_security_evidence", {
    buildId: text("build_id").primaryKey(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    selectOneResult: integer("select_one_result").notNull(),
    verifyFullPassed: boolean("verify_full_passed").notNull(),
  },
  (table) => [
    check("release_security_evidence_select_one_check", sql`${table.selectOneResult} = 1`),
    check("release_security_evidence_verify_full_check", sql`${table.verifyFullPassed} = true`),
  ],
);