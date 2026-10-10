import assert from 'node:assert/strict';
import test from 'node:test';
import { playerSlug } from './player-slug.ts';

test('player page addresses are readable and stable', () => {
  assert.equal(playerSlug('Puka Nacua'), 'puka-nacua');
  assert.equal(playerSlug('D.J. Moore Jr.'), 'dj-moore-jr');
  assert.equal(playerSlug("Ja'Marr Chase"), 'jamarr-chase');
  assert.equal(playerSlug('Amon-Ra St. Brown'), 'amon-ra-st-brown');
  assert.equal(playerSlug('Jaxon Smith-Njigba'), 'jaxon-smith-njigba');
  assert.equal(playerSlug('Zoë Ñúñez'), 'zoe-nunez');
});
