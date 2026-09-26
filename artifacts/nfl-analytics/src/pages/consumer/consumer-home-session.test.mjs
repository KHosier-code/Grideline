import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('both Home sessions use the same persisted pick, and signed-in Home keeps its schedule and feed', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: ConsumerHome, ConsumerHomeContent } = await vite.ssrLoadModule('/src/pages/consumer/ConsumerHome.tsx');
    const { VisitorHomeContent } = await vite.ssrLoadModule('/src/pages/consumer/VisitorHomeContent.tsx');
    const apiClientPath = fileURLToPath(new URL('../../../../../lib/api-client-react/src/index.ts', import.meta.url));
    const { getGetConsumerDashboardQueryKey } = await vite.ssrLoadModule(`/@fs${apiClientPath}`);
    const client = new QueryClient();
    const source = { status: 'healthy', lastAttemptAt: null, lastAttemptStatus: null,
      lastSuccessAt: null, sourceTimestamp: null, staleAfterMinutes: 60, message: null };
    const dashboard = {
      status: 'unavailable', games: [], note: '',
      initialWeeklyPick: { pick: { gameId: 'first-line', teamName: 'Verified Team', season: 2026, week: 3, probability: 0.7, observedAt: '2026-09-25T12:00:00Z' }, reason: null },
      sourceHealth: { status: 'healthy', sources: {
        schedule: source, odds: source, injuries: source, players: source,
      } },
    };
    const now = Date.parse('2026-09-25T12:00:00Z');
    const clean = (markup) => markup.replace(/ data-(?:replit-metadata|component-name)="[^"]*"/g, '');
    const render = (element) => clean(renderToStaticMarkup(createElement(Router, { ssrPath: '/' }, element)));
    const signedIn = (data, state = 'ready') => render(createElement(ConsumerHomeContent, { dashboard: data, state, now }));
    const visitor = (data, state = 'ready') => render(createElement(VisitorHomeContent, { initialWeeklyPick: data?.initialWeeklyPick, state, now }));
    client.setQueryData(getGetConsumerDashboardQueryKey(), dashboard);
    const html = clean(renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(Router, { ssrPath: '/' }, createElement(ConsumerHome)))));
    assert.match(html, /weekly-intro/);
    assert.match(html, /Upcoming schedule/);
    assert.match(html, /Persisted feed status/);
    assert.match(html, /consumer-source-health/);
    assert.match(html, /No upcoming games are available/);
    assert.match(html, /<h2>Pick of the week<\/h2>/);
    assert.match(html, /data-testid="weekly-pick-team">Verified Team/);
    assert.match(html, /Winner locked from Gridline’s first verified lines for week 3/);
    assert.match(visitor(dashboard), /<h1>Pick of the week<\/h1>/);
    assert.equal(html.match(/<section class="visitor-pick"[^>]*>.*?<\/section>/)?.[0]
      .replace('<h2>', '<h1>').replace('</h2>', '</h1>'),
      visitor(dashboard).match(/<section class="visitor-pick"[^>]*>.*?<\/section>/)?.[0]);

    const noPick = { ...dashboard, initialWeeklyPick: { pick: null, reason: 'Waiting for first verified lines.' },
      games: [{ gameId: 'saved-outlook', prediction: { homeWinProbability: 0.99, officialFinalPrediction: false }, kickoffTime: '2026-09-01T12:00:00Z' }] };
    const noPickHtml = signedIn(noPick);
    assert.match(noPickHtml, /Waiting for first verified lines/);
    assert.match(noPickHtml, /No upcoming games are available/);
    assert.doesNotMatch(noPickHtml, /weekly-pick-team|Winner locked/);
    assert.match(visitor(noPick), /Waiting for first verified lines/);

    const loading = signedIn(undefined, 'loading');
    assert.match(loading, /Loading this week’s pick/);
    assert.match(loading, /Loading the persisted schedule and feed status/);
    assert.doesNotMatch(loading, /weekly-pick-team|No upcoming games are available/);
    assert.match(visitor(undefined, 'loading'), /Loading this week’s pick/);
    const error = signedIn(dashboard, 'error');
    assert.match(error, /Pick unavailable right now/);
    assert.match(error, /Weekly view unavailable/);
    assert.doesNotMatch(error, /weekly-pick-team|Verified Team|No upcoming games are available/);
    assert.match(visitor(dashboard, 'error'), /Pick unavailable right now/);
  } finally {
    await vite.close();
  }
});