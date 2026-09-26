import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConsumerTeamAnalyticsTeam } from '@workspace/api-client-react';
import { latestCompletePriorWeek, pregameTrendTeams, teamEvidenceWeek } from './home-chart-evidence.ts';

const full = [
  { week: 1, scheduledGames: 16, finalGames: 16, statGames: 16, allFinal: true },
  { week: 2, scheduledGames: 16, finalGames: 16, statGames: 16, allFinal: true },
];

test('populated prior-week window includes only contiguous verified final weeks', () => {
  assert.equal(latestCompletePriorWeek(full, 2), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, scheduledGames: 16, finalGames: 1, statGames: 1, allFinal: false }], 3), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, scheduledGames: 16, finalGames: 0, statGames: 0, allFinal: false }], 3), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, scheduledGames: 16, finalGames: 16, statGames: 15, allFinal: true }], 3), 2);
  assert.equal(latestCompletePriorWeek([...full, { week: 3, scheduledGames: 16, finalGames: 16, statGames: 16, allFinal: true }], 3), 3);
});

test('missing schedule or unmatched team-stat coverage leaves form unavailable', () => {
  assert.equal(latestCompletePriorWeek([], 2), 0);
  assert.equal(latestCompletePriorWeek([{ ...full[0]!, statGames: 15 }, full[1]!], 2), 0);
  assert.equal(latestCompletePriorWeek([full[0]!, { ...full[1]!, week: 3 }], 3), 1);
  assert.equal(latestCompletePriorWeek([{ ...full[0]!, allFinal: false }, full[1]!], 2), 0);
});

test('team selection stays on a verified cutoff, follows new weeks by default, and resets on season change', () => {
  assert.equal(teamEvidenceWeek([], null), 0);
  assert.equal(teamEvidenceWeek([{ ...full[0]!, finalGames: 1, statGames: 1, allFinal: false }], null), 0);
  assert.equal(teamEvidenceWeek(full, null), 2);
  assert.equal(teamEvidenceWeek(full, 1), 1);
  assert.equal(teamEvidenceWeek([...full, { ...full[1]!, week: 3 }], null), 3);
  assert.equal(teamEvidenceWeek(full, 3), 2);
  // Changing season clears the selection in the page; the new season resolves independently.
  assert.equal(teamEvidenceWeek([full[0]!], null), 1);
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