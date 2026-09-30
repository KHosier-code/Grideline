/**
 * Local development only: seed teams and the schedule (with final scores)
 * from nflverse's public games.csv, using ESPN team and event IDs so rows
 * match what the ESPN schedule sync would have written.
 *
 * Usage (from repo root, against a local database):
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5434/gridline?sslmode=disable \
 *   NODE_ENV=development pnpm --filter @workspace/scripts exec tsx \
 *   ../artifacts/api-server/src/local-seed-cli.ts path/to/games.csv 2021 2026
 */
import { readFile } from "node:fs/promises";
import { db, gamesTable, pool, teamsTable } from "@workspace/db";

const TEAMS: Array<[espnId: string, abbreviation: string, name: string, conference: string, division: string, nflverse: string]> = [
  ["22", "ARI", "Arizona Cardinals", "NFC", "West", "ARI"], ["1", "ATL", "Atlanta Falcons", "NFC", "South", "ATL"],
  ["33", "BAL", "Baltimore Ravens", "AFC", "North", "BAL"], ["2", "BUF", "Buffalo Bills", "AFC", "East", "BUF"],
  ["29", "CAR", "Carolina Panthers", "NFC", "South", "CAR"], ["3", "CHI", "Chicago Bears", "NFC", "North", "CHI"],
  ["4", "CIN", "Cincinnati Bengals", "AFC", "North", "CIN"], ["5", "CLE", "Cleveland Browns", "AFC", "North", "CLE"],
  ["6", "DAL", "Dallas Cowboys", "NFC", "East", "DAL"], ["7", "DEN", "Denver Broncos", "AFC", "West", "DEN"],
  ["8", "DET", "Detroit Lions", "NFC", "North", "DET"], ["9", "GB", "Green Bay Packers", "NFC", "North", "GB"],
  ["34", "HOU", "Houston Texans", "AFC", "South", "HOU"], ["11", "IND", "Indianapolis Colts", "AFC", "South", "IND"],
  ["30", "JAX", "Jacksonville Jaguars", "AFC", "South", "JAX"], ["12", "KC", "Kansas City Chiefs", "AFC", "West", "KC"],
  ["13", "LV", "Las Vegas Raiders", "AFC", "West", "LV"], ["24", "LAC", "Los Angeles Chargers", "AFC", "West", "LAC"],
  ["14", "LAR", "Los Angeles Rams", "NFC", "West", "LA"], ["15", "MIA", "Miami Dolphins", "AFC", "East", "MIA"],
  ["16", "MIN", "Minnesota Vikings", "NFC", "North", "MIN"], ["17", "NE", "New England Patriots", "AFC", "East", "NE"],
  ["18", "NO", "New Orleans Saints", "NFC", "South", "NO"], ["19", "NYG", "New York Giants", "NFC", "East", "NYG"],
  ["20", "NYJ", "New York Jets", "AFC", "East", "NYJ"], ["21", "PHI", "Philadelphia Eagles", "NFC", "East", "PHI"],
  ["23", "PIT", "Pittsburgh Steelers", "AFC", "North", "PIT"], ["25", "SF", "San Francisco 49ers", "NFC", "West", "SF"],
  ["26", "SEA", "Seattle Seahawks", "NFC", "West", "SEA"], ["27", "TB", "Tampa Bay Buccaneers", "NFC", "South", "TB"],
  ["10", "TEN", "Tennessee Titans", "AFC", "South", "TEN"], ["28", "WSH", "Washington Commanders", "NFC", "East", "WAS"],
];
const ALIASES: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };

function parseCsv(text: string) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(names.map((name, index) => [name, values[index] ?? ""]));
  });
}

/** nflverse gameday/gametime are US Eastern; convert to a UTC instant. */
function easternToUtc(day: string, time: string) {
  const [hour, minute] = (time || "13:00").split(":").map(Number);
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const eastern = new Date(guess.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() + (utc.getTime() - eastern.getTime()));
}

async function main() {
  if (process.env.NODE_ENV !== "development" || !/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("local-seed-cli only runs with NODE_ENV=development against a localhost database");
  }
  const [file, from = "2021", to = "2026"] = process.argv.slice(2);
  const rows = parseCsv(await readFile(file, "utf8"))
    .filter((row) => row.game_type === "REG" && Number(row.season) >= Number(from) && Number(row.season) <= Number(to) && row.espn);
  const byNflverse = new Map(TEAMS.map(([id, , , , , code]) => [code, id]));
  await db.insert(teamsTable).values(TEAMS.map(([teamId, abbreviation, teamName, conference, division]) => ({
    teamId, abbreviation, teamName, conference, division,
    logoUrl: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png`, sourceUpdatedAt: new Date(),
  }))).onConflictDoNothing();
  let count = 0;
  for (const row of rows) {
    const home = byNflverse.get(ALIASES[row.home_team] ?? row.home_team);
    const away = byNflverse.get(ALIASES[row.away_team] ?? row.away_team);
    if (!home || !away) throw new Error(`Unknown team in ${row.game_id}`);
    const kickoff = easternToUtc(row.gameday, row.gametime);
    const final = row.home_score !== "" && row.away_score !== "";
    const values = {
      gameId: row.espn, season: Number(row.season), week: Number(row.week), gameDate: kickoff, kickoffTime: kickoff,
      homeTeamId: home, awayTeamId: away, stadium: row.stadium || null,
      finalHomeScore: final ? Number(row.home_score) : null, finalAwayScore: final ? Number(row.away_score) : null,
      gameStatus: final ? "STATUS_FINAL" : "STATUS_SCHEDULED", broadcast: null, sourceUpdatedAt: new Date(),
    };
    await db.insert(gamesTable).values(values).onConflictDoUpdate({ target: gamesTable.gameId, set: values });
    count += 1;
  }
  console.log(`Seeded ${TEAMS.length} teams and ${count} games (${from}-${to}).`);
  await pool.end();
}

await main();
