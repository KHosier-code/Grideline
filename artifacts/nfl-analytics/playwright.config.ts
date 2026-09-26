import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const admin = process.env.GRIDLINE_THEME_ADMIN === '1';
if (admin && !process.env.GRIDLINE_ADMIN_STORAGE_STATE) {
  throw new Error('Admin browser check requires a fresh provisioned development Clerk session. Run pnpm test:theme instead.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: admin ? '**/*.admin.spec.ts' : ['**/*.public.spec.ts', '**/defense-vs-position.spec.ts'],
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: process.env.GRIDLINE_TEST_BASE_URL ?? 'http://localhost:80',
    browserName: 'chromium',
    launchOptions: existsSync('/repl/tools/bin/chromium')
      ? { executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] }
      : undefined,
    // Traces can include authentication cookies and tokens.
    trace: admin ? 'off' : 'retain-on-failure',
  },
  reporter: 'list',
});