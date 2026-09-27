import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

test('both Home sessions use the same persisted pick, and signed-in Home keeps its schedule without operational feed status', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: ConsumerHome, ConsumerHomeContent } = await vite.ssrLoadModule('/src/pages/consumer/ConsumerHome.tsx');
    const { VisitorHomeContent } = await vite.ssrLoadModule('/src/pages/consumer/VisitorHomeContent.tsx');
    const { WeeklyPickArchiveContent } = await vite.ssrLoadModule('/src/pages/consumer/ConsumerWeeklyPicks.tsx');
    const apiClientPath = fileURLToPath(new URL('../../../../../lib/api-client-react/src/index.ts', import.meta.url));
    const { getGetConsumerDashboardQueryKey } = await vite.ssrLoadModule(`/@fs${apiClientPath}`);
    const client = new QueryClient();
    const source = { status: 'healthy', lastAttemptAt: null, lastAttemptStatus: null,
      lastSuccessAt: null, sourceTimestamp: null, staleAfterMinutes: 60, message: null };
    const dashboard = {
      status: 'unavailable', games: [], note: '',
      initialWeeklyPick: { pick: { gameId: 'first-line', teamName: 'Verified Team', season: 2026, week: 3, probability: 0.7, observedAt: '2026-09-25T12:00:00Z',
        firstLines: { sportsbook: 'DraftKings', quotes: [
          { market: 'moneyline', selection: 'HOM', point: null, price: -135 },
          { market: 'moneyline', selection: 'AWY', point: null, price: 115 },
          { market: 'spread', selection: 'HOM', point: -2.5, price: -110 },
          { market: 'spread', selection: 'AWY', point: 2.5, price: -110 },
        ] } }, reason: null },
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
    assert.doesNotMatch(html, /Persisted feed status|consumer-source-health/);
    assert.match(html, /No upcoming games are available/);
    assert.match(html, /<h2>Pick of the week<\/h2>/);
    assert.match(html, /data-testid="weekly-pick-team">Verified Team/);
    assert.match(html, /Winner locked from Gridline’s first verified lines for week 3/);
    assert.match(html, /See saved first-line quotes/);
    assert.match(html, /DraftKings.*not current odds or betting advice/);
    assert.match(html, /HOM<\/th><td>-135<\/td><td>-2.5 \(-110\)/);
    assert.match(html, /AWY<\/th><td>\+115<\/td><td>\+2.5 \(-110\)/);
    assert.match(visitor(dashboard), /<h1>Pick of the week<\/h1>/);
    assert.match(visitor({ initialWeeklyPick: { pick: {
      ...dashboard.initialWeeklyPick.pick,
      firstLines: { ...dashboard.initialWeeklyPick.pick.firstLines, sportsbook: 'FanDuel' },
    }, reason: null } }), /First observed.*FanDuel/);
    assert.match(visitor(dashboard), /href="\/weekly-picks"/);
    assert.match(html, /href="\/weekly-picks"/);
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
    assert.doesNotMatch(visitor(noPick), /saved first-line quotes/);
    assert.doesNotMatch(visitor({ initialWeeklyPick: { pick: {
      ...dashboard.initialWeeklyPick.pick, firstLines: undefined }, reason: null } }), /saved first-line quotes/);

    const loading = signedIn(undefined, 'loading');
    assert.match(loading, /Loading this week’s pick/);
    assert.match(loading, /Loading the weekly games/);
    assert.doesNotMatch(loading, /weekly-pick-team|No upcoming games are available/);
    assert.match(visitor(undefined, 'loading'), /Loading this week’s pick/);
    assert.doesNotMatch(visitor(dashboard, 'loading'), /saved first-line quotes/);
    const error = signedIn(dashboard, 'error');
    assert.match(error, /Pick unavailable right now/);
    assert.match(error, /Weekly view unavailable/);
    assert.doesNotMatch(error, /weekly-pick-team|Verified Team|No upcoming games are available/);
    assert.match(visitor(dashboard, 'error'), /Pick unavailable right now/);
    assert.doesNotMatch(visitor(dashboard, 'error'), /saved first-line quotes/);
    const archive = (data, state = 'ready') => render(createElement(WeeklyPickArchiveContent,
      { archive: data, state, onSeasonChange: () => {} }));
    const history = archive({ seasons: [2026, 2025], season: 2025, weeks: [
      { season: 2025, week: 2, pick: { gameId: 'saved', teamName: 'Historic Winner', season: 2025, week: 2, probability: .7, observedAt: '2025-09-01T00:00:00Z' }, reason: null },
      { season: 2025, week: 1, pick: null, reason: 'No persisted official weekly selection is available for this week.' },
    ] });
    assert.match(history, /2025 · Week 2/);
    assert.match(history, /Historic Winner/);
    assert.match(history, /2025 · Week 1/);
    assert.match(history, /No persisted official weekly selection/);
    const retrospectiveHistory = archive({ seasons: [2026], season: 2026, weeks: [
      { season: 2026, week: 1, pick: null, reason: 'No persisted official weekly selection is available for this week.',
        retrospective: { status: 'unavailable', label: 'retrospective algorithm review',
          reason: 'Inputs could not be verified', choice: null } },
      { season: 2026, week: 2, pick: { gameId: 'official', teamName: 'Official Team', season: 2026, week: 2, probability: .8, observedAt: '2026-09-01T00:00:00Z' }, reason: null,
        retrospective: { status: 'reviewed', label: 'retrospective algorithm review', reason: null,
          choice: { gameId: 'reviewed', teamName: 'Review Team', matchup: 'AWY at HME',
            probability: .7, cutoffAt: '2026-09-01T00:00:00Z', evidenceId: 'digest',
            reviewedAt: '2026-09-30T00:00:00Z', publishedAt: null } } },
    ] });
    assert.match(retrospectiveHistory, /Inputs could not be verified/);
    assert.match(retrospectiveHistory, /Review Team/);
    assert.match(retrospectiveHistory, /Official Team/);
    assert.match(retrospectiveHistory, /retrospective algorithm review/);
    assert.doesNotMatch(history, /Saved projection|saved-outlook/);
    assert.match(archive({ seasons: [], season: null, weeks: [] }), /No past weeks available/);
    assert.doesNotMatch(archive(undefined, 'loading'), /Historic Winner/);
    assert.match(archive(undefined, 'error'), /Pick history unavailable/);
  } finally {
    await vite.close();
  }
});