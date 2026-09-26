// Keep the shipped app build untouched; attach a separately optimized test
// entry to the local preview directory only after both builds succeed.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/public');
const fixture = resolve(root, 'dist/performance-fixture');
function build(env) {
  const result = spawnSync('pnpm', ['run', 'build'], { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Production build failed (${result.status})`);
}

build({ PERF_HOME_FIXTURE: '0' });
try {
  build({ PERF_HOME_FIXTURE: '1' });
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
  await copyFile(resolve(fixture, 'tests/performance-home.html'), resolve(output, 'tests/performance-home.html'));
} finally {
  await rm(fixture, { recursive: true, force: true });
}