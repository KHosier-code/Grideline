import { getGetConsumerPowerRatingsQueryKey, useGetConsumerPowerRatings, type ConsumerTeamRating } from '@workspace/api-client-react';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { TeamLogo } from './TeamLogo';

/** Metric key suffixes from research/game-model/team_stats.py, grouped for display. */
const GROUPS: Array<{ title: string; rows: Array<{ key: string; label: string; format: (value: number) => string }> }> = [
  { title: 'Scoring and yards', rows: [
    { key: 'points', label: 'Points / game', format: value => value.toFixed(1) },
    { key: 'yds', label: 'Yards / game', format: value => value.toFixed(0) },
    { key: 'pass_yds', label: 'Passing yards / game', format: value => value.toFixed(0) },
    { key: 'rush_yds', label: 'Rushing yards / game', format: value => value.toFixed(0) },
  ] },
  { title: 'Efficiency (EPA)', rows: [
    { key: 'epa_play', label: 'EPA / play', format: value => value.toFixed(2) },
    { key: 'epa_pass', label: 'EPA / pass', format: value => value.toFixed(2) },
    { key: 'epa_rush', label: 'EPA / rush', format: value => value.toFixed(2) },
  ] },
  { title: 'Negative plays', rows: [
    { key: 'sacks', label: 'Sacks / game', format: value => value.toFixed(1) },
    { key: 'ints', label: 'Interceptions / game', format: value => value.toFixed(1) },
    { key: 'fumbles', label: 'Fumbles lost / game', format: value => value.toFixed(1) },
    { key: 'turnover_epa', label: 'Turnover EPA / game', format: value => value.toFixed(1) },
  ] },
  { title: 'Conversions', rows: [
    { key: 'third_down', label: 'Third-down rate', format: value => `${Math.round(value * 100)}%` },
    { key: 'red_zone', label: 'Red-zone TD rate', format: value => `${Math.round(value * 100)}%` },
  ] },
];

function lookup(teams: ConsumerTeamRating[], abbreviation: string) {
  const aliases: Record<string, string> = { LAR: 'LA', WSH: 'WAS' };
  return teams.find(team => team.team === abbreviation || team.team === aliases[abbreviation]);
}

function Side({ offense, defense }: { offense: ConsumerTeamRating; defense: ConsumerTeamRating }) {
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-matchup-ranks">
      <caption className="sr-only">{teamName(offense.team)} offense against {teamName(defense.team)} defense, season ranks</caption>
      <thead><tr>
        <th scope="col">{teamName(offense.team)} offense vs {teamName(defense.team)} defense</th>
        <th scope="col"><TeamLogo team={offense.team} size={26} /></th>
        <th scope="col"><TeamLogo team={defense.team} size={26} /></th>
      </tr></thead>
      {GROUPS.map(group => <tbody key={group.title}>
        <tr className="gl-group-row"><th scope="rowgroup" colSpan={3}>{group.title}</th></tr>
        {group.rows.map(row => {
          const offenseValue = offense.stats[`off_${row.key}`];
          const offenseRank = offense.stats[`off_${row.key}_rank`];
          const defenseValue = defense.stats[`def_${row.key}`];
          const defenseRank = defense.stats[`def_${row.key}_rank`];
          return <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td className="gl-rank-cell"><span style={rankCellStyle(offenseRank)} title={typeof offenseValue === 'number' ? row.format(offenseValue) : undefined}><b>{offenseRank ?? '—'}</b><small>{typeof offenseValue === 'number' ? row.format(offenseValue) : ''}</small></span></td>
            <td className="gl-rank-cell"><span style={rankCellStyle(defenseRank)} title={typeof defenseValue === 'number' ? row.format(defenseValue) : undefined}><b>{defenseRank ?? '—'}</b><small>{typeof defenseValue === 'number' ? row.format(defenseValue) : ''}</small></span></td>
          </tr>;
        })}
      </tbody>)}
    </table>
  </div>;
}

/** Each offense against the other defense: 1-32 league ranks this season (1 = best). */
export function MatchupRanks({ home, away }: { home: string; away: string }) {
  const ratings = useGetConsumerPowerRatings(undefined, { query: { queryKey: getGetConsumerPowerRatingsQueryKey(), staleTime: 5 * 60_000 } });
  const teams = ratings.data?.teams ?? [];
  const homeTeam = lookup(teams, home);
  const awayTeam = lookup(teams, away);
  if (!homeTeam || !awayTeam || !Object.keys(homeTeam.stats).length) return null;
  return <section className="gl-section" aria-labelledby="matchup-ranks-heading">
    <div className="gl-section-head"><h2 id="matchup-ranks-heading">Team matchup ranks</h2><p>League rank this season, 1 is best. Green is a strength, red a weakness.</p></div>
    <div className="gl-matchup-grid">
      <Side offense={awayTeam} defense={homeTeam} />
      <Side offense={homeTeam} defense={awayTeam} />
    </div>
  </section>;
}
