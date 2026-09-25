import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  PREMIUM_GAME_DETAIL_SECTION_ORDER,
  isMatchupSupported,
  formatUsageMetric,
  usagePeriodLabel,
  USAGE_METRIC_LABELS,
  eligibleMarketComparisons,
  supportedAssessments,
  preKickoffMovementLabel,
} from './consumer-presentation.ts';

describe('consumer-presentation', () => {
  test('only fresh, complete and eligible comparisons are displayed as usable', () => {
    const game = {
      recommendation: { markets: { spread: false, total: true, moneyline: false } },
      marketBoard: { comparisons: [
        { market: 'spread', state: 'available', modelValue: 1, marketValue: 1 },
        { market: 'total', state: 'available', modelValue: 44, marketValue: 43 },
        { market: 'moneyline', state: 'stale', modelValue: 0.5, marketValue: 0.4 },
      ] },
    } as any;
    assert.deepStrictEqual(eligibleMarketComparisons(game, true).map((c) => c.market), ['total']);
    assert.deepStrictEqual(eligibleMarketComparisons(game, false), []);
    game.recommendation.markets.total = false;
    assert.deepStrictEqual(eligibleMarketComparisons(game, true), []);
    game.recommendation.markets.total = true;
    game.marketBoard.comparisons[1].modelValue = null;
    assert.deepStrictEqual(eligibleMarketComparisons(game, true), []);
  });

  test('unsupported categories are omitted, and future games cannot show pre-kickoff finality', () => {
    assert.deepStrictEqual(supportedAssessments([{ edge: 'insufficient' }, { edge: 'home' }] as any).map((a) => a.edge), ['home']);
    assert.equal(preKickoffMovementLabel(true), null);
    assert.equal(preKickoffMovementLabel(false), 'Last recorded pre-kickoff');
  });
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
    assert.strictEqual(USAGE_METRIC_LABELS.passingYards, 'Pass yards');
    assert.strictEqual(USAGE_METRIC_LABELS.receivingTds, 'Rec TD');
    assert.strictEqual(formatUsageMetric('receivingTds', 0), '0');
    assert.strictEqual(formatUsageMetric('receivingTds', null), null);
  });

  test('usage period explicitly excludes the current matchup and other seasons', () => {
    assert.strictEqual(usagePeriodLabel(2026, 3), '2026 season · up to 5 completed team games before Week 3');
    assert.strictEqual(usagePeriodLabel(2026, 1), '2026 season · up to 5 completed team games before Week 1');
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
