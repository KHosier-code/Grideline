import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RED_ZONE_FALLBACK_LABEL, formatRedZoneCoverage, formatRedZoneValue, normalizeRedZoneResponse, scheduleTeamAbbreviation, selectRedZoneFallback, sortRedZonePlayers } from './consumer-red-zone.ts';

test('missing and unavailable fields remain unavailable while verified zero is displayed', () => {
  const data = normalizeRedZoneResponse({
    season: 2026, status: 'partial', sourceUpdatedAt: '2026-09-17T12:00:00Z', ingestedAt: '2026-09-18T12:00:00Z',
    players: [{ playerId: 'p1', playerName: 'A. Receiver', teamId: 'BUF', position: 'WR', windows: {
      season: { gamesPlayed: 2, sampleGames: 3, status: 'partial', metrics: {
        targets: { available: true, value: 0 }, carries: { available: false, value: 4 }, receivingTds: 1,
      } },
      last3: { gamesPlayed: 1, status: 'available', metrics: { targets: 2 } },
    } }],
  });
  assert.equal(data.players[0]?.season.stats.targets, 0);
  assert.equal(data.players[0]?.season.stats.carries, null);
  assert.equal(data.players[0]?.season.stats.snaps, null);
  assert.equal(data.players[0]?.season.gamesPlayed, 2);
  assert.equal(data.players[0]?.last3.gamesPlayed, 1);
  assert.equal(formatRedZoneValue(data.players[0]!.season.stats.targets), '0');
  assert.equal(formatRedZoneValue(data.players[0]!.season.stats.snaps), '—');
  assert.equal(formatRedZoneValue(0.472, true), '47.2%');
});

test('selected period maps flat server rows and unavailable sorts last in either direction', () => {
  const data = normalizeRedZoneResponse({ players: [
    { playerId: 'a', playerName: 'Alpha', teamId: 'MIA', gamesPlayed: 3, metrics: { targets: 5 } },
    { playerId: 'b', playerName: 'Beta', teamId: 'MIA', gamesPlayed: 1, metrics: { targets: null } },
    { playerId: 'c', playerName: 'Charlie', teamId: 'MIA', gamesPlayed: 2, metrics: { targets: 1 } },
  ] }, 'last3');
  assert.equal(data.players[0]?.last3.stats.targets, 5);
  assert.deepEqual(sortRedZonePlayers(data.players, 'last3', 'targets', 'desc').map(p => p.playerName), ['Alpha', 'Charlie', 'Beta']);
  assert.deepEqual(sortRedZonePlayers(data.players, 'last3', 'targets', 'asc').map(p => p.playerName), ['Charlie', 'Alpha', 'Beta']);
  assert.equal(data.players[1]?.season.stats.targets, null);
});

test('live endpoint shape selects only the requested overlapping zone and identifies partial snap sample', () => {
  const data = normalizeRedZoneResponse({
    season: 2026, status: 'partial', coverage: { missingGames: ['g2'] },
    players: [{ playerId: 'gsis-1', playerName: 'A. Runner', teamId: 'MIA', gamesPlayed: 2,
      offenseSnaps: 39, offensePct: 0.672, snapGames: 1,
      sourceCoverage: { requestedGames: 2, includedGames: 1, missingGames: ['g2'] },
      zones: [
        { zone: 20, targets: 4, carries: 5, receivingTouchdowns: 1, rushingTouchdowns: 2, targetShare: 0.472, carryShare: 0.25 },
        { zone: 5, targets: null, carries: null, receivingTouchdowns: null, rushingTouchdowns: null, targetShare: null, carryShare: null },
      ],
    }],
  }, 'season', 5);
  assert.equal(data.players[0]?.season.stats.targets, null);
  assert.equal(data.players[0]?.season.stats.carries, null);
  assert.equal(data.players[0]?.season.stats.snapPct, 0.672);
  assert.equal(data.players[0]?.season.snapGames, 1);
  assert.equal(data.players[0]?.season.status, 'partial');
  assert.equal(data.players[0]?.season.includedGames, 1);
  assert.equal(data.players[0]?.season.sampleGames, 2);
  assert.equal(data.players[0]?.season.reason, '1 appearance without verified play-by-play');
  assert.match(data.partialReasons[0]!, /1 completed game/);
});

