import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { imageAvailable, PlayerPortrait, TeamMark } from './VerifiedImage';

test('null and failed headshot URLs render an accessible styled placeholder', () => {
  const missing = renderToStaticMarkup(createElement(PlayerPortrait, { url: null, name: 'A Player' }));
  assert.match(missing, /puc-avatar/);
  assert.match(missing, /Photo unavailable for A Player/);
  assert.doesNotMatch(missing, /<img/);
  assert.equal(imageAvailable('https://example.org/a.png', 'https://example.org/a.png'), false);
  assert.equal(imageAvailable('https://example.org/b.png', 'https://example.org/a.png'), true);
  assert.match(renderToStaticMarkup(createElement(PlayerPortrait, { url: 'https://example.org/a.png', name: 'A Player' })), /<img/);
});

test('team mark retains readable abbreviation without verified or working URL', () => {
  const fallback = renderToStaticMarkup(createElement(TeamMark, { url: null, abbreviation: 'LAR' }));
  assert.match(fallback, /LAR team mark/);
  assert.match(fallback, />LAR<\/span>/);
  assert.doesNotMatch(fallback, /<img/);
  assert.equal(imageAvailable('https://example.org/team.png', 'https://example.org/team.png'), false);
});