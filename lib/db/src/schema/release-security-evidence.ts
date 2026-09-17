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
    connectivityPassed: boolean("connectivity_passed"),
    tlsPassed: boolean("tls_passed"),
    snapshotUpdateGuardPassed: boolean("snapshot_update_guard_passed"),
    snapshotDeleteGuardPassed: boolean("snapshot_delete_guard_passed"),
    gradeUpdateGuardPassed: boolean("grade_update_guard_passed"),
    gradeDeleteGuardPassed: boolean("grade_delete_guard_passed"),
  },
  (table) => [
    check("release_security_evidence_select_one_check", sql`${table.selectOneResult} = 1`),
    check("release_security_evidence_verify_full_check", sql`${table.verifyFullPassed} = true`),
    check("release_security_evidence_connectivity_check", sql`${table.connectivityPassed} = true`),
    check("release_security_evidence_tls_check", sql`${table.tlsPassed} = true`),
    check("release_security_evidence_snapshot_update_check", sql`${table.snapshotUpdateGuardPassed} = true`),
    check("release_security_evidence_snapshot_delete_check", sql`${table.snapshotDeleteGuardPassed} = true`),
    check("release_security_evidence_grade_update_check", sql`${table.gradeUpdateGuardPassed} = true`),
    check("release_security_evidence_grade_delete_check", sql`${table.gradeDeleteGuardPassed} = true`),
  ],
);