test('coverage presentation preserves discontiguous weeks and the actual covered date span', () => {
  const coverage = {
    coveredWeeks: [3, 1, 3],
    missingWeeks: [2, 4],
    firstCoveredKickoff: '2026-09-11T00:20:00.000Z',
    lastCoveredKickoff: '2026-09-25T00:15:00.000Z',
  };
  assert.equal(formatRedZoneCoverage(coverage), 'Covered Week 1, Week 3 · Sep 11–Sep 25, 2026 · missing Week 2, Week 4');
});

test('Week 1-only evidence names Week 2 as missing without implying zero opportunities', () => {
  const data = normalizeRedZoneResponse({
    season: 2026,
    status: 'partial',
    coverage: {
      coveredWeeks: [1],
      missingWeeks: [2],
      firstCoveredKickoff: '2026-09-11T00:20:00.000Z',
      lastCoveredKickoff: '2026-09-11T00:20:00.000Z',
      completedGames: 32,
      gamesWithPbp: 16,
    },
    players: [{
      playerId: 'p1',
      playerName: 'A. Receiver',
      teamId: 'BUF',
      gamesPlayed: 1,
      sourceCoverage: {
        requestedGames: 2,
        includedGames: 1,
        missingGames: ['week-2-game'],
        coveredWeeks: [1],
        missingWeeks: [2],
        firstCoveredKickoff: '2026-09-11T00:20:00.000Z',
        lastCoveredKickoff: '2026-09-11T00:20:00.000Z',
      },
      zones: [{ zone: 20, targets: 3, carries: 0, receivingTouchdowns: 1, rushingTouchdowns: 0 }],
    }],
  });
  assert.deepEqual(data.coveredWeeks, [1]);
  assert.deepEqual(data.missingWeeks, [2]);
  assert.equal(formatRedZoneCoverage(data), 'Covered Week 1 · Sep 11, 2026 · missing Week 2');
  assert.deepEqual(data.players[0]?.season.coveredWeeks, [1]);
  assert.deepEqual(data.players[0]?.season.missingWeeks, [2]);
  assert.equal(data.players[0]?.season.includedGames, 1);
  assert.equal(data.players[0]?.season.sampleGames, 2);
  assert.equal(data.players[0]?.season.stats.targets, 3);
  assert.equal(data.players[0]?.season.status, 'partial');
});

test('actual response retains separate player/team rows after a trade and uses player-specific availability', () => {
  const response = {
    status: 'partial', season: 2026, seasonType: 'REG', period: 'last3', zone: 20,
    source: 'nflverse play-by-play', sourceUpdatedAt: null, ingestedAt: '2026-09-25T12:00:00Z',
    coverage: { status: 'partial', completedGames: 3, gamesWithPbp: 2, missingGames: ['week3'], note: 'Source evidence limited.' },
    players: [
      { playerId: 'gsis-traded', playerName: 'R. Receiver', position: 'WR', teamId: 'BUF', gamesPlayed: 2,
        offenseSnaps: 45, offensePct: 0.62, snapGames: 1,
        sourceCoverage: { requestedGames: 2, includedGames: 1, missingGames: ['week3'] }, games: [],
        zones: [{ zone: 20, targets: null, carries: null, receivingTouchdowns: null, rushingTouchdowns: null, teamTargets: null, teamCarries: null, targetShare: null, carryShare: null }] },
      { playerId: 'gsis-traded', playerName: 'R. Receiver', position: 'WR', teamId: 'MIA', gamesPlayed: 1,
        offenseSnaps: null, offensePct: null, snapGames: 0,
        sourceCoverage: { requestedGames: 1, includedGames: 1, missingGames: [] }, games: [],
        zones: [{ zone: 20, targets: 0, carries: 0, receivingTouchdowns: 0, rushingTouchdowns: 0, teamTargets: 4, teamCarries: 8, targetShare: 0, carryShare: 0 }] },
    ],
  };
  const data = normalizeRedZoneResponse(response, 'last3', 20);
  assert.deepEqual(data.players.map(player => [player.playerId, player.team]), [['gsis-traded', 'BUF'], ['gsis-traded', 'MIA']]);
  assert.equal(data.players[0]?.last3.status, 'partial');
  assert.equal(data.players[1]?.last3.status, 'available');
  assert.equal(data.players[0]?.last3.stats.targets, null);
  assert.equal(data.players[1]?.last3.stats.targets, 0);
  assert.equal(data.players[1]?.last3.snapGames, 0);
  assert.equal(data.players[1]?.last3.stats.snaps, null);
});

