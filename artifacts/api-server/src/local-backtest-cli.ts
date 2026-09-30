/**
 * Local development only: walk-forward backtest of the production game model
 * configuration against closing lines from nflverse games.csv.
 * For each test season S the models are trained only on 2021..S-1.
 *
 *   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/local-backtest-cli.ts path/to/games.csv
 */
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { loadExamples, modelFor, standardize } from "./lib/modeling";
import { PREGAME_FEATURE_VERSION } from "./lib/features";
import { addResult, emptyRecordLine, gradePicks, picksForProjection, type RecordLine } from "./lib/pick-grading";

function parseCsv(text: string) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(",");
  return lines.map((line) => Object.fromEntries(names.map((name, index) => [name, line.split(",")[index] ?? ""])));
}
const pct = (line: RecordLine) => line.wins + line.losses ? `${((100 * line.wins) / (line.wins + line.losses)).toFixed(1)}%` : "—";
const fmt = (line: RecordLine) => `${line.wins}-${line.losses}-${line.pushes} (${pct(line)})`;

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("development only");
  const lines = new Map(parseCsv(await readFile(process.argv[2], "utf8"))
    .filter((row) => row.espn && row.spread_line !== "")
    // nflverse spread_line = points the home team is favored by; the home spread is its negative.
    .flatMap((row) => {
      const line = { homeLine: -Number(row.spread_line), total: Number(row.total_line) };
      return [[row.espn, line], [row.game_id, line]] as const;
    }));
  const { examples } = await loadExamples(PREGAME_FEATURE_VERSION);
  console.log(`examples ${examples.length}, seasons ${[...new Set(examples.map((e) => e.season))].join(",")}, with lines ${examples.filter((e) => lines.has(e.gameId)).length}, lines ${lines.size}`);
  for (const testSeason of [2023, 2024, 2025, 2026]) {
    const train = examples.filter((example) => example.season >= 2021 && example.season < testSeason);
    const test = examples.filter((example) => example.season === testSeason && lines.has(example.gameId));
    if (train.length < 100 || !test.length) continue;
    const spreadScaled = standardize(train.map((row) => row.x), test.map((row) => row.x));
    const spreadModel = modelFor("linear_regression", spreadScaled.train, train.map((row) => row.margin), false);
    const mlModel = modelFor("logistic_regression", spreadScaled.train, train.map((row) => row.homeWin), true);
    const totalTrain = train.filter((row) => !row.lowSample);
    const totalScaled = standardize(totalTrain.map((row) => row.x), test.map((row) => row.x));
    const totalModel = modelFor("gradient_boosting", totalScaled.train, totalTrain.map((row) => row.total), false);

    const ats = emptyRecordLine();
    const ou = emptyRecordLine();
    const winners = emptyRecordLine();
    const marketFavorites = emptyRecordLine();
    const buckets = new Map<string, RecordLine>([["0-1.5", emptyRecordLine()], ["1.5-3", emptyRecordLine()], ["3-5", emptyRecordLine()], ["5+", emptyRecordLine()]]);
    let marginAbsError = 0; let lineAbsError = 0; const totals: number[] = [];
    test.forEach((example, index) => {
      const line = lines.get(example.gameId)!;
      const margin = spreadModel.predict(spreadScaled.test[index]);
      const total = totalModel.predict(totalScaled.test[index]);
      const homeWin = Math.min(0.999, Math.max(0.001, mlModel.predict(spreadScaled.test[index])));
      totals.push(total);
      const projection = { margin, total, homeWinProbability: homeWin, spreadLine: line.homeLine, totalLine: line.total };
      const picks = picksForProjection(projection);
      const graded = gradePicks(picks, projection, example.actualHomeScore, example.actualAwayScore);
      addResult(ats, graded.spread);
      addResult(ou, graded.total);
      addResult(winners, graded.winner);
      const marketPicks = picksForProjection({ ...projection, margin: -line.homeLine, homeWinProbability: null });
      addResult(marketFavorites, gradePicks(marketPicks, projection, example.actualHomeScore, example.actualAwayScore).winner);
      if (picks.spread) {
        const edge = picks.spread.edge;
        addResult(buckets.get(edge < 1.5 ? "0-1.5" : edge < 3 ? "1.5-3" : edge < 5 ? "3-5" : "5+")!, graded.spread);
      }
      const actual = example.actualHomeScore - example.actualAwayScore;
      marginAbsError += Math.abs(margin - actual);
      lineAbsError += Math.abs(-line.homeLine - actual);
    });
    const spreadOfTotals = Math.sqrt(totals.reduce((sum, value) => sum + (value - totals.reduce((a, b) => a + b, 0) / totals.length) ** 2, 0) / totals.length);
    console.log(`\n${testSeason} (trained on 2021-${testSeason - 1}, ${test.length} games)`);
    console.log(`  Winners: model ${fmt(winners)} | Vegas favorite ${fmt(marketFavorites)}`);
    console.log(`  Margin error: model ${(marginAbsError / test.length).toFixed(2)} pts | closing line ${(lineAbsError / test.length).toFixed(2)} pts`);
    console.log(`  ATS: ${fmt(ats)}   by edge: ${[...buckets].map(([key, value]) => `${key}: ${fmt(value)}`).join(" | ")}`);
    console.log(`  O/U: ${fmt(ou)}   (projected totals vary by ${spreadOfTotals.toFixed(2)} pts)`);
  }
  await pool.end();
}

await main();
