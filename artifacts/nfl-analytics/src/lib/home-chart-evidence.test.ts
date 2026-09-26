import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerTeamAnalyticsTeam } from '@workspace/api-client-react';
import { latestCompletePriorWeek, pregameTrendTeams } from './home-chart-evidence.ts';

const full = [
  { week: 1, finalGames: 16, statGames: 16 },
  { week: 2, finalGames: 16, statGames: 16 },
];

test('populated prior-week window includes only contiguous verified final weeks', () => {
  assert.equal(latestCompletePriorWeek(full, 2), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, finalGames: 2, statGames: 0 }], 3), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, finalGames: 0, statGames: 0 }], 3), 2);
});

test('missing schedule or unmatched team-stat coverage leaves form unavailable', () => {
  assert.equal(latestCompletePriorWeek([], 2), 0);
  assert.equal(latestCompletePriorWeek([{ week: 1, finalGames: 16, statGames: 15 }, full[1]!], 2), 0);
  assert.equal(latestCompletePriorWeek([full[0]!, { week: 3, finalGames: 16, statGames: 16 }], 3), 1);
});

test('a selected team keeps zero EPA but excludes missing, future, and wrong-team observations', () => {
  const team = {
    abbreviation: 'CAR',
    observations: [
      { week: 1, kickoffTime: '2026-09-06T17:00:00Z', offenseEpa: 0 },
      { week: 2, kickoffTime: '2026-09-13T17:00:00Z', offenseEpa: null },
      { week: 3, kickoffTime: '2026-09-27T17:00:00Z', offenseEpa: 0.3 },
    ],
  } as ConsumerTeamAnalyticsTeam;
  const teams = pregameTrendTeams([team, { ...team, abbreviation: 'NYJ' }], ['CAR', 'CLE'], 2, Date.parse('2026-09-27T17:00:00Z'));
  assert.equal(teams.length, 1);
  assert.deepEqual(teams[0]?.observations.map(item => item.offenseEpa), [0, null]);
});