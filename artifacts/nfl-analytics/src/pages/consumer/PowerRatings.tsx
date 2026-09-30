import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { getGetConsumerPowerRatingsQueryKey, useGetConsumerPowerRatings, type ConsumerTeamRating } from '@workspace/api-client-react';
import { TeamLogo } from '@/components/TeamLogo';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { ConsumerLoading } from './consumer-ui';

type SortKey = 'ratingRank' | 'offenseRank' | 'defenseRank' | 'qbRank' | 'pointsFor' | 'pointsAgainst';
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;
const stat = (team: ConsumerTeamRating, key: string) => {
  const value = team.stats[key];
  return typeof value === 'number' ? value : null;
};

function RankCell({ rank, value }: { rank: number | null; value: string }) {
  return <td className="gl-rank-cell"><span style={rankCellStyle(rank)}><b>{value}</b>{rank !== null && <small>#{rank}</small>}</span></td>;
}

function Change({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="gl-change flat">–</span>;
  return <span className={`gl-change ${value > 0 ? 'up' : 'down'}`}>{value > 0 ? '▲' : '▼'}{Math.abs(value)}</span>;
}

export default function PowerRatings() {
  const query = useGetConsumerPowerRatings(undefined, { query: { queryKey: getGetConsumerPowerRatingsQueryKey(), staleTime: 5 * 60_000 } });
  const [sort, setSort] = useState<SortKey>('ratingRank');
  const data = query.data;
  const maxRating = Math.max(1, ...(data?.teams ?? []).map(team => Math.abs(team.rating)));
  const rows = useMemo(() => {
    const teams = [...(data?.teams ?? [])];
    const value = (team: ConsumerTeamRating) => sort === 'pointsFor' ? stat(team, 'off_points_rank') ?? 99
      : sort === 'pointsAgainst' ? stat(team, 'def_points_rank') ?? 99 : team[sort];
    return teams.sort((a, b) => value(a) - value(b));
  }, [data, sort]);
  const header = (key: SortKey, label: string, hint?: string) => <th scope="col" aria-sort={sort === key ? 'ascending' : 'none'}>
    <button type="button" onClick={() => setSort(key)} title={hint}>{label}{sort === key ? ' ↓' : ''}</button>
  </th>;

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{data?.season ? `${data.season} season · before week ${data.week}` : 'Power ratings'}</p>
        <h1 className="gl-title">Power <span>Ratings</span></h1>
        <p className="gl-lede">Every team ranked 1–32 by how many points better or worse it is than an average NFL team on a neutral field, with its current starting quarterback. Built from every play this season and last, weighted toward recent games.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading power ratings…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the ratings.</strong>Refresh the page in a minute.</div>}
    {data?.status === 'unavailable' && <div className="gl-empty"><strong>Ratings aren&apos;t posted yet.</strong>They update Tuesday morning after each week&apos;s games.</div>}

    {rows.length > 0 && <div className="gl-card gl-table-wrap">
      <table className="gl-table gl-ratings">
        <thead><tr>
          {header('ratingRank', 'Rank')}
          <th scope="col">Team</th>
          <th scope="col">Rating</th>
          {header('offenseRank', 'Offense', 'Team offense, not counting the quarterback')}
          {header('defenseRank', 'Defense')}
          {header('qbRank', 'Quarterback')}
          {header('pointsFor', 'Points scored')}
          {header('pointsAgainst', 'Points allowed')}
        </tr></thead>
        <tbody>{rows.map(team => {
          const pf = stat(team, 'off_points');
          const pa = stat(team, 'def_points');
          const width = (Math.abs(team.rating) / maxRating) * 50;
          return <tr key={team.team}>
            <td className="gl-rank-num"><b>{team.ratingRank}</b><Change value={team.rankChange} /></td>
            <td className="gl-team-cell"><TeamLogo team={team.team} /><span><b>{teamName(team.team)}</b><small>{team.record ? `${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ''}` : ''}</small></span></td>
            <td className="gl-rating-cell">
              <span className="gl-rating-value">{signed(team.rating)}</span>
              <span className="gl-rating-bar" aria-hidden="true"><i className={team.rating >= 0 ? 'pos' : 'neg'} style={{ width: `${width}%` }} /></span>
            </td>
            <RankCell rank={team.offenseRank} value={signed(team.offense)} />
            <RankCell rank={team.defenseRank} value={signed(team.defense)} />
            <td className="gl-rank-cell gl-qb-cell"><span style={rankCellStyle(team.qbRank)}><b>{team.qbName ?? '—'}</b><small>{signed(team.qb)} · #{team.qbRank}</small></span>{team.qbOutName ? <em className="gl-flag out">{team.qbOutName} {(team.qbOutReason ?? 'out').toLowerCase()}</em> : team.qbNewStarter && <em className="gl-flag">Not usual starter</em>}</td>
            <RankCell rank={stat(team, 'off_points_rank')} value={pf !== null ? pf.toFixed(1) : '—'} />
            <RankCell rank={stat(team, 'def_points_rank')} value={pa !== null ? pa.toFixed(1) : '—'} />
          </tr>;
        })}</tbody>
      </table>
    </div>}

    <div className="gl-footer-inner gl-card" style={{ padding: 18 }}>
      <p><b>Reading the rating</b>+5.0 means we&apos;d expect this team to beat an average team by 5 points on a neutral field. The difference between two ratings, plus about 1.5 points for home field, is roughly our line for their game.</p>
      <p><b>Offense, defense, quarterback</b>The three parts add up to the rating. Quarterback is the starter&apos;s value per dropback compared with an average starter; offense is the rest of the offense.</p>
      <p><b>Colors</b>Green cells rank near the top of the league, red near the bottom. <Link href="/methodology" className="gl-link">How the model works</Link>.</p>
    </div>
  </div>;
}
