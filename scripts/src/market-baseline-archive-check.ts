import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ACCEPTED = "phase6-1-2025-market-baseline-v4-bc87373a5d1a-f289a18f99c4";
const SOURCE_SHA = "bc87373a5d1a578ac07c71cb6a1e50a381d58fae393021b96853a4b8674ae8b8";
const FAMILIES = ["spread", "moneyline", "totals"] as const;
const CONFIG = {
  spread: ["linear_regression", "include_low_sample"],
  moneyline: ["logistic_regression", "include_low_sample"],
  totals: ["gradient_boosting", "exclude_low_sample"],
} as const;
const HYPERPARAMETERS = {
  spread: { ridgeLambda: 1 },
  moneyline: { epochs: 350, learningRate: 0.08, coefficientRegularization: 0.02 },
  totals: { rounds: 8, depth: 2, learningRate: 0.08, minLeafSamples: 5 },
} as const;
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;
type HistoricalMarketQuote = { sourceGameId: string; altGameId: string; family: string; side: string; point: number | null; price: number | null; sourceOutcome: null };
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const normalized = (s: string) => `${s.replace(/\r\n/g, "\n").trim()}\n`;

function csvRows(input: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(Boolean)) result.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("Malformed CSV: unclosed quote");
  row.push(field);
  if (row.some(Boolean)) result.push(row);
  return result;
}
const numeric = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

