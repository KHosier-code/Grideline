import type { ConsumerTeamAnalyticsCoverageWeeksItem, ConsumerTeamAnalyticsTeam } from '@workspace/api-client-react';

/** A season-to-date window cannot skip a missing or incomplete schedule week. */
export function latestCompletePriorWeek(weeks: ConsumerTeamAnalyticsCoverageWeeksItem[], priorWeek: number): number {
  const byWeek = new Map(weeks.map(week => [week.week, week]));
  let complete = 0;
  for (let week = 1; week <= priorWeek; week += 1) {
    const coverage = byWeek.get(week);
    if (!coverage || !coverage.allFinal || !coverage.fixtureVerified
      || coverage.missingMatchups.length > 0 || coverage.expectedGames !== coverage.scheduledGames
      || coverage.scheduledGames <= 0
      || coverage.finalGames !== coverage.scheduledGames || coverage.statGames !== coverage.finalGames) break;
    complete = week;
  }
  return complete;
}

/** A manual cutoff can only be one of the contiguous verified weeks. Null tracks the latest. */
export function teamEvidenceWeek(weeks: ConsumerTeamAnalyticsCoverageWeeksItem[], selection: number | null): number {
  const latest = latestCompletePriorWeek(weeks, 18);
  return selection === null ? latest : Math.min(Math.max(1, selection), latest);
}

export function pregameTrendTeams(teams: ConsumerTeamAnalyticsTeam[], codes: string[], throughWeek: number, kickoff: number) {
  return teams.filter(team => codes.includes(team.abbreviation)).map(team => ({
    ...team,
    observations: team.observations.filter(item => item.week <= throughWeek
      && Number.isFinite(Date.parse(item.kickoffTime)) && Date.parse(item.kickoffTime) < kickoff),
  }));
}