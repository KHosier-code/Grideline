import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('desktop and mobile account links reflect verified access and expose usable account actions', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { ConsumerAccountAction, ConsumerWorkspaceLink } =
      await vite.ssrLoadModule('/src/components/ConsumerAccountNavigation.tsx');
    const { consumerAccountState } = await vite.ssrLoadModule('/src/lib/consumer-account-state.ts');
    const render = (mobile, loaded, signedIn, check) => {
      const state = consumerAccountState(loaded, signedIn, check);
      return renderToStaticMarkup(createElement(Router, { ssrPath: '/' },
        createElement('nav', { 'aria-label': mobile ? 'Mobile navigation' : 'Primary navigation' },
          createElement(ConsumerWorkspaceLink, { verified: state.adminVerified }),
          createElement(ConsumerAccountAction, {
            state, mobile,
            accountControl: createElement('button', { 'aria-label': 'Open account menu' }),
          }),
        )));
    };
    for (const mobile of [false, true]) {
      const pending = { isSuccess: false, isFetching: true };
      const verified = { data: true, isSuccess: true, isFetching: false };
      const fan = { data: false, isSuccess: true, isFetching: false };
      const layout = mobile ? 'Mobile navigation' : 'Primary navigation';

      const loading = render(mobile, false, undefined, pending);
      assert.match(loading, new RegExp(`aria-label="${layout}"`));
      assert.doesNotMatch(loading, /Admin workspace|Manage account|Sign in|Open account menu/);

      const signedOut = render(mobile, true, false, verified);
      assert.match(signedOut, /href="\/sign-in"[^>]*>Sign in/);
      assert.doesNotMatch(signedOut, /Admin workspace|Manage account/);

      const signedInFan = render(mobile, true, true, fan);
      assert.match(signedInFan, mobile ? /<button[^>]*type="button">Manage account<\/button>/ : /aria-label="Open account menu"/);
      assert.doesNotMatch(signedInFan, /Admin workspace|href="\/admin"|Sign in/);

      const admin = render(mobile, true, true, verified);
      assert.match(admin, /href="\/admin"[^>]*>.*Admin workspace<\/a>/);
      assert.match(admin, mobile ? /Manage account/ : /Open account menu/);

      for (const failed of [
        { data: true, isSuccess: false, isFetching: false },
        { data: true, isSuccess: true, isFetching: true },
      ]) {
        assert.doesNotMatch(render(mobile, true, true, failed), /Admin workspace|href="\/admin"/);
      }
    }
  } finally {
    await vite.close();
  }
});