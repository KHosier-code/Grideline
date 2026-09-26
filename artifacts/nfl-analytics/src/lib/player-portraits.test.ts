import test from 'node:test';
import assert from 'node:assert/strict';
import { safeApiPlayerPortraitUrl } from './player-portraits.ts';

const player = { playerId: '00-123', name: 'A Player', headshotUrl: 'https://images.example.org/player.png' };

test('portrait URL is used only for a complete player identity and safe API image URL', () => {
  assert.equal(safeApiPlayerPortraitUrl(player), player.headshotUrl);
  assert.equal(safeApiPlayerPortraitUrl({ ...player, playerId: '' }), null);
  assert.equal(safeApiPlayerPortraitUrl({ ...player, name: ' ' }), null);
  for (const headshotUrl of [null, '', 'http://images.example.org/player.png',
    'https://user@images.example.org/player.png', 'https://images.example.org:8443/player.png',
    'javascript:alert(1)', '/player.png']) {
    assert.equal(safeApiPlayerPortraitUrl({ ...player, headshotUrl }), null);
  }
});