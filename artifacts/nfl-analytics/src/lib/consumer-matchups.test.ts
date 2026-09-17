import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMatchupMetric, matchupEdgeSide, supportedMatchupSummary } from './consumer-matchups';

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
  } as never);
  assert.equal(summary.length, 1);
  assert.equal(summary[0]?.label, 'HME');
});