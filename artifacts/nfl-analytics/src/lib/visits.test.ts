import test from 'node:test';
import assert from 'node:assert/strict';
import { uncountedPath, visitFlags, visitSource } from './visits';

test('first visit today and back-within-a-week flags', () => {
  const now = new Date('2026-12-08T15:00:00Z');
  assert.deepEqual(visitFlags(null, now), { today: '2026-12-08', first: true, returning: false });
  assert.deepEqual(visitFlags('2026-12-08', now), { today: '2026-12-08', first: false, returning: false });
  assert.deepEqual(visitFlags('2026-12-02', now), { today: '2026-12-08', first: true, returning: true });
  assert.deepEqual(visitFlags('2026-11-30', now), { today: '2026-12-08', first: true, returning: false });
  assert.equal(visitFlags('garbage', now).returning, false);
});

test('sources are broad buckets; links inside the site are not a source', () => {
  assert.equal(visitSource('', 'probablesports.com'), 'direct');
  assert.equal(visitSource('https://probablesports.com/touchdowns', 'probablesports.com'), 'direct');
  assert.equal(visitSource('https://www.google.com/', 'probablesports.com'), 'google');
  assert.equal(visitSource('https://t.co/abc', 'probablesports.com'), 'x');
  assert.equal(visitSource('https://old.reddit.com/r/CFB', 'probablesports.com'), 'reddit');
  assert.equal(visitSource('https://l.facebook.com/l.php', 'probablesports.com'), 'facebook');
  assert.equal(visitSource('https://example.org/', 'probablesports.com'), 'other');
});

test('admin and sign-in pages are never counted', () => {
  assert.equal(uncountedPath('/admin'), true);
  assert.equal(uncountedPath('/admin/ops'), true);
  assert.equal(uncountedPath('/sign-in'), true);
  assert.equal(uncountedPath('/administrator-guide'), false);
  assert.equal(uncountedPath('/pools/bowls'), false);
});
