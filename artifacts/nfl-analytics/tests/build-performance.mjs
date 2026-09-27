// Keep the shipped app build untouched; attach a separately optimized test
// entry to the local preview directory only after both builds succeed.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/public');
const fixture = resolve(root, 'dist/performance-fixture');
const fixtureEntry = 'tests/performance-home.html';
const fixtureMarkers = [
  'data-performance-account-standin',
  'Fixture account control',
  'Fixture-only account control; no profile or session.',
];

async function emittedTextFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await emittedTextFiles(file));
    else if (/\.(?:html|[cm]?js|css|json|map)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function assertFixtureIsolation() {
  const files = await emittedTextFiles(output);
  if (files.some(file => relative(output, file) === fixtureEntry)) {
    throw new Error(`Ordinary build contains the test-only entry: ${fixtureEntry}`);
  }
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const marker = fixtureMarkers.find(value => content.includes(value));
    if (marker) throw new Error(`Ordinary build contains a fixture account stand-in (${marker}) in ${relative(output, file)}`);
  }
}

function build(env) {
  const result = spawnSync('pnpm', ['run', 'build'], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Production build failed (${result.status})`);
}

build({ PERF_HOME_FIXTURE: '0' });
await assertFixtureIsolation();
try {
  build({ PERF_HOME_FIXTURE: '1' });
  const fixtureFiles = await emittedTextFiles(fixture);
  const fixtureContent = (await Promise.all(fixtureFiles.map(file => readFile(file, 'utf8')))).join('\n');
  if (!fixtureFiles.some(file => relative(fixture, file) === fixtureEntry) ||
      !fixtureMarkers.every(marker => fixtureContent.includes(marker))) {
    throw new Error('Fixture build is missing its entry or account stand-in; isolation check cannot be trusted');
  }
  const fixtureAssets = resolve(fixture, 'assets');
  for (const name of await readdir(fixtureAssets)) {
    const from = resolve(fixtureAssets, name);
    const to = resolve(output, 'assets', name);
    // Hashed names shared by both builds must have identical bytes.
    const existing = await readFile(to).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      if (!existing.equals(await readFile(from))) throw new Error(`Asset hash collision: ${name}`);
    } else {
      await copyFile(from, to);
    }
  }
  await mkdir(resolve(output, 'tests'), { recursive: true });
  await copyFile(resolve(fixture, fixtureEntry), resolve(output, fixtureEntry));
} finally {
  await rm(fixture, { recursive: true, force: true });
}