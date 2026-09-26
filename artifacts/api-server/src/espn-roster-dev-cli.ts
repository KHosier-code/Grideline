import { pool } from "@workspace/db";
import { ESPN_ROSTER_CONFIRMATION, syncEspnCompleteRosters } from "./lib/availability";

void (async () => {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== ESPN_ROSTER_CONFIRMATION) {
      throw new Error(`Development-only capture requires ${ESPN_ROSTER_CONFIRMATION}; do not run without separate authorization`);
    }
    const result = await syncEspnCompleteRosters(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();