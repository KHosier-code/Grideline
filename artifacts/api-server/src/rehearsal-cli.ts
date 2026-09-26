import { assertRehearsalConfiguration, assertDisposableDatabaseIdentity, installRehearsalGuards } from "./lib/worker-rehearsal";

assertRehearsalConfiguration(process.env);
installRehearsalGuards(process.env);
const { pool } = await import("@workspace/db");
try {
  await assertDisposableDatabaseIdentity(process.env, (statement) => pool.query(statement));
  const { runFixture } = await import("./lib/worker-rehearsal-fixture");
  const result = await runFixture(process.argv[2] ?? "");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}