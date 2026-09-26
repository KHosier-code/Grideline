import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  const revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: artifactDir,
    encoding: "utf8",
  }).trim();
  const buildId = `${revision}-${new Date().toISOString()}`;
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/worker.ts"),
      path.resolve(artifactDir, "src/rehearsal-cli.ts"),
      path.resolve(artifactDir, "src/production.ts"),
      path.resolve(artifactDir, "src/player-stats-dev-cli.ts"),
      path.resolve(artifactDir, "src/player-forecast-readiness-dev-cli.ts"),
      path.resolve(artifactDir, "src/espn-roster-dev-cli.ts"),
      path.resolve(artifactDir, "src/market-baseline-cli.ts"),
      path.resolve(artifactDir, "src/personnel-comparison-cli.ts"),
      path.resolve(artifactDir, "src/sportsdataio-depth-cli.ts"),
      path.resolve(artifactDir, "src/red-zone-opportunities-dev-cli.ts"),
      path.resolve(artifactDir, "src/red-zone-week2-refresh-dev-cli.ts"),
      path.resolve(artifactDir, "src/lib/sleeper.test.ts"),
      path.resolve(artifactDir, "src/lib/player-upcoming.test.ts"),
      path.resolve(artifactDir, "src/lib/sleeper-identity-mapping.test.ts"),
      path.resolve(artifactDir, "src/lib/sportsdataio-depth.test.ts"),
      path.resolve(artifactDir, "src/lib/current-personnel-derivation.test.ts"),
      path.resolve(artifactDir, "src/lib/personnel-context-derivation.test.ts"),
      path.resolve(artifactDir, "src/lib/current-personnel.test.ts"),
      path.resolve(artifactDir, "src/lib/market-baseline.test.ts"),
      path.resolve(artifactDir, "src/lib/market-baseline-persistence.test.ts"),
      path.resolve(artifactDir, "src/lib/confidence-framework.test.ts"),
      path.resolve(artifactDir, "src/lib/confidence-persistence.test.ts"),
      path.resolve(artifactDir, "src/lib/game-state.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-source-health.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-market-freshness.test.ts"),
      path.resolve(artifactDir, "src/lib/feed-schedule.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-player-eligibility.test.ts"),
      path.resolve(artifactDir, "src/lib/player-forecast-readiness.test.ts"),
      path.resolve(artifactDir, "src/lib/availability-roster.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-recommendation.test.ts"),
      path.resolve(artifactDir, "src/lib/prediction-validation.test.ts"),
      path.resolve(artifactDir, "src/lib/odds.fixtures.test.ts"),
      path.resolve(artifactDir, "src/lib/canonical-evaluation.test.ts"),
      path.resolve(artifactDir, "src/lib/scheduler.test.ts"),
      path.resolve(artifactDir, "src/lib/nflverse-player-stats.test.ts"),
      path.resolve(artifactDir, "src/lib/red-zone-opportunities.test.ts"),
      path.resolve(artifactDir, "src/lib/defense-vs-position.test.ts"),
      path.resolve(artifactDir, "src/lib/nflverse-week2-refresh.test.ts"),
      path.resolve(artifactDir, "src/lib/usage-analytics-retention.test.ts"),
      path.resolve(artifactDir, "src/routes/authorization.test.ts"),
      path.resolve(artifactDir, "src/routes/dashboard.test.ts"),
      path.resolve(artifactDir, "src/routes/consumer.test.ts"),
      path.resolve(artifactDir, "src/routes/consumer-red-zone.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-matchups.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-team-analytics.test.ts"),
      path.resolve(artifactDir, "src/lib/consumer-graded-charts.test.ts"),
      path.resolve(artifactDir, "src/lib/personnel-comparison.test.ts"),
      path.resolve(artifactDir, "src/lib/personnel-comparison-performance.test.ts"),
      path.resolve(artifactDir, "src/lib/production-database-smoke.test.ts"),
      path.resolve(artifactDir, "src/lib/production-schema-order.dev.test.ts"),
      path.resolve(artifactDir, "src/lib/production-startup-alert.test.ts"),
      path.resolve(artifactDir, "src/lib/worker-ownership.test.ts"),
      path.resolve(artifactDir, "src/lib/worker-rehearsal.test.ts"),
      path.resolve(artifactDir, "src/lib/player-feed-recovery.test.ts"),
      path.resolve(artifactDir, "src/lib/player-recovery-receipts.test.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    define: {
      __GRIDLINE_BUILD_ID__: JSON.stringify(buildId),
    },
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
