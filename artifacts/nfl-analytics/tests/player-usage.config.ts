import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'player-usage.spec.ts',
  workers: 1,
  use: {
    baseURL: process.env.GRIDLINE_TEST_BASE_URL ?? 'http://localhost:80',
    browserName: 'chromium',
    launchOptions: existsSync('/repl/tools/bin/chromium')
      ? { executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] } : undefined,
  },
});