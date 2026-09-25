import { syncNflverseHistory } from "./lib/nflverse";
import { logger } from "./lib/logger";

// Intentionally not a production repair command: production imports need separate approval.
if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Player-stat import CLI is restricted to development");
}
const season = Number(process.argv.at(-1));
if (!Number.isInteger(season) || season < 2000 || season > 2100) {
  throw new Error("Pass one NFL season as an integer (for example: 2026)");
}
const result = await syncNflverseHistory([season], { datasets: ["player_stats"], refresh: true });
logger.info({ season, result }, "Development player-stat import finished");
if (result.status !== "success") process.exitCode = 1;