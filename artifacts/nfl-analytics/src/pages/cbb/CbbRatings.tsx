import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';
import { rankCellStyle } from '@/lib/team-colors';
import {
  CBB_FACTORS, defaultProfileSeason, formatRate, formatWL, seasonLabel,
  type CbbFactorKey, type CbbProfile, type CbbTeam,
} from '@/lib/cbb';
import { useCbb } from '@/lib/cbb-data';
import { CbbLogo } from './CbbGames';
import './cbb.css';

type View = 'ratings' | 'offense' | 'defense' | 'shooting' | 'schedule';
type ProfileSeason = 'current' | 'last';
/** A sortable column: lower sort value first, missing values last. */
type Column = { key: string; label: string; hint?: string; sort: (team: CbbTeam) => number | null | undefined; cell: (team: CbbTeam) => ReactNode };

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'ratings', label: 'Ratings' },
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'shooting', label: 'Shooting' },
  { key: 'schedule', label: 'Schedule' },
];
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;
const PAGE = 50;

function RankCell({ rank, value, teams }: { rank: number | null | undefined; value: string; teams: number }) {
  return <td className="gl-rank-cell"><span style={rank ? rankCellStyle(rank, teams) : undefined}><b>{value}</b>{rank ? <small>#{rank}</small> : null}</span></td>;
}

function Change({ team }: { team: CbbTeam }) {
  const change = team.preseasonRank - team.rank;
  if (!change) return <span className="gl-change flat">–</span>;
  return <span className={`gl-change ${change > 0 ? 'up' : 'down'}`} title={`Preseason #${team.preseasonRank}`}>{change > 0 ? '▲' : '▼'}{Math.abs(change)}</span>;
}

export default function CbbRatings() {
  const { query, report } = useCbb();
  const [view, setView] = useState<View>('ratings');
  const [sort, setSort] = useState('rank');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [season, setSeason] = useState<ProfileSeason | null>(null);
  const all = report?.teams ?? [];
  const teamCount = all.length || 362;
  const profileSeason = season ?? defaultProfileSeason(report?.gamesPlayed ?? 0);
  const profile = (team: CbbTeam): CbbProfile | null | undefined => profileSeason === 'current' ? team.profile : team.lastSeason;
  const preseason = report && report.gamesPlayed === 0;
  const maxNet = Math.max(1, ...all.map(team => Math.abs(team.net)));

  const factor = (side: 'off' | 'def', key: CbbFactorKey, label: string, hint: string): Column => ({
    key: `${side}-${key}`, label, hint,
    sort: team => profile(team)?.[side][key]?.[1],
    cell: team => {
      const entry = profile(team)?.[side][key];
      // Three-point rate is a style: shade it neutrally.
      return key === 'three_rate'
        ? <td className="gl-rank-cell"><span><b>{formatRate(entry?.[0])}</b>{entry?.[1] ? <small>#{entry[1]}</small> : null}</span></td>
        : <RankCell rank={entry?.[1]} value={formatRate(entry?.[0])} teams={teamCount} />;
    },
  });
  const meta = (key: CbbFactorKey) => CBB_FACTORS.find(item => item.key === key)!;

  const columns: Column[] = view === 'ratings' ? [
    { key: 'rating', label: 'Rating', sort: team => team.rank, cell: team => <td className="gl-rating-cell">
      <span className="gl-rating-value">{signed(team.net)}</span>
      <span className="gl-rating-bar" aria-hidden="true"><i className={team.net >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(team.net) / maxNet) * 50}%` }} /></span>
    </td> },
    { key: 'offense', label: 'Offense', hint: 'Points scored per 100 possessions against an average defense', sort: team => team.offenseRank, cell: team => <RankCell rank={team.offenseRank} value={team.offense.toFixed(1)} teams={teamCount} /> },
    { key: 'defense', label: 'Defense', hint: 'Points allowed per 100 possessions against an average offense (lower is better)', sort: team => team.defenseRank, cell: team => <RankCell rank={team.defenseRank} value={team.defense.toFixed(1)} teams={teamCount} /> },
    { key: 'tempo', label: 'Tempo', hint: 'Possessions per 40 minutes', sort: team => team.tempoRank, cell: team => <td className="gl-rank-cell"><span><b>{team.tempo.toFixed(1)}</b><small>#{team.tempoRank}</small></span></td> },
  ] : view === 'offense' ? (['efg', 'tov', 'orb', 'ftr'] as const).map(key => factor('off', key, meta(key).short, meta(key).offense))
    : view === 'defense' ? (['efg', 'tov', 'orb', 'ftr'] as const).map(key => factor('def', key, meta(key).short, meta(key).defense ?? ''))
    : view === 'shooting' ? [
      factor('off', 'three_rate', '3PA%', meta('three_rate').offense),
      factor('off', 'three_pct', '3P%', meta('three_pct').offense),
      factor('off', 'two_pct', '2P%', meta('two_pct').offense),
      factor('off', 'ft_pct', 'FT%', meta('ft_pct').offense),
      factor('def', 'three_pct', 'Opp 3P%', meta('three_pct').defense ?? ''),
      factor('def', 'two_pct', 'Opp 2P%', meta('two_pct').defense ?? ''),
    ] : [
      { key: 'sos', label: 'Schedule', hint: 'Average rating of opponents played (rank 1 = toughest)', sort: team => team.sosRank,
        cell: team => <RankCell rank={team.sosRank} value={team.sos === null || team.sos === undefined ? '—' : signed(team.sos)} teams={teamCount} /> },
      { key: 'top50', label: 'vs Top 50', hint: 'Record against teams in our top 50', sort: team => team.vsTop50 ? -(team.vsTop50[0] - team.vsTop50[1]) : null, cell: team => <td>{formatWL(team.vsTop50)}</td> },
      { key: 'top100', label: 'vs Top 100', hint: 'Record against teams in our top 100', sort: team => team.vsTop100 ? -(team.vsTop100[0] - team.vsTop100[1]) : null, cell: team => <td>{formatWL(team.vsTop100)}</td> },
      { key: 'last10', label: 'Last 10', sort: team => team.last10 ? -(team.last10[0] - team.last10[1]) : null, cell: team => <td>{formatWL(team.last10)}</td> },
    ];
  const activeSort = sort === 'rank' || columns.some(column => column.key === sort) ? sort : 'rank';

  const needle = search.trim().toLowerCase();
  const sorter = columns.find(column => column.key === activeSort)?.sort ?? ((team: CbbTeam) => team.rank);
  const sortValue = (team: CbbTeam) => sorter(team) ?? Number.POSITIVE_INFINITY;
  const rows = all.filter(team => !needle || `${team.name} ${team.short} ${team.abbr ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => sortValue(a) - sortValue(b) || a.rank - b.rank);

  const header = (key: string, label: string, hint?: string) => <th key={key} scope="col" aria-sort={activeSort === key ? 'ascending' : 'none'}>
    <button type="button" onClick={() => setSort(key)} title={hint}>{label}{activeSort === key ? ' ↓' : ''}</button>
  </th>;
  const profileView = view === 'offense' || view === 'defense' || view === 'shooting';
  const hasCurrent = all.some(team => team.profile);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{report ? `College basketball · ${seasonLabel(report.season)}${preseason ? ' · preseason' : ''}` : 'College basketball'}</p>
        <h1 className="gl-title">College <span>Power Ratings</span></h1>
        <p className="gl-lede">All {teamCount} Division I teams ranked by how many points per 100 possessions better or worse they are than an average team, adjusted for opponents and home court. The other tabs show why: the Four Factors that decide games, each team&apos;s shooting, and who they&apos;ve played.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading ratings…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the ratings.</strong>Refresh the page in a minute.</div>}
    {query.data?.status === 'unavailable' && <div className="gl-empty"><strong>Ratings aren&apos;t posted yet.</strong>They update every morning during the season.</div>}

    {report && <>
      <div className="gl-section-head">
        <div className="gl-filters" role="group" aria-label="Choose a view">
          {VIEWS.map(item => <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => setView(item.key)}>{item.label}</button>)}
        </div>
        {profileView && <div className="gl-filters" role="group" aria-label="Choose a season">
          <button type="button" aria-pressed={profileSeason === 'current'} disabled={!hasCurrent} onClick={() => setSeason('current')}>This season</button>
          <button type="button" aria-pressed={profileSeason === 'last'} onClick={() => setSeason('last')}>Last season ({seasonLabel(report.season - 1)})</button>
        </div>}
      </div>
      <div className="gl-section-head">
        <label className="cbb-search">
          <span className="gl-label">Find a team</span>
          <input type="search" value={search} placeholder="Duke, Gonzaga…" onChange={event => { setSearch(event.target.value); setShown(PAGE); }} />
        </label>
        <p className="cbb-muted">{profileView
          ? `${profileSeason === 'current' ? 'This season' : `Last season (${seasonLabel(report.season - 1)})`} · adjusted for opponents · rank 1 = best in Division I${view === 'shooting' ? ' (3PA%: 1 = shoots the most threes)' : ''}`
          : `${report.gamesPlayed.toLocaleString()} games played · average ${report.model.averageEfficiency} points per 100 possessions · home court worth ${report.model.homeCourt.toFixed(1)} points`}</p>
      </div>
      <div className="gl-card gl-table-wrap">
        <table className="gl-table gl-ratings cbb-ratings">
          <thead><tr>
            {header('rank', 'Rank')}
            <th scope="col">Team</th>
            {columns.map(column => header(column.key, column.label, column.hint))}
          </tr></thead>
          <tbody>{rows.slice(0, shown).map(team => <tr key={team.id}>
            <td className="gl-rank-num"><b>{team.rank}</b>{!preseason && view === 'ratings' && <Change team={team} />}</td>
            <td className="gl-team-cell"><CbbLogo team={team} /><span><b>{team.name}</b><small>{team.wins + team.losses ? `${team.wins}-${team.losses}` : 'No games yet'}</small></span></td>
            {columns.map(column => <Fragment key={column.key}>{column.cell(team)}</Fragment>)}
          </tr>)}</tbody>
        </table>
        {rows.length > shown && <div className="cbb-more"><button type="button" className="gl-link-button" onClick={() => setShown(shown + 100)}>Show more teams ({rows.length - shown} left)</button></div>}
        {rows.length === 0 && <div className="gl-empty"><strong>No team matches “{search}”.</strong>Try the school&apos;s name, like “Saint Mary&apos;s”.</div>}
      </div>
    </>}

    <div className="gl-footer-inner gl-card" style={{ padding: 18 }}>
      {view === 'ratings' && <>
        <p><b>Reading the rating</b>+20.0 means a team scores 20 more points per 100 possessions than it allows against an average opponent. At about 68 possessions a game, that&apos;s roughly a 13-point favorite over an average team on a neutral floor.</p>
        <p><b>Tempo</b>Possessions per game. It doesn&apos;t make a team better or worse; it sets how many points the game produces.</p>
      </>}
      {(view === 'offense' || view === 'defense') && <>
        <p><b>The Four Factors</b>Shooting (eFG%), turnovers (TO%), offensive rebounding (OR%) and getting to the line (FTR) explain most of why teams win. Shooting matters most, then turnovers, then rebounding, then free throws.</p>
        <p><b>Adjusted for opponents</b>Each number is what a team did against the teams it played, corrected for how good those teams are at that same thing.</p>
      </>}
      {view === 'shooting' && <p><b>Shot profile</b>3PA% is a style: how much of a team&apos;s offense comes from threes. Teams that live on threes swing more from game to game.</p>}
      {view === 'schedule' && <p><b>Schedule</b>Strength of schedule is the average rating of the opponents a team has played. Records against our top 50 and top 100 show how a team does against good competition.</p>}
      <p><b>Colors</b>Green cells rank near the top of Division I, red near the bottom. <Link href="/cbb/how-it-works" className="gl-link">How the model works</Link>.</p>
    </div>
  </div>;
}

