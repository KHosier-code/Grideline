import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  PREMIUM_GAME_DETAIL_SECTION_ORDER,
  isMatchupSupported,
  formatUsageMetric,
} from './consumer-presentation.ts';

describe('consumer-presentation', () => {
  test('isMatchupSupported requires basis and confidence', () => {
    assert.strictEqual(isMatchupSupported({ receiverName: 'A', defenderName: 'B', summary: 'C' }), false);
    assert.strictEqual(isMatchupSupported({ receiverName: 'A', defenderName: 'B', summary: 'C', basis: 'verified', confidence: 'high' } as any), true);
    assert.strictEqual(isMatchupSupported({ receiverName: 'A', defenderName: 'B', summary: 'C', basis: 'inferred', confidence: 'low' } as any), true);
    assert.strictEqual(isMatchupSupported({ receiverName: 'A', defenderName: 'B', summary: 'C', basis: 'modeled', confidence: 'high' } as any), false);
    assert.strictEqual(isMatchupSupported({ receiverName: 'A', defenderName: 'B', summary: 'C', basis: 'verified', confidence: 'unavailable' } as any), false);
  });

  test('formatUsageMetric formats percentages', () => {
    assert.strictEqual(formatUsageMetric('snapShare', 0.852), '85.2%');
    assert.strictEqual(formatUsageMetric('carries', 15), '15');
    assert.strictEqual(formatUsageMetric('yardsPerCarry', 4.25), '4.3');
    assert.strictEqual(formatUsageMetric('missing', null), null);
  });

  test('premium detail sections stay in the consumer hierarchy', () => {
    assert.deepStrictEqual(PREMIUM_GAME_DETAIL_SECTION_ORDER, [
      'game-header',
      'gridline-projection',
      'market-comparison',
      'matchup-board',
      'personnel',
      'player-usage',
      'player-matchups',
      'line-movement',
      'projection-explanation',
    ]);
  });
});