function qualifiedQuotes(csv: string, datasets: string, readme: string): HistoricalMarketQuote[] {
  if (sha(csv) !== SOURCE_SHA) throw new Error("Source CSV checksum does not match accepted fingerprint");
  const section = datasets.replace(/\r\n/g, "\n").match(/## Games\n[\s\S]*?(?=\n<a name="colors"\/?>)/)?.[0];
  if (!section || sha(normalized(section)) !== "5aacebf50250ac29a1de79d71fa7e258e621da8d16f1692b38d926775ad4939c"
    || sha(normalized(readme)) !== "42035b4ee0e548389ef91509bc672a861b43c6226a7317507d41536816c9f88a")
    throw new Error("Source documentation fingerprints changed; review required");
  const [head = [], ...rows] = csvRows(csv);
  const header = head.map(s => s.trim().toLowerCase());
  const required = ["game_id", "season", "game_type", "week", "gameday", "gametime", "away_team", "away_score",
    "home_team", "home_score", "location", "away_moneyline", "home_moneyline", "spread_line",
    "away_spread_odds", "home_spread_odds", "total_line", "under_odds", "over_odds"];
  if (required.some(col => !header.includes(col))) throw new Error("Missing required recorded-market CSV columns");
  const value = (row: string[], col: string) => row[header.indexOf(col)] ?? "";
  const seasonRows = rows.filter(row => numeric(value(row, "season")) === 2025);
  const weeks = [...new Set(seasonRows.map(row => numeric(value(row, "week"))))].sort((a, b) => Number(a) - Number(b));
  if (seasonRows.length !== 285 || weeks.join(",") !== Array.from({ length: 22 }, (_, i) => i + 1).join(","))
    throw new Error("2025 event/week coverage differs from approved source contract");
  return seasonRows.flatMap(row => {
    const sourceGameId = value(row, "game_id");
    if (!sourceGameId) return [];
    const base = { sourceGameId, altGameId: sourceGameId, sourceOutcome: null } as const;
    const quotes: HistoricalMarketQuote[] = [];
    const add = (family: string, side: string, point: number | null, price: number | null) =>
      quotes.push({ ...base, family, side, point, price });
    const awayML = numeric(value(row, "away_moneyline")), homeML = numeric(value(row, "home_moneyline"));
    if (awayML !== null) add("moneyline", "away", null, awayML);
    if (homeML !== null) add("moneyline", "home", null, homeML);
    const spread = numeric(value(row, "spread_line"));
    if (spread !== null) {
      add("spread", "away", spread, numeric(value(row, "away_spread_odds")));
      add("spread", "home", -spread, numeric(value(row, "home_spread_odds")));
    }
    const total = numeric(value(row, "total_line"));
    if (total !== null) {
      add("totals", "under", total, numeric(value(row, "under_odds")));
      add("totals", "over", total, numeric(value(row, "over_odds")));
    }
    return quotes;
  });
}

// Accept only a table-row JSON export; never connect to or import into a database.
const COLUMNS: Record<string, string[]> = {
  market_baseline_runs: ["run_id", "season", "source", "source_url", "source_files", "source_fingerprints", "status", "metadata"],
  market_baseline_events: ["run_id", "source_game_id", "alt_game_id", "outcome", "reason", "candidate_game_ids", "matched_game_id", "alias_used"],
  market_baseline_quotes: ["run_id", "source_game_id", "alt_game_id", "matched_game_id", "source_file", "family", "side", "point", "price", "source_designation", "sportsbook", "observed_at", "source_timestamp", "source_outcome"],
  model_training_runs: ["model_version", "family", "algorithm", "feature_version", "training_seasons", "test_season", "sample_policy", "status", "sample_size", "metrics", "vector_feature_names", "vector_schema_fingerprint", "model_artifact"],
  model_evaluation_predictions: ["evaluation_run_id", "model_version", "family", "algorithm", "feature_version", "test_season", "week", "evaluation_stage", "game_id", "kickoff_time", "prediction_cutoff", "training_seasons", "training_cutoff", "home_team_id", "away_team_id", "home_feature_source_cutoff", "away_feature_source_cutoff", "low_sample", "predicted_value", "actual_value", "actual_home_score", "actual_away_score", "actual_margin", "actual_total", "actual_home_win", "projected_home_win_probability", "projected_away_win_probability", "projected_margin", "projected_total", "market_sportsbook", "market_name", "market_selection", "market_side", "market_point", "market_price", "market_observed_at", "market_evidence", "closing_market_evidence"],
  games: ["game_id", "season", "week", "kickoff_time", "home_team_id", "away_team_id", "final_home_score", "final_away_score"],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function artifactChecksum(artifact: Row): string {
  const { metadata, ...payload } = artifact;
  if (!metadata || typeof metadata !== "object") return "";
  const { artifactId: _id, artifactChecksum: _checksum, createdAt: _at, ...stable } = metadata;
  return createHash("sha256").update(canonical({ ...payload, metadata: stable })).digest("hex");
}

const close = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const date = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;
const key = (row: Row) => `${row.family}:${row.game_id}`;
const quoteKey = (row: Row) => `${row.source_game_id}:${row.family}:${row.side}`;

export function validateMarketBaselineArchive(
  input: unknown, retained: Row, rawQuotes?: HistoricalMarketQuote[],
): { status: "verified" | "blocked"; mismatches: string[]; warnings: string[]; counts: Row } {
  const mismatches: string[] = [];
  const warnings: string[] = [];
  const fail = (message: string) => mismatches.push(message);
  const tables = (input as Row)?.tables as Tables | undefined;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    return { status: "blocked", mismatches: ["Expected { tables: { table_name: [row, ...] } }"], warnings, counts: {} };
  }
  const rows: Tables = {};
  for (const [table, columns] of Object.entries(COLUMNS)) {
    const value = tables[table];
    if (!Array.isArray(value)) { fail(`Missing table ${table} (array required)`); rows[table] = []; continue; }
    rows[table] = value;
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        fail(`${table}[${index}] is not a row object`); continue;
      }
      const missing = columns.filter(column => !(column in item));
      if (missing.length) fail(`${table}[${index}] missing columns: ${missing.join(", ")}`);
    }
  }
  const [runs, events, quotes, models, predictions, games] = Object.keys(COLUMNS).map(table => rows[table]);
  const counts = Object.fromEntries(Object.keys(COLUMNS).map(table => [table, rows[table].length]));
  const expectedRun = retained.evaluationRunId;
  if (expectedRun !== ACCEPTED) fail("Retained report does not identify the approved run");
  if (runs.length !== 1) fail(`Expected one accepted run; found ${runs.length}`);
  const run = runs[0] ?? {};
  if (run.run_id !== ACCEPTED || run.season !== 2025 || run.status !== "complete") fail("Run identity, season, or complete status differs");
  if (run.source !== "nflverse/nfldata" || run.source_fingerprints?.["games.csv"] !== SOURCE_SHA
    || !Array.isArray(run.source_files) || !run.source_files.includes("games.csv"))
    fail("Recorded dataset identity or games.csv fingerprint differs");
  if (run.metadata?.matchContractVersion !== 4 || run.metadata?.evaluationInputFingerprint?.slice(0, 12) !== "f289a18f99c4"
    || run.metadata?.minimumRecordedLineEdge !== 1) fail("Run matching/input/edge contract differs");
  if (run.metadata?.eventCount !== 285 || run.metadata?.quoteCount !== 1710) fail("Persisted event/quote metadata differs from accepted contract");
  if (run.metadata?.closingStatus !== "unavailable" || run.metadata?.timestampStatus !== "unavailable"
    || run.metadata?.sportsbookStatus !== "unavailable") fail("Recorded market provenance was upgraded or lost");
  if (!rawQuotes) warnings.push("Source bytes and documentation not supplied: fingerprint and quotes cannot be independently verified");

  const expectedCounts = retained.coverage ?? {};
  if (events.length !== expectedCounts.sourceEvents || quotes.length !== expectedCounts.quotes) fail("Event/quote totals differ from retained report");
  const eventById = new Map<string, Row>();
  const matched = new Set<string>();
  const outcomes: Row = {};
  for (const e of events) {
    if (e.run_id !== ACCEPTED || !e.source_game_id || eventById.has(e.source_game_id)) fail(`Duplicate/foreign event ${e.source_game_id}`);
    eventById.set(e.source_game_id, e);
    outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
    if (e.matched_game_id) {
      if (matched.has(e.matched_game_id)) fail(`Multiple source events matched ${e.matched_game_id}`);
      matched.add(e.matched_game_id);
    } else if (e.outcome !== "neutral_site") fail(`Unexpected unmatched event ${e.source_game_id}: ${e.outcome}`);
    if ((e.outcome === "alias") !== e.alias_used) fail(`Alias marker differs: ${e.source_game_id}`);
  }
  for (const [outcome, number] of Object.entries(expectedCounts.matchingOutcomes ?? {})) {
    if (outcomes[outcome] !== number) fail(`${outcome} outcome count ${outcomes[outcome] ?? 0} differs from ${number}`);
  }
  const rawByKey = new Map(rawQuotes?.map(q => [`${q.sourceGameId}:${q.family}:${q.side}`, q]) ?? []);
  const seenQuotes = new Set<string>();
  for (const q of quotes) {
    const k = quoteKey(q);
    if (seenQuotes.has(k)) fail(`Duplicate quote ${k}`);
    seenQuotes.add(k);
    const event = eventById.get(q.source_game_id);
    if (q.run_id !== ACCEPTED || !event || q.matched_game_id !== event.matched_game_id || q.alt_game_id !== event.alt_game_id)
      fail(`Quote event linkage differs: ${k}`);
    if (!FAMILIES.includes(q.family) || !({ spread: ["home", "away"], moneyline: ["home", "away"], totals: ["over", "under"] } as Row)[q.family]?.includes(q.side)
      || q.source_file !== "games.csv" || q.source_designation !== "source_designated_recorded"
      || q.sportsbook !== null || q.observed_at !== null || q.source_timestamp !== null)
      fail(`Quote structure or recorded-only provenance differs: ${k}`);
    const original = rawByKey.get(k);
    if (rawQuotes && (!original || q.point !== original.point || q.price !== original.price
      || q.source_outcome !== original.sourceOutcome || q.alt_game_id !== original.altGameId))
      fail(`Quote differs from checksum-verified source: ${k}`);
  }
  if (rawQuotes && (rawByKey.size !== quotes.length || rawByKey.size !== seenQuotes.size))
    fail("Source CSV quotes are incomplete or have extra selections");
  for (const event of events) {
    const selected = quotes.filter(q => q.source_game_id === event.source_game_id);
    if (selected.length !== 6 || new Set(selected.map(q => `${q.family}:${q.side}`)).size !== 6)
      fail(`Expected six distinct recorded selections: ${event.source_game_id}`);
  }

  const gameById = new Map<string, Row>();
  for (const game of games) {
    if (!game.game_id || gameById.has(game.game_id)) fail(`Duplicate/missing game ID ${game.game_id}`);
    gameById.set(game.game_id, game);
  }
  for (const gameId of matched) if (!gameById.has(gameId)) fail(`Matched game absent from exported games: ${gameId}`);
  const byFamily = new Map<string, Row>();
  for (const model of models) {
    if (model.status !== "evaluation_baseline") continue;
    if (!FAMILIES.includes(model.family) || byFamily.has(model.family)) fail(`Duplicate/unknown baseline model ${model.family}`);
    byFamily.set(model.family, model);
  }
  if (models.length !== 3 || byFamily.size !== 3) fail(`Expected exactly 3 baseline model artifacts; found ${models.length} rows / ${byFamily.size} families`);
  const seenPredictions = new Set<string>();
  for (const p of predictions) {
    const k = key(p);
    if (seenPredictions.has(k)) fail(`Duplicate prediction ${k}`);
    seenPredictions.add(k);
    const model = byFamily.get(p.family);
    const game = gameById.get(p.game_id);
    if (!model || p.evaluation_run_id !== ACCEPTED || p.model_version !== model.model_version
      || p.algorithm !== model.algorithm || p.feature_version !== "pregame-v3"
      || p.test_season !== 2025 || p.evaluation_stage !== "season_holdout"
      || canonical(p.training_seasons) !== "[2021,2022,2023,2024]" || p.training_cutoff !== "through-2024"
      || !matched.has(p.game_id)) fail(`Prediction provenance or game selection differs: ${k}`);
    if (!game || game.season !== 2025 || p.week !== game.week || date(p.kickoff_time) !== date(game.kickoff_time)
      || p.home_team_id !== game.home_team_id || p.away_team_id !== game.away_team_id
      || p.actual_home_score !== game.final_home_score || p.actual_away_score !== game.final_away_score)
      fail(`Historical game identity, kickoff, or score differs: ${k}`);
    if (!Number.isFinite(p.predicted_value) || !Number.isFinite(p.actual_value)
      || !Number.isFinite(p.actual_margin) || !Number.isFinite(p.actual_total) || !Number.isFinite(p.actual_home_win)
      || !Number.isFinite(date(p.kickoff_time)) || !(date(p.home_feature_source_cutoff) < date(p.prediction_cutoff))
      || !(date(p.away_feature_source_cutoff) < date(p.prediction_cutoff))
      || !(date(p.prediction_cutoff) < date(p.kickoff_time))) fail(`Invalid value or pregame chronology: ${k}`);
    if (p.actual_margin !== p.actual_home_score - p.actual_away_score
      || p.actual_total !== p.actual_home_score + p.actual_away_score
      || p.actual_home_win !== Number(p.actual_margin > 0)
      || p.actual_value !== (p.family === "spread" ? p.actual_margin : p.family === "totals" ? p.actual_total : p.actual_home_win))
      fail(`Prediction outcome differs from final scores: ${k}`);
    if (p.family === "totals" && p.low_sample) fail(`Low-sample totals prediction: ${k}`);
    if (p.market_sportsbook !== null || p.market_name !== null || p.market_selection !== null
      || p.market_side !== null || p.market_point !== null || p.market_price !== null
      || p.market_observed_at !== null || p.market_evidence !== null || p.closing_market_evidence !== null)
      fail(`Market evidence improperly embedded in baseline prediction: ${k}`);
    if (p.family === "spread" && p.projected_margin !== p.predicted_value
      || p.family === "totals" && p.projected_total !== p.predicted_value
      || p.family === "moneyline" && (p.projected_home_win_probability !== p.predicted_value
        || !close(p.projected_away_win_probability, 1 - p.predicted_value)))
      fail(`Family-specific projection differs from prediction: ${k}`);
  }
  const retainedModels = new Map<string, Row>((retained.models ?? []).map((item: Row) => [item.family, item]));
  for (const family of FAMILIES) {
    const model = byFamily.get(family) ?? {};
    const reference = retainedModels.get(family) ?? {};
    const familyRows = predictions.filter(p => p.family === family);
    const checksum = model.model_artifact ? artifactChecksum(model.model_artifact) : "";
    if (model.model_version !== reference.modelVersion || model.algorithm !== CONFIG[family][0]
      || model.sample_policy !== CONFIG[family][1] || model.feature_version !== "pregame-v3"
      || canonical(model.training_seasons) !== "[2021,2022,2023,2024]" || model.test_season !== 2025
      || model.model_artifact?.metadata?.artifactChecksum !== checksum || checksum !== reference.artifactChecksum
      || model.model_artifact?.metadata?.family !== family
      || model.model_artifact?.metadata?.algorithm !== CONFIG[family][0]
      || model.model_artifact?.metadata?.samplePolicy !== CONFIG[family][1]
      || model.model_artifact?.metadata?.featureVersion !== "pregame-v3"
      || model.model_artifact?.metadata?.trainingCutoff !== "through-2024"
      || canonical(model.model_artifact?.metadata?.trainingSeasons) !== "[2021,2022,2023,2024]"
      || canonical(model.model_artifact?.metadata?.hyperparameters) !== canonical(HYPERPARAMETERS[family])
      || model.model_artifact?.metadata?.vectorSchemaFingerprint !== model.vector_schema_fingerprint
      || canonical(model.model_artifact?.metadata?.vectorFeatureNames) !== canonical(model.vector_feature_names)
      || !Array.isArray(model.vector_feature_names) || model.vector_feature_names.some((name: string) =>
        /(market|odds|sportsbook|closing|sleeper|personnel|depth|injury|trade|starter)/i.test(name)))
      fail(`${family} model identity/configuration/artifact checksum differs`);
    if (familyRows.length !== reference.sampleSize || model.sample_size !== reference.sampleSize) fail(`${family} sample size differs`);
    const actual = familyRows.map(p => p.actual_value);
    const pred = familyRows.map(p => p.predicted_value);
    const n = actual.length;
    const mean = (values: number[]) => n ? values.reduce((a, b) => a + b, 0) / n : NaN;
    const calculated = family === "moneyline" ? {
      sampleSize: n,
      accuracy: mean(actual.map((v, i) => Number(Number(pred[i] >= 0.5) === v))),
      brierScore: mean(actual.map((v, i) => (pred[i] - v) ** 2)),
      logLoss: -mean(actual.map((v, i) => v * Math.log(Math.max(.001, Math.min(.999, pred[i]))) + (1 - v) * Math.log(Math.max(.001, Math.min(.999, 1 - pred[i]))))),
    } : {
      sampleSize: n,
      mae: mean(actual.map((v, i) => Math.abs(pred[i] - v))),
      rmse: Math.sqrt(mean(actual.map((v, i) => (pred[i] - v) ** 2))),
    };
    for (const [metric, expected] of Object.entries(reference.metrics ?? {})) {
      if (!close(calculated[metric as keyof typeof calculated], expected)
        || !close(model.metrics?.[metric], expected)) fail(`${family} ${metric} differs: recalculated ${calculated[metric as keyof typeof calculated]}, stored ${model.metrics?.[metric]}, retained ${expected}`);
    }
    const selected = new Map(quotes.filter(q => q.matched_game_id && q.family === family)
      .map(q => [`${q.matched_game_id}:${q.side}`, q]));
    const marketComparable = familyRows.flatMap(p => {
      if (family === "spread" || family === "totals") {
        const quote = selected.get(`${p.game_id}:${family === "spread" ? "home" : "over"}`);
        if (quote?.point == null) return [];
        return [{ actual: p.actual_value, predicted: family === "spread" ? -quote.point : quote.point }];
      }
      const home = selected.get(`${p.game_id}:home`), away = selected.get(`${p.game_id}:away`);
      const profit = (price: number) => price > 0 ? price / 100 : price < 0 ? 100 / -price : NaN;
      const h = profit(home?.price), a = profit(away?.price);
      if (!Number.isFinite(h) || !Number.isFinite(a)) return [];
      const rawHome = 1 / (1 + h), rawAway = 1 / (1 + a);
      return [{ actual: p.actual_value, predicted: rawHome / (rawHome + rawAway) }];
    });
    const marketN = marketComparable.length;
    const marketMean = (values: number[]) => marketN ? values.reduce((a, b) => a + b, 0) / marketN : NaN;
    const marketMetrics: Row = family === "moneyline" ? {
      sampleSize: marketN,
      accuracy: marketMean(marketComparable.map(x => Number(Number(x.predicted >= .5) === x.actual))),
      brierScore: marketMean(marketComparable.map(x => (x.predicted - x.actual) ** 2)),
      logLoss: -marketMean(marketComparable.map(x => x.actual * Math.log(Math.max(.001, Math.min(.999, x.predicted)))
        + (1 - x.actual) * Math.log(Math.max(.001, Math.min(.999, 1 - x.predicted))))),
    } : {
      sampleSize: marketN,
      mae: marketMean(marketComparable.map(x => Math.abs(x.predicted - x.actual))),
      rmse: Math.sqrt(marketMean(marketComparable.map(x => (x.predicted - x.actual) ** 2))),
    };
    if (!reference.market?.recordedMarketAccuracy) fail(`${family} retained market aggregate unavailable`);
    else for (const [metric, expected] of Object.entries(reference.market.recordedMarketAccuracy)) {
      if (metric === "status") continue;
      if (!close(marketMetrics[metric], expected)) fail(`${family} recorded market ${metric} differs: ${marketMetrics[metric]} vs ${expected}`);
    }
    if (family === "spread" || family === "moneyline") {
      if (new Set(familyRows.map(p => p.game_id)).size !== matched.size) fail(`${family} does not cover all matched games`);
    }
  }
  return { status: mismatches.length || warnings.length ? "blocked" : "verified", mismatches, warnings, counts };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args[args.indexOf(name) + 1];
  if (!args.includes("--archive") || !flag("--archive") || args.some(a => a.startsWith("--") && !["--archive", "--csv", "--datasets", "--readme"].includes(a))) {
    throw new Error("Usage: tsx scripts/src/market-baseline-archive-check.ts --archive export.json [--csv games.csv --datasets DATASETS.md --readme README.md]");
  }
  const exportJson = JSON.parse(await readFile(flag("--archive"), "utf8"));
  const reportBytes = await readFile(new URL("../../reports/gridline-2025-market-baseline.json", import.meta.url));
  if (createHash("sha256").update(reportBytes).digest("hex") !== "12086a29b7e2ba53e59f2b51718c0bd50e16ffba6ab6d057cf1eae9148dce753")
    throw new Error("The retained report checksum changed; stop and review");
  const report = JSON.parse(reportBytes.toString());
  let sourceQuotes: HistoricalMarketQuote[] | undefined;
  if (["--csv", "--datasets", "--readme"].every(a => args.includes(a) && flag(a))) {
    const [csv, datasetsDocumentation, provenanceDocumentation] = await Promise.all([
      readFile(flag("--csv"), "utf8"), readFile(flag("--datasets"), "utf8"), readFile(flag("--readme"), "utf8"),
    ]);
    sourceQuotes = qualifiedQuotes(csv, datasetsDocumentation, provenanceDocumentation);
  }
  const result = validateMarketBaselineArchive(exportJson, report, sourceQuotes);
  if (!sourceQuotes) result.warnings.push("Provide all three --csv/--datasets/--readme files to validate original source bytes and quote values");
  result.status = result.mismatches.length || result.warnings.length ? "blocked" : "verified";
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "verified") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}