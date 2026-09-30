import { getGetConsumerPowerRatingsQueryKey, useGetConsumerPowerRatings } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { TeamLogo } from '@/components/TeamLogo';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { ConsumerLoading } from './consumer-ui';

const signed = (value: number, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`;

export default function QbRankings() {
  const query = useGetConsumerPowerRatings(undefined, { query: { queryKey: getGetConsumerPowerRatingsQueryKey(), staleTime: 5 * 60_000 } });
  const teams = [...(query.data?.teams ?? [])].sort((a, b) => a.qbRank - b.qbRank);
  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{query.data?.season ? `${query.data.season} season · expected starters for week ${query.data.week}` : 'Quarterbacks'}</p>
        <h1 className="gl-title">QB <span>Rankings</span></h1>
        <p className="gl-lede">Every team&apos;s expected starting quarterback, ranked by value per dropback (EPA), with recent games weighted most. New and backup starters begin near backup level until they build a sample.</p>
      </div>
    </header>
    {query.isLoading && <ConsumerLoading label="Loading quarterbacks…" />}
    {teams.length > 0 && <div className="gl-card gl-table-wrap">
      <table className="gl-table gl-ratings">
        <thead><tr><th scope="col">Rank</th><th scope="col">Quarterback</th><th scope="col">EPA per dropback</th><th scope="col">Worth to the team</th><th scope="col">Team passing offense</th></tr></thead>
        <tbody>{teams.map(team => {
          const passRank = typeof team.stats.off_epa_pass_rank === 'number' ? team.stats.off_epa_pass_rank : null;
          const passEpa = typeof team.stats.off_epa_pass === 'number' ? team.stats.off_epa_pass : null;
          return <tr key={team.team}>
            <td className="gl-rank-num"><b>{team.qbRank}</b></td>
            <td className="gl-team-cell"><TeamLogo team={team.team} /><span><b>{team.qbName ?? 'Not announced'}</b><small>{teamName(team.team)}{team.qbNewStarter ? ' · not the usual starter' : ''}</small></span></td>
            <td className="gl-rank-cell"><span style={rankCellStyle(team.qbRank)}><b>{team.qbValue !== null ? signed(team.qbValue, 3) : '—'}</b></span></td>
            <td className="gl-rating-cell"><span className="gl-rating-value">{signed(team.qb)} pts</span></td>
            <td className="gl-rank-cell"><span style={rankCellStyle(passRank)}><b>{passEpa !== null ? signed(passEpa, 2) : '—'}</b>{passRank !== null && <small>#{passRank}</small>}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    <p className="gl-note">&ldquo;Worth to the team&rdquo; is how many points per game the starter adds or costs compared with an average starter, as used in our <Link href="/power-ratings" className="gl-link">power ratings</Link>. Team passing offense is this season&apos;s EPA per pass play and its league rank.</p>
  </div>;
}
