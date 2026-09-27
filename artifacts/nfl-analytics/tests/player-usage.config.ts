import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:5198';

export default defineConfig({
  testDir: '.',
  testMatch: 'player-usage.spec.ts',
  // Routine validations run concurrently; theme checks clean their own results directory.
  outputDir: fileURLToPath(new URL('../test-results-usage/', import.meta.url)),
  workers: 1,
  webServer: {
    command: 'PORT=5198 BASE_PATH=/ NODE_ENV=test pnpm exec vite --config vite.config.ts --host 127.0.0.1',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${origin}/tests/player-usage.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: origin,
    browserName: 'chromium',
    launchOptions: existsSync('/repl/tools/bin/chromium')
      ? { executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] } : undefined,
  },
});