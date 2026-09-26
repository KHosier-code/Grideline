import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMatchupMetric, matchupEdgeSide, supportedMatchupSummary } from './consumer-matchups.ts';

test('consumer matchup transformations preserve neutral and unavailable states', () => {
  assert.equal(formatMatchupMetric({ label: 'Rate', homeValue: null, awayValue: 0.123, unit: 'rate', higherIsBetter: true }, 'home'), 'Unavailable');
  assert.equal(formatMatchupMetric({ label: 'Rate', homeValue: null, awayValue: 0.123, unit: 'rate', higherIsBetter: true }, 'away'), '12.3%');
  assert.equal(matchupEdgeSide({ edge: 'insufficient' } as never), null);
  assert.equal(matchupEdgeSide({ edge: 'neutral' } as never), null);
});

test('consumer summary cannot surface unsupported assessments', () => {
  const summary = supportedMatchupSummary({
    summary: [
      { category: 'passing', title: 'Passing', edge: 'home', label: 'HME', evidence: 'EPA', caveat: 'Descriptive only' },
    ],
    assessments: [{ category: 'passing', edge: 'home', confidence: 'high', metrics: [{ homeValue: 1, awayValue: 2 }] }],
  } as never);
  assert.equal(summary.length, 1);
  assert.equal(summary[0]?.label, 'HME');
});

test('insights require matching supported two-team evidence and stop at three', () => {
  const items = ['passing', 'rushing', 'pace', 'red_zone', 'coverage', 'unsupported'].map(category =>
    ({ category, edge: 'home', label: category, title: category, evidence: 'Observed', caveat: 'Partial sample' }));
  const assessments = items.map(item => ({ category: item.category, edge: 'home', confidence: 'medium',
    metrics: [{ homeValue: 1, awayValue: 2 }] }));
  assert.deepEqual(supportedMatchupSummary({ summary: items, assessments } as never).map(item => item.category),
    ['passing', 'rushing', 'pace']);
  assessments[0].metrics[0].homeValue = null as never;
  assessments[1].edge = 'insufficient';
  assessments[2].confidence = 'unavailable';
  assert.deepEqual(supportedMatchupSummary({ summary: items, assessments } as never).map(item => item.category),
    ['red_zone', 'coverage', 'unsupported']);
  assert.deepEqual(supportedMatchupSummary({ summary: items.slice(0, 3), assessments } as never), []);
});