test('team options normalize string and team-object schedule payloads', () => {
  assert.deepEqual(['BUF', { abbreviation: 'MIA', name: 'Miami Dolphins' }, null, { name: 'No abbreviation' }]
    .map(scheduleTeamAbbreviation).filter(Boolean), ['BUF', 'MIA']);
});

test('Game Detail red-zone-only fallback selects at most three per team by sourced targets plus carries', () => {
  const data = normalizeRedZoneResponse({ status: 'partial', period: 'season', players: [
    { playerId: 'a', playerName: 'A', teamId: 'BUF', gamesPlayed: 1, sourceCoverage: { requestedGames: 1, includedGames: 1, missingGames: [] }, zones: [{ zone: 20, targets: 2, carries: 1 }] },
    { playerId: 'b', playerName: 'B', teamId: 'BUF', gamesPlayed: 1, sourceCoverage: { requestedGames: 1, includedGames: 1, missingGames: [] }, zones: [{ zone: 20, targets: 0, carries: 0 }] },
    { playerId: 'c', playerName: 'C', teamId: 'BUF', gamesPlayed: 2, sourceCoverage: { requestedGames: 2, includedGames: 0, missingGames: ['g1', 'g2'] }, zones: [{ zone: 20, targets: null, carries: null }] },
    { playerId: 'd', playerName: 'D', teamId: 'BUF', gamesPlayed: 1, sourceCoverage: { requestedGames: 1, includedGames: 1, missingGames: [] }, zones: [{ zone: 20, targets: 5, carries: 0 }] },
    { playerId: 'e', playerName: 'E', teamId: 'BUF', gamesPlayed: 1, sourceCoverage: { requestedGames: 1, includedGames: 1, missingGames: [] }, zones: [{ zone: 20, targets: 1, carries: 1 }] },
    { playerId: 'opponent', playerName: 'Opponent', teamId: 'MIA', gamesPlayed: 1, zones: [{ zone: 20, targets: 12, carries: 2 }] },
  ] }, 'season', 20);
  assert.equal(RED_ZONE_FALLBACK_LABEL, 'Incomplete Player Usage · Red-zone-only evidence');
  assert.deepEqual(selectRedZoneFallback(data.players, 'BUF').map(player => player.playerId), ['d', 'a', 'e']);
  assert.deepEqual(selectRedZoneFallback(data.players, 'MIA').map(player => player.playerId), ['opponent']);
  assert.equal(data.players[2]!.season.status, 'unavailable');
  assert.equal(data.players[2]!.season.stats.targets, null);
  assert.equal(data.players[1]!.season.stats.targets, 0);
});

test('red-zone page is public while the older game-detail red-zone figures stay opt-in', () => {
  const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
  const shell = readFileSync(fileURLToPath(new URL('../components/ConsumerShellView.tsx', import.meta.url)), 'utf8');
  const card = readFileSync(fileURLToPath(new URL('../components/ConsumerKeyPlayers.tsx', import.meta.url)), 'utf8');
  assert.match(shell, /\{ href: '\/red-zone', label: 'Red Zone'/);
  assert.equal((app.match(/<Route path="\/red-zone"><ConsumerShell><ConsumerRedZone \/><\/ConsumerShell><\/Route>/g) ?? []).length, 2);
  assert.match(app, /import\('@\/pages\/consumer\/RedZone'\)/);
  assert.match(app, /<Route path="\/games">/);
  assert.match(app, /<Route path="\/usage">/);
  assert.match(card, /VITE_GRIDLINE_RED_ZONE_ENABLED === '1'/);
  assert.match(card, /game: gameId, zone: 20, period: 'last3'/);
  assert.match(card, /game: gameId, zone: 20, period: 'season'/);
  assert.match(card, /getGetConsumerRedZoneOpportunitiesQueryKey/);
  assert.equal((card.match(/enabled: redZoneEnabled && Boolean\(gameId\)/g) ?? []).length, 2);
  assert.match(card, /\{redZoneEnabled && <RedZoneFigures/);
  assert.match(card, /if \(fallback && !redZoneEnabled\) return null/);
  assert.match(card, /if \(fallback\)/);
});

test('coverage periods and incomplete Player Usage labels are visible beside dashboard and Game Detail figures', () => {
  const card = readFileSync(fileURLToPath(new URL('../components/ConsumerKeyPlayers.tsx', import.meta.url)), 'utf8');
  assert.match(card, /formatRedZoneCoverage\(window\)/);
  assert.match(card, /completed appearances covered/);
  assert.match(RED_ZONE_FALLBACK_LABEL, /incomplete player usage/i);
});