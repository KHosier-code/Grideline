import assert from 'node:assert/strict';
import test from 'node:test';
import { groupBySlate, slateFor } from './slates.ts';

test('Sunday splits into early (London and 1:00 PM ET) and afternoon (4:05 PM ET and night)', () => {
  assert.equal(slateFor('2026-10-04T13:30:00Z').label, 'Sunday early');      // 9:30 AM ET London
  assert.equal(slateFor('2026-10-04T17:00:00Z').label, 'Sunday early');      // 1:00 PM ET
  assert.equal(slateFor('2026-10-04T20:05:00Z').label, 'Sunday afternoon');  // 4:05 PM ET
  assert.equal(slateFor('2026-10-04T20:25:00Z').label, 'Sunday afternoon');  // 4:25 PM ET
  assert.equal(slateFor('2026-10-05T00:20:00Z').label, 'Sunday afternoon');  // 8:20 PM ET Sunday night
  assert.equal(slateFor('2026-11-08T18:00:00Z').label, 'Sunday early');      // 1:00 PM EST after DST ends
  assert.equal(slateFor('2026-11-08T21:05:00Z').label, 'Sunday afternoon');  // 4:05 PM EST
});

test('other days group by their Eastern weekday, and missing times are TBA', () => {
  assert.equal(slateFor('2026-10-02T00:15:00Z').label, 'Thursday');  // 8:15 PM ET Thursday
  assert.equal(slateFor('2026-10-06T00:15:00Z').label, 'Monday');
  assert.equal(slateFor(null).label, 'Time to be announced');
});

test('slates come out in kickoff order', () => {
  const games = ['2026-10-05T00:20:00Z', '2026-10-02T00:15:00Z', '2026-10-04T17:00:00Z', '2026-10-04T20:25:00Z', '2026-10-06T00:15:00Z'];
  assert.deepEqual(groupBySlate(games, iso => iso).map(group => [group.slate.label, group.items.length]),
    [['Thursday', 1], ['Sunday early', 1], ['Sunday afternoon', 2], ['Monday', 1]]);
});
