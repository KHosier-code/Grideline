import { createClerkClient } from '@clerk/backend';
import { chromium } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const grantPath = '/tmp/gridline-theme-admin-grant.json';
const configPath = 'artifacts/nfl-analytics/playwright.config.ts';
const baseURL = process.env.GRIDLINE_TEST_BASE_URL ?? 'http://localhost:80';
const adminOnly = process.argv.includes('--admin-only');
const key = process.env.CLERK_SECRET_KEY;
const publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
let phase = 'checking prerequisites';
let failureCode = '';
let activeChild;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    activeChild?.kill(signal);
  });
}

function runPlaywright(adminState) {
  if (interrupted) return Promise.resolve(false);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [
      requirePlaywrightCli(),
      'test', '--config', configPath,
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        GRIDLINE_THEME_ADMIN: adminState ? '1' : '0',
        GRIDLINE_ADMIN_STORAGE_STATE: adminState ?? '',
      },
    });
    activeChild = child;
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      activeChild = undefined;
      resolveRun(code === 0 && !signal && !interrupted);
    });
  });
}

function requirePlaywrightCli() {
  return resolve('node_modules/@playwright/test/cli.js');
}

async function main() {
  phase = 'public theme checks';
  if (!adminOnly && !(await runPlaywright())) throw new Error('Public theme checks failed.');
  if (interrupted) throw new Error('Theme check interrupted.');
  phase = 'development keys and preview';
  // A release check must fail closed rather than silently omit Admin coverage.
  if (!key?.startsWith('sk_test_') || !publishableKey?.startsWith('pk_test_')) {
    throw new Error('Admin check requires development Clerk keys; live keys are not permitted.');
  }
  const url = new URL(baseURL);
  if (url.hostname !== 'localhost' || url.protocol !== 'http:' || (url.port && url.port !== '80') || url.pathname !== '/') {
    throw new Error('Admin check must run against the local development preview on port 80.');
  }

  const clerk = createClerkClient({ secretKey: key, publishableKey });
  const tempDir = await mkdtemp(join(tmpdir(), 'gridline-theme-'));
  const statePath = join(tempDir, 'clerk-state.json');
  let userId;
  let browser;
  try {
    phase = 'checking local grant';
    const oldGrant = await readFile(grantPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (oldGrant) {
      const grant = JSON.parse(oldGrant);
      if (typeof grant.expiresAt !== 'number' || grant.expiresAt > Date.now()) {
        throw new Error('Another Admin browser check is active; refusing to replace its grant.');
      }
      await rm(grantPath);
    }

    // Random credentials and no standing privilege; the identity is deleted in finally.
    phase = 'creating development user';
    const user = await clerk.users.createUser({
      // This development tenant accepts example.com with a password; example.invalid is rejected.
      emailAddress: [`gridline-release-${randomUUID()}@example.com`],
      password: randomBytes(32).toString('base64url'),
    }).catch(error => {
      const codes = Array.isArray(error.errors) ? error.errors.map(item => item.code).filter(code => /^[a-z_]+$/.test(code)) : [];
      failureCode = ` (HTTP ${Number(error.status) || 'unknown'}; codes: ${codes.join(',') || 'none'})`;
      throw new Error('Clerk development user creation failed.');
    });
    userId = user.id;
    if (interrupted) throw new Error('Theme check interrupted.');
    await writeFile(grantPath, JSON.stringify({
      userId, expiresAt: Date.now() + 10 * 60_000,
    }), { flag: 'wx', mode: 0o600 });

    phase = 'opening development preview';
    browser = await chromium.launch(existsSync('/repl/tools/bin/chromium')
      ? { executablePath: '/repl/tools/bin/chromium', args: ['--no-sandbox'] }
      : undefined);
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.Clerk?.client?.signIn && window.Clerk?.setActive));
    phase = 'signing in development user';
    const ticket = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 90 });
    if (interrupted) throw new Error('Theme check interrupted.');
    try {
      await page.evaluate(async (value) => {
        const signIn = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: value });
        if (!signIn.createdSessionId) throw new Error('Clerk did not create a session.');
        await window.Clerk.setActive({ session: signIn.createdSessionId });
      }, ticket.token);
    } catch {
      throw new Error('Development Clerk ticket sign-in failed (token may have expired).');
    }
    await page.waitForFunction(() => Boolean(window.Clerk?.session?.getToken));
    phase = 'checking Admin authorization';
    const status = await page.evaluate(async () => {
      const token = await window.Clerk.session.getToken();
      const response = await fetch('/api/auth/admin-status', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return response.ok ? (await response.json()).isAdmin === true : false;
    });
    if (!status) throw new Error('Development Clerk session is not authorized by the real Admin gate. Check that the API development workflow is running.');
    await context.storageState({ path: statePath });
    await browser.close();
    browser = undefined;
    if (interrupted) throw new Error('Theme check interrupted.');
    phase = 'Admin browser checks';
    if (!(await runPlaywright(statePath))) throw new Error('Admin theme checks failed or session expired.');
  } finally {
    await browser?.close();
    // Remove local session material even if the browser checks fail.
    await rm(tempDir, { recursive: true, force: true });
    if (userId) {
      const current = await readFile(grantPath, 'utf8').catch(() => null);
      if (current && JSON.parse(current).userId === userId) await rm(grantPath, { force: true });
      await clerk.users.deleteUser(userId);
    }
  }
}

main().catch(() => {
  // Clerk API errors may include authentication details. Never print the original exception.
  console.error(`Theme release check failed during ${phase}${failureCode}. Confirm the development Clerk keys and API/web workflows are available, and inspect the browser test result above.`);
  process.exitCode = 1;
});