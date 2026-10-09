import { useState } from 'react';
import { Link } from 'wouter';
import { getGetConsumerReceiptsQueryKey, useGetConsumerReceipts, type ConsumerReceipts } from '@workspace/api-client-react';
import { consistentHomeWin, lineText, vegasLineText } from '@/lib/pick-sheet';
import { ConsumerLoading } from './consumer-ui';

/** Each weekly-picks run commits what it sent to this branch (see .github/workflows/weekly-picks.yml). */
const RECEIPTS_URL = 'https://github.com/KHosier-code/Grideline/tree/receipts';

const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (value: number) => `${Math.round(value * 100)}%`;

function Result({ value }: { value: 'win' | 'loss' | 'push' | boolean | null | undefined }) {
  if (value === null || value === undefined) return <span className="gl-muted">Pending</span>;
  const good = value === true || value === 'win';
  if (value === 'push') return <span className="gl-muted">Tie</span>;
  return <span className={good ? 'gl-good' : 'gl-bad'}>{good ? '✓' : '✗'}</span>;
}

type Week = { week: number; games: ConsumerReceipts['games']; touchdowns: ConsumerReceipts['touchdowns'] };

function WeekReceipts({ season, week }: { season: number; week: Week }) {
  const graded = week.games.filter(game => game.winner === 'win' || game.winner === 'loss');
  const right = graded.filter(game => game.winner === 'win').length;
  const tdGraded = week.touchdowns.filter(pick => pick.scored !== null);
  const tdHits = tdGraded.filter(pick => pick.scored).length;
  return <details className="gl-card gl-receipt-week">
    <summary>
      <b>Week {week.week}</b>
      <span>Winners: <strong>{graded.length ? `${right}–${graded.length - right}` : 'pending'}</strong></span>
      <span>TD top 5: <strong>{tdGraded.length ? `${tdHits}/${tdGraded.length}` : 'pending'}</strong></span>
      <a className="gl-link" href={`${RECEIPTS_URL}/${season}/week-${String(week.week).padStart(2, '0')}`} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Raw files ›</a>
    </summary>
    <div className="gl-table-wrap">
      <table className="gl-table">
        <caption className="gl-table-caption">Game projections<small>last version received before kickoff</small></caption>
        <thead><tr><th scope="col">Game</th><th scope="col">Locked in</th><th scope="col">Ours</th><th scope="col">Line then</th><th scope="col">Final</th><th scope="col">Winner</th></tr></thead>
        <tbody>{week.games.map(game => <tr key={game.gameId}>
          <td>{game.awayTeam} at {game.homeTeam}</td>
          <td className="gl-receipt-meta">{stamp(game.lockedAt)}</td>
          <td><b>{lineText(game.projectedMargin, game.homeTeam, game.awayTeam)}</b> <small className="gl-muted">{pct(game.projectedMargin > 0 ? consistentHomeWin(game.projectedMargin, game.homeWinProbability) : 1 - consistentHomeWin(game.projectedMargin, game.homeWinProbability))}</small></td>
          <td>{game.line ? <>{vegasLineText(game.line.homeLine, game.homeTeam, game.awayTeam)} <small className="gl-muted">{game.line.sportsbook}</small></> : '—'}</td>
          <td>{game.final ? `${game.awayTeam} ${game.final.away}, ${game.homeTeam} ${game.final.home}` : '—'}</td>
          <td><Result value={game.winner} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    {week.touchdowns.length > 0 && <div className="gl-table-wrap">
      <table className="gl-table">
        <caption className="gl-table-caption">Touchdown top 5</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Chance</th><th scope="col">Locked in</th><th scope="col">Scored</th></tr></thead>
        <tbody>{week.touchdowns.map(pick => <tr key={pick.playerId}>
          <td>{pick.rank}</td>
          <td><b>{pick.name}</b> <small className="gl-muted">{pick.position} · {pick.team} vs {pick.opponent}</small></td>
          <td>{pct(pick.probability)}</td>
          <td className="gl-receipt-meta">{stamp(pick.lockedAt)}</td>
          <td><Result value={pick.scored} /></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </details>;
}

export default function Receipts() {
  const [season, setSeason] = useState<number | undefined>(undefined);
  const params = season ? { season } : undefined;
  const query = useGetConsumerReceipts(params, { query: { queryKey: getGetConsumerReceiptsQueryKey(params), staleTime: 5 * 60_000 } });
  const data = query.data;
  const weeks = new Map<number, Week>();
  for (const game of data?.games ?? []) {
    if (game.week === null) continue;
    const week = weeks.get(game.week) ?? { week: game.week, games: [], touchdowns: [] };
    week.games.push(game);
    weeks.set(game.week, week);
  }
  for (const pick of data?.touchdowns ?? []) {
    const week = weeks.get(pick.week) ?? { week: pick.week, games: [], touchdowns: [] };
    week.touchdowns.push(pick);
    weeks.set(pick.week, week);
  }
  const ordered = [...weeks.values()].sort((a, b) => b.week - a.week);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">Receipts</p>
        <h1 className="gl-title">Every pick, <span>locked before kickoff</span></h1>
        <p className="gl-lede">Each projection and touchdown pick below is the version our site received before the game started, stamped with the time it arrived. We never edit them afterward, and every run is also saved to a <a className="gl-link" href={RECEIPTS_URL} target="_blank" rel="noreferrer">public GitHub branch</a> with its own timestamp, so you can check we posted it first. Wins and losses are graded automatically from final scores.</p>
      </div>
    </header>

    {query.isLoading && <ConsumerLoading label="Loading receipts…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load the receipts.</strong>Refresh the page in a minute.</div>}

    {data && data.seasons.length > 1 && <label className="gl-label">Season{' '}
      <select value={data.season ?? ''} onChange={event => setSeason(Number(event.target.value))}>
        {data.seasons.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>}

    {data?.status === 'available' && data.season !== null && <section className="gl-section gl-receipts" aria-labelledby="receipts-weeks">
      <div className="gl-section-head"><h2 id="receipts-weeks">{data.season} season</h2><p>Newest week first. Open a week to see each pick.</p></div>
      <div className="gl-receipt-weeks">{ordered.map(week => <WeekReceipts key={week.week} season={data.season!} week={week} />)}</div>
    </section>}

    {data && data.status !== 'available' && <div className="gl-empty"><strong>No locked picks yet.</strong>They appear here once the weekly model runs.</div>}

    {data && data.runs.length > 0 && <details className="gl-card gl-receipt-week">
      <summary><b>Run log</b><span className="gl-receipt-meta">Every model run the site received ({data.runs.length})</span></summary>
      <div className="gl-table-wrap"><table className="gl-table">
        <thead><tr><th scope="col">Model</th><th scope="col">Week</th><th scope="col">Run at</th><th scope="col">Received</th></tr></thead>
        <tbody>{data.runs.map(run => <tr key={`${run.kind}-${run.week}-${run.generatedAt}`}>
          <td>{run.kind === 'games' ? 'Game projections' : 'Touchdown picks'}</td><td>{run.week}</td>
          <td className="gl-receipt-meta">{stamp(run.generatedAt)}</td><td className="gl-receipt-meta">{stamp(run.receivedAt)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}

    <p className="gl-note">A projection only counts for a game if the site received it before kickoff; a run that arrives late is kept in the log but never graded. See <Link href="/performance" className="gl-link">Model Performance</Link> for the season totals.</p>
  </div>;
}
