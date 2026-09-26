import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('the signed-in Home still renders the weekly schedule and feed sections', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: ConsumerHome } = await vite.ssrLoadModule('/src/pages/consumer/ConsumerHome.tsx');
    const apiClientPath = fileURLToPath(new URL('../../../../../lib/api-client-react/src/index.ts', import.meta.url));
    const { getGetConsumerDashboardQueryKey } = await vite.ssrLoadModule(`/@fs${apiClientPath}`);
    const client = new QueryClient();
    const source = { status: 'healthy', lastAttemptAt: null, lastAttemptStatus: null,
      lastSuccessAt: null, sourceTimestamp: null, staleAfterMinutes: 60, message: null };
    client.setQueryData(getGetConsumerDashboardQueryKey(), {
      status: 'unavailable', games: [], note: '',
      sourceHealth: { status: 'healthy', sources: {
        schedule: source, odds: source, injuries: source, players: source,
      } },
    });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(Router, { ssrPath: '/' }, createElement(ConsumerHome))));
    assert.match(html, /weekly-intro/);
    assert.match(html, /Upcoming schedule/);
    assert.match(html, /Persisted feed status/);
    assert.match(html, /consumer-source-health/);
    assert.doesNotMatch(html, /Pick of the week/);
  } finally {
    await vite.close();
  }
});