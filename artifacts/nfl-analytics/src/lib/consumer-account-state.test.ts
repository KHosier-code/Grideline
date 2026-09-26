import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumerAccountState } from './consumer-account-state.ts';

test('visitor account actions remain permission-safe while loading, signed out, or signed in', () => {
  const unresolved = { data: undefined, isSuccess: false, isFetching: false };
  assert.deepEqual(consumerAccountState(false, undefined, unresolved), {
    signedIn: false, signedOut: false, adminVerified: false,
  });
  assert.deepEqual(consumerAccountState(true, false, { data: true, isSuccess: true, isFetching: false }), {
    signedIn: false, signedOut: true, adminVerified: false,
  });
  assert.deepEqual(consumerAccountState(true, true, { data: false, isSuccess: true, isFetching: false }), {
    signedIn: true, signedOut: false, adminVerified: false,
  });
  assert.deepEqual(consumerAccountState(true, true, { data: true, isSuccess: true, isFetching: false }), {
    signedIn: true, signedOut: false, adminVerified: true,
  });
});

test('pending and failed admin checks cannot expose the workspace link, even with stale true data', () => {
  for (const check of [
    { data: undefined, isSuccess: false, isFetching: true },
    { data: true, isSuccess: false, isFetching: false },
    { data: true, isSuccess: true, isFetching: true },
  ]) {
    assert.equal(consumerAccountState(true, true, check).adminVerified, false);
  }
});