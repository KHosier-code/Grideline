import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSparseGameDetail } from './performance-sparse-evidence.mjs';

const sparse = () => ({
  prediction: null,
  matchupBoard: { status: 'partial', assessments: [] },
  movement: { available: false, streams: [] },
});

test('requires complete detail evidence and no saved projection', () => {
  assert.equal(isSparseGameDetail(sparse()), true);
  assert.equal(isSparseGameDetail(null), false);
  assert.equal(isSparseGameDetail({ ...sparse(), movement: null }), false);
  assert.equal(isSparseGameDetail({ ...sparse(), matchupBoard: { status: 'partial' } }), false);
  assert.equal(isSparseGameDetail({ ...sparse(), prediction: { score: 20 } }), false);
});

test('a supported category metric makes the game non-sparse', () => {
  const detail = sparse();
  detail.matchupBoard.assessments = [{
    category: 'passing', edge: 'home', confidence: 'medium',
    metrics: [{ label: 'Blended pass EPA / dropback', homeValue: 0.1, awayValue: 0 }],
  }];
  assert.equal(isSparseGameDetail(detail), false);
  detail.matchupBoard.status = 'unavailable';
  // Game Detail renders the plot from assessments even if board status disagrees.
  assert.equal(isSparseGameDetail(detail), false);
  detail.matchupBoard.status = 'partial';
  detail.matchupBoard.assessments[0].metrics[0].awayValue = null;
  assert.equal(isSparseGameDetail(detail), true);
  detail.matchupBoard.assessments[0].metrics[0].awayValue = 0;
  detail.matchupBoard.assessments[0].confidence = 'unavailable';
  assert.equal(isSparseGameDetail(detail), true);
});

test('only observed movement, not a summary quote, loads the plot', () => {
  const detail = sparse();
  detail.movement = { available: true, streams: [{ firstObserved: { price: -110 }, observations: [] }] };
  assert.equal(isSparseGameDetail(detail), true);
  detail.movement.streams[0].observations.push({ price: -110 });
  assert.equal(isSparseGameDetail(detail), false);
});