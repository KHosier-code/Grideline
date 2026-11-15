import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOWLS_PUBLIC_LAUNCH, CBB_PUBLIC_LAUNCH, isBowlsPublic, isCbbPublic, showCbbNewNote } from './sports-launch.mjs';

test('college basketball opens on the morning of December 1, Eastern', () => {
  assert.equal(CBB_PUBLIC_LAUNCH, '2026-12-01T11:00:00Z');
  assert.equal(isCbbPublic(Date.parse('2026-11-30T23:59:00-05:00')), false);
  assert.equal(isCbbPublic(Date.parse('2026-12-01T05:59:00-05:00')), false);
  assert.equal(isCbbPublic(Date.parse('2026-12-01T06:00:00-05:00')), true);
  assert.equal(isCbbPublic(Date.parse('2027-03-15T12:00:00Z')), true);
});

test('the "new" note stays for the first two months', () => {
  assert.equal(showCbbNewNote(Date.parse('2026-12-01T12:00:00Z')), true);
  assert.equal(showCbbNewNote(Date.parse('2027-01-31T12:00:00Z')), true);
  assert.equal(showCbbNewNote(Date.parse('2027-02-02T12:00:00Z')), false);
});

test('the bowl pool page opens at noon Eastern on December 6, matchup day', () => {
  assert.equal(BOWLS_PUBLIC_LAUNCH, '2026-12-06T17:00:00Z');
  assert.equal(isBowlsPublic(Date.parse('2026-12-06T11:59:00-05:00')), false);
  assert.equal(isBowlsPublic(Date.parse('2026-12-06T12:00:00-05:00')), true);
});
