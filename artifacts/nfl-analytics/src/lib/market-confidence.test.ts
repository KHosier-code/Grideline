import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketConfidenceSummary } from '../components/MarketConfidence.tsx';

const confidence = {
  markets: [{
    market: 'moneyline', score: 70, label: 'Strong', explanation: 'Strong confidence.',
    calculatedAt: '2020-01-01T00:00:00.000Z',
    components: [{ key: 'marketEdge', label: 'Market Edge Strength', score: 80, summary: 'Difference, freshness and consensus' }],
    evidence: { marketFresh: true, bookCount: 2, booksAgree: true },
    downgradeReasons: [],
  }],
};

test('market confidence calls a saved score evidence quality, not win probability or a proven edge', () => {
  const html = renderToStaticMarkup(createElement(MarketConfidenceSummary, { value: { confidence } }));
  assert.match(html, /Evidence quality by market/);
  assert.match(html, /70\/100 <span>evidence score<\/span>/);
  assert.match(html, /not a team’s chance of winning or a proven betting edge/);
  assert.match(html, /Win probability comes separately from the moneyline model/);
  assert.match(html, /Market difference evidence/);
  assert.doesNotMatch(html, /Market Edge Strength/);
  assert.match(html, /Fresh then \(not necessarily now\)/);
});

test('both full and compact disclosures expose old or missing calculation time on the closed card', () => {
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(createElement(MarketConfidenceSummary, { value: { confidence }, compact }));
    assert.match(html, /dateTime="2020-01-01T00:00:00.000Z"/);
    assert.match(html, /Older calculation; quotes may have changed/);
    assert.ok(html.indexOf('Older calculation') < html.indexOf('</summary>'));
    const missing = renderToStaticMarkup(createElement(MarketConfidenceSummary, {
      value: { confidence: { markets: [{ ...confidence.markets[0], calculatedAt: undefined }] } }, compact,
    }));
    assert.match(missing, /Calculation time unavailable/);
  }
});