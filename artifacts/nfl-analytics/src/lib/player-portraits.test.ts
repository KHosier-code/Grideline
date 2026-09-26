import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApiPlayerPortraitUrl } from './player-portraits.ts';

Object.assign(globalThis, { window: { location: { origin: 'https://app.example.org' } } });
const player = { playerId: '00-123', name: 'A Player', headshotUrl: '/api/verified-imagery/player/00-123' };

test('portrait URL is used only for a complete player identity and safe API image URL', () => {
  assert.equal(safeApiPlayerPortraitUrl(player), `${window.location.origin}${player.headshotUrl}`);
  assert.equal(safeApiPlayerPortraitUrl({ ...player, playerId: '' }), null);
  assert.equal(safeApiPlayerPortraitUrl({ ...player, name: ' ' }), null);
  for (const headshotUrl of [null, '', 'http://images.example.org/player.png',
    'https://user@images.example.org/player.png', 'https://images.example.org:8443/player.png',
    'javascript:alert(1)', '/player.png']) {
    assert.equal(safeApiPlayerPortraitUrl({ ...player, headshotUrl }), null);
  }
});