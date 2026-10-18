import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import { rankCellStyle } from '@/lib/team-colors';
import { seasonLabel, type CbbTeam } from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import { CbbLogo } from './CbbGames';
import './cbb.css';

type SortKey = 'rank' | 'offenseRank' | 'defenseRank' | 'tempoRank';
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;
const PAGE = 50;

function RankCell({ rank, value, teams }: { rank: number; value: string; teams: number }) {
  return <td className="gl-rank-cell"><span style={rankCellStyle(rank, teams)}><b>{value}</b><small>#{rank}</small></span></td>;
}

function Change({ team }: { team: CbbTeam }) {
  const change = team.preseasonRank - team.rank;
  if (!change) return <span className="gl-change flat">–</span>;
  return <span className={`gl-change ${change > 0 ? 'up' : 'down'}`} title={`Preseason #${team.preseasonRank}`}>{change > 0 ? '▲' : '▼'}{Math.abs(change)}</span>;
}

export default function CbbRatings() {
  const { query, report } = useCbb();
  const [sort, setSort] = useState<SortKey>('rank');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const all = report?.teams ?? [];
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter(team => !needle || `${team.name} ${team.short} ${team.abbr ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a[sort] - b[sort]);
  }, [all, sort, search]);
  const maxNet = Math.max(1, ...all.map(team => Math.abs(team.net)));
  const header = (key: SortKey, label: string, hint?: string) => <th scope="col" aria-sort={sort === key ? 'ascending' : 'none'}>
    <button type="button" onClick={() => setSort(key)} title={hint}>{label}{sort === key ? ' ↓' : ''}</button>
  </th>;
  const preseason = report && report.gamesPlayed === 0;

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{report ? `College basketball · ${seasonLabel(report.season)}${preseason ? ' · preseason' : ''}` : 'College basketball'}</p>
        <h1 className="gl-title">College <span>Power Ratings</span></h1>
        <p className="gl-lede">All {all.length || 362} Division I teams ranked by how many points per 100 possessions better or worse they are than an average team, adjusted for opponents and home court. {preseason ? 'Before the first game, ratings come from last season and how much of each roster returned, including transfers.' : 'Recent games count more, and early in the season the ratings still lean on last season and roster turnover.'}</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading ratings…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the ratings.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Ratings aren&apos;t posted yet.</strong>They update every morning during the season.</div>}

    {report && <>
      <div className="gl-section-head">
        <label className="cbb-search">
          <span className="gl-label">Find a team</span>
          <input type="search" value={search} placeholder="Duke, Gonzaga…" onChange={event => { setSearch(event.target.value); setShown(PAGE); }} />
        </label>
        <p className="cbb-muted">{report.gamesPlayed.toLocaleString()} games played · average {report.model.averageEfficiency} points per 100 possessions · home court worth {report.model.homeCourt.toFixed(1)} points</p>
      </div>
      <div className="gl-card gl-table-wrap">
        <table className="gl-table gl-ratings cbb-ratings">
          <thead><tr>
            {header('rank', 'Rank')}
            <th scope="col">Team</th>
            <th scope="col">Rating</th>
            {header('offenseRank', 'Offense', 'Points scored per 100 possessions against an average defense')}
            {header('defenseRank', 'Defense', 'Points allowed per 100 possessions against an average offense (lower is better)')}
            {header('tempoRank', 'Tempo', 'Possessions per 40 minutes')}
          </tr></thead>
          <tbody>{rows.slice(0, shown).map(team => <tr key={team.id}>
            <td className="gl-rank-num"><b>{team.rank}</b>{!preseason && <Change team={team} />}</td>
            <td className="gl-team-cell"><CbbLogo team={team} /><span><b>{team.name}</b><small>{team.wins + team.losses ? `${team.wins}-${team.losses}` : 'No games yet'}</small></span></td>
            <td className="gl-rating-cell">
              <span className="gl-rating-value">{signed(team.net)}</span>
              <span className="gl-rating-bar" aria-hidden="true"><i className={team.net >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(team.net) / maxNet) * 50}%` }} /></span>
            </td>
            <RankCell rank={team.offenseRank} value={team.offense.toFixed(1)} teams={all.length} />
            <RankCell rank={team.defenseRank} value={team.defense.toFixed(1)} teams={all.length} />
            <td className="gl-rank-cell"><span><b>{team.tempo.toFixed(1)}</b><small>#{team.tempoRank}</small></span></td>
          </tr>)}</tbody>
        </table>
        {rows.length > shown && <div className="cbb-more"><button type="button" className="gl-link-button" onClick={() => setShown(shown + 100)}>Show more teams ({rows.length - shown} left)</button></div>}
        {rows.length === 0 && <div className="gl-empty"><strong>No team matches “{search}”.</strong>Try the school&apos;s name, like “Saint Mary&apos;s”.</div>}
      </div>
    </>}

    <div className="gl-footer-inner gl-card" style={{ padding: 18 }}>
      <p><b>Reading the rating</b>+20.0 means a team scores 20 more points per 100 possessions than it allows against an average opponent. At about 68 possessions a game, that&apos;s roughly a 13-point favorite over an average team on a neutral floor.</p>
      <p><b>Tempo</b>Possessions per game. It doesn&apos;t make a team better or worse; it sets how many points the game produces.</p>
      <p><b>Colors</b>Green cells rank near the top of Division I, red near the bottom. <Link href="/cbb/how-it-works" className="gl-link">How the model works</Link>.</p>
    </div>
  </div>;
}
