import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerRecordQueryKey, useGetConsumerDashboard, useGetConsumerRecord, useGetConsumerTouchdowns,
  type ConsumerRecordLine,
} from '@workspace/api-client-react';
import { analyzeGame, biggestEdges, currentWeek, formatPrice, signed, type EdgePick, type GamePicks } from '@/lib/pick-sheet';
import { teamColor, teamTextColor } from '@/lib/team-colors';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

export function TeamChip({ team, large = false }: { team: string; large?: boolean }) {
  return <span className={`gl-chip${large ? ' lg' : ''}`} style={{ background: teamColor(team), color: teamTextColor(team) }}>{team}</span>;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const gameHref = (picks: GamePicks) => `/games/${picks.game.gameId}?season=${picks.game.season}&week=${picks.game.week}`;

function recordText(line: ConsumerRecordLine) {
  return `${line.wins}–${line.losses}${line.pushes ? `–${line.pushes}` : ''}`;
}
function winRate(line: ConsumerRecordLine) {
  const decided = line.wins + line.losses;
  return decided ? `${Math.round((line.wins / decided) * 100)}%` : '—';
}

function RecordStrip({ season }: { season: number | undefined }) {
  const params = season ? { season } : undefined;
  const record = useGetConsumerRecord(params, { query: { queryKey: getGetConsumerRecordQueryKey(params), enabled: season !== undefined } });
  const data = record.data;
  if (!data || data.graded === 0) {
    return <div className="gl-stats" aria-label="Season record">
      <div className="gl-stat"><b>0–0</b><small>Winners</small></div>
      <div className="gl-stat"><b>0–0</b><small>Against the spread</small></div>
      <p className="gl-stats-note">{record.isLoading ? 'Loading the record…' : 'The record fills in as this season’s locked picks are graded.'}</p>
    </div>;
  }
  return <div className="gl-stats" aria-label="Season record">
    <div className="gl-stat"><b>{recordText(data.winners)}</b><small>Winners · {winRate(data.winners)}</small></div>
    <div className="gl-stat"><b>{recordText(data.spread)}</b><small>Against the spread · {winRate(data.spread)}</small></div>
    <p className="gl-stats-note">{data.season} record from {data.graded} graded games · <Link href="/performance" className="gl-link">Full record</Link></p>
  </div>;
}

function EdgeCard({ item }: { item: EdgePick }) {
  const { picks, kind, edge } = item;
  const { game, projection } = picks;
  const home = game.matchup.home.abbreviation;
  const away = game.matchup.away.abbreviation;
  const pickTeam = kind === 'spread' && picks.spread ? (picks.spread.side === 'home' ? home : away) : null;
  return <Link href={gameHref(picks)} className="gl-card gl-edge">
    <div className="gl-edge-top">
      <span>{away} at {home} · {game.kickoffTime ? `${new Date(game.kickoffTime).toLocaleDateString('en-US', { weekday: 'short' })} ${time(game.kickoffTime)}` : 'TBD'}</span>
      <span className={`gl-pill ${edge >= 3 ? 'strong' : edge >= 1.5 ? 'lean' : 'small'}`}>+{edge.toFixed(1)} pts</span>
    </div>
    <div className="gl-edge-pick">
      {kind === 'spread' && picks.spread && pickTeam
        ? <><TeamChip team={pickTeam} large /><span>{signed(picks.spread.line)}</span></>
        : picks.total && <span>{picks.total.side} {picks.total.line}</span>}
    </div>
    <div className="gl-edge-compare">
      <div><span className="gl-label">Sportsbook</span><b>{kind === 'spread' && picks.spread && pickTeam ? `${pickTeam} ${signed(picks.spread.line)}` : picks.total?.line}</b></div>
      <div><span className="gl-label">Gridline</span><b>{kind === 'spread' && projection
        ? `${projection.margin > 0 ? home : away} by ${Math.abs(projection.margin).toFixed(1)}`
        : projection?.total.toFixed(1)}</b></div>
    </div>
    {projection && <p className="gl-note">Projected score: {away} {projection.away.toFixed(1)}, {home} {projection.home.toFixed(1)}.</p>}
  </Link>;
}

function Result({ result }: { result: 'win' | 'loss' | 'push' | null }) {
  if (!result) return null;
  return <span className={`gl-pill ${result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'small'}`}>{result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : 'Push'}</span>;
}

function pickResults(picks: GamePicks) {
  const final = picks.game.finalScore;
  if (!final) return { spread: null, total: null, winner: null };
  const margin = final.home - final.away;
  const side = (pickSide: 'home' | 'away', value: number) => value === 0 ? 'push' as const : (value > 0) === (pickSide === 'home') ? 'win' as const : 'loss' as const;
  return {
    winner: picks.winner ? side(picks.winner.side, margin) : null,
    spread: picks.spread ? side(picks.spread.side, margin + picks.spread.homeLine) : null,
    total: picks.total ? (() => {
      const over = final.home + final.away - picks.total!.line;
      return over === 0 ? 'push' as const : (over > 0) === (picks.total!.side === 'Over') ? 'win' as const : 'loss' as const;
    })() : null,
  };
}

function GameRow({ picks, now }: { picks: GamePicks; now: number }) {
  const { game, projection, spread, total, moneyline, winner } = picks;
  const home = game.matchup.home;
  const away = game.matchup.away;
  const final = game.finalScore;
  const started = game.kickoffTime ? Date.parse(game.kickoffTime) <= now : false;
  const results = pickResults(picks);
  const rows = [
    { side: 'away' as const, team: away, projected: projection?.away, actual: final?.away, probability: projection ? 1 - projection.homeWin : null },
    { side: 'home' as const, team: home, projected: projection?.home, actual: final?.home, probability: projection?.homeWin ?? null },
  ];
  const favored = winner?.side;
  return <Link href={gameHref(picks)} className="gl-board-row" aria-label={`${away.name} at ${home.name}`}>
    <span className="gl-time">{final ? 'Final' : started ? 'Live' : game.kickoffTime ? time(game.kickoffTime) : 'TBD'}</span>
    <div className="gl-teams">
      {rows.map(row => <div key={row.side} className={`gl-team${favored === row.side ? ' fav' : ''}`}>
        <TeamChip team={row.team.abbreviation} />
        <span className="name">{row.team.name}</span>
        <span className="wp">{row.probability !== null ? percent(row.probability) : ''}</span>
        <span className="score">{final ? <span className="gl-final">{row.actual}</span> : row.projected !== undefined ? row.projected.toFixed(1) : '—'}</span>
      </div>)}
      {!projection && <span className="gl-note">Projection is being prepared for this game.</span>}
      {final && projection && <span className="gl-note">We projected {away.abbreviation} {projection.away.toFixed(1)}, {home.abbreviation} {projection.home.toFixed(1)}</span>}
    </div>
    <div className="gl-mkt">
      <span className="gl-label m-label">Spread</span>
      <span className="line">{spread ? <>Line <b>{home.abbreviation} {signed(spread.homeLine)}</b></> : game.market?.spread ? <>Line <b>{home.abbreviation} {signed(game.market.spread.point ?? 0)}</b></> : 'No line yet'}</span>
      <span className="gl-result">{spread && <span className={`gl-pill ${spread.strength}`}>{spread.side === 'home' ? home.abbreviation : away.abbreviation} {signed(spread.line)} · +{spread.edge.toFixed(1)}</span>}<Result result={results.spread} /></span>
    </div>
    <div className="gl-mkt">
      <span className="gl-label m-label">Total</span>
      <span className="line">{game.market?.total ? <>Line <b>{game.market.total.point}</b></> : 'No line yet'}{projection ? <> · Ours {projection.total.toFixed(1)}</> : null}</span>
      <span className="gl-result">{total && <span className={`gl-pill ${total.strength}`}>{total.side} · +{total.edge.toFixed(1)}</span>}<Result result={results.total} /></span>
    </div>
    <div className="gl-mkt">
      <span className="gl-label m-label">Moneyline</span>
      <span className="line">{moneyline && winner ? <>{winner.side === 'home' ? home.abbreviation : away.abbreviation} <b>{moneyline.price !== null ? formatPrice(moneyline.price) : 'no price'}</b></> : 'No pick yet'}</span>
      <span className="gl-result">{winner && <span className={`gl-pill ${moneyline?.edge !== null && moneyline?.edge !== undefined && moneyline.edge >= 0.05 ? 'strong' : 'small'}`}>{winner.side === 'home' ? home.abbreviation : away.abbreviation} wins {percent(winner.probability)}</span>}<Result result={results.winner} /></span>
    </div>
    <span className="gl-go" aria-hidden="true">›</span>
  </Link>;
}

function TouchdownTeaser() {
  const touchdowns = useGetConsumerTouchdowns();
  const now = useConsumerNow();
  const picks = (touchdowns.data?.picks ?? []).filter(pick => !pick.kickoff || Date.parse(pick.kickoff) > now).slice(0, 5);
  if (!picks.length) return null;
  return <section className="gl-section" aria-labelledby="td-teaser">
    <div className="gl-section-head"><h2 id="td-teaser">Top touchdown picks</h2><Link href="/touchdowns" className="gl-link">All TD picks ›</Link></div>
    <div className="gl-card gl-board">
      {picks.map((pick, index) => <Link key={pick.playerId} href="/touchdowns" className="gl-board-row gl-td-teaser-row">
        <span className="gl-rank">{index + 1}</span>
        <span className="gl-who"><strong>{pick.name}</strong><span><span className="pos">{pick.position}</span><TeamChip team={pick.team} />{pick.isHome ? 'vs' : 'at'} {pick.opponent}</span></span>
        <span className="gl-pct">{Math.round(pick.probability * 100)}%</span>
      </Link>)}
    </div>
  </section>;
}

export default function PickSheet() {
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000, refetchInterval: 120_000 } });
  const now = useConsumerNow();
  const [minimumEdge, setMinimumEdge] = useState(0);
  const week = useMemo(() => currentWeek(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const analyzed = useMemo(() => (week?.games ?? []).map(analyzeGame), [week]);
  const edges = useMemo(() => biggestEdges(analyzed, now), [analyzed, now]);
  const linesAt = analyzed.map(item => item.game.market?.spread?.capturedAt ?? item.game.market?.total?.capturedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const days = useMemo(() => {
    const groups = new Map<string, GamePicks[]>();
    for (const item of analyzed) {
      if (item.bestEdge < minimumEdge) continue;
      const key = item.game.kickoffTime ? dayLabel(item.game.kickoffTime) : 'Time to be announced';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [analyzed, minimumEdge]);

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{week ? `${week.season} season · Week ${week.week}` : 'NFL picks'}</p>
        <h1 className="gl-title">This week&apos;s <span>picks</span></h1>
        <p className="gl-lede">Our model&apos;s projected score for every game next to the sportsbook line. Picks lock 30 minutes before kickoff and are graded after the final whistle.</p>
      </div>
      <RecordStrip season={week?.season} />
    </header>

    {dashboard.isLoading && <ConsumerLoading label="Loading this week's games…" />}
    {dashboard.isError && <div className="gl-empty"><strong>We couldn&apos;t load this week&apos;s games.</strong>Refresh the page in a minute. If it keeps happening, the schedule feed may be updating.</div>}

    {edges.length > 0 && <section className="gl-section" aria-labelledby="edges-heading">
      <div className="gl-section-head"><h2 id="edges-heading">Biggest edges</h2><p>Games where our number is furthest from the line</p></div>
      <div className="gl-edges">{edges.map(item => <EdgeCard key={`${item.picks.game.gameId}-${item.kind}`} item={item} />)}</div>
    </section>}

    {week && <section className="gl-section" aria-labelledby="board-heading">
      <div className="gl-section-head">
        <h2 id="board-heading">Every game</h2>
        <div className="gl-filters" role="group" aria-label="Filter games by edge">
          {[{ label: 'All games', value: 0 }, { label: 'Edge 1.5+ pts', value: 1.5 }, { label: 'Edge 3+ pts', value: 3 }].map(option =>
            <button key={option.value} type="button" aria-pressed={minimumEdge === option.value} onClick={() => setMinimumEdge(option.value)}>{option.label}</button>)}
        </div>
      </div>
      {linesAt && <p className="gl-note">Lines from DraftKings or FanDuel as of {new Date(linesAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Lines move, so check your book before betting.</p>}
      {days.length === 0 && <div className="gl-empty"><strong>No games match this filter.</strong>Try a smaller edge.</div>}
      {days.map(([day, items]) => <div key={day} className="gl-day">
        <h3 className="gl-label">{day}</h3>
        <div className="gl-card gl-board">
          <div className="gl-board-head gl-label"><span>Kickoff</span><span>Projected score</span><span>Spread</span><span>Total</span><span>Moneyline</span><span /></div>
          {items.map(item => <GameRow key={item.game.gameId} picks={item} now={now} />)}
        </div>
      </div>)}
    </section>}

    {!dashboard.isLoading && !dashboard.isError && !week && <div className="gl-empty"><strong>No games on the schedule right now.</strong>Picks return when the next week&apos;s schedule is posted. <Link href="/games" className="gl-link">Browse past games</Link>.</div>}

    <TouchdownTeaser />

    <footer className="gl-card" style={{ padding: 18 }}>
      <div className="gl-footer-inner" style={{ padding: 0 }}>
        <p><b>What the edge means</b>The gap in points between our projection and the sportsbook line. The bigger the gap, the more we disagree with the market.</p>
        <p><b>How good is the model?</b>Tested on 2023–2025, our spread picks went 49.9% against closing lines, and simply taking the Vegas favorite picked more winners than we did. Treat these as a second opinion, not a betting edge. We don&apos;t make over/under picks until our totals model is good enough.</p>
        <p><b>How picks are graded</b>Each game&apos;s pick is the one saved 30 minutes before kickoff, graded against the final score. A projection exactly on the line is not a pick.</p>
      </div>
    </footer>
  </div>;
}
