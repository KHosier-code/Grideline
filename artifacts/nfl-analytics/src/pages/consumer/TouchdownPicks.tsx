import { useState } from 'react';
import { CountUp } from '@/components/CountUp';
import { Link } from 'wouter';
import {
  getGetConsumerTouchdownsQueryKey, useGetConsumerTouchdowns, type ConsumerTouchdownPick,
} from '@workspace/api-client-react';
import { formatPrice } from '@/lib/pick-sheet';
import { impliedProbability, tdFairProbability } from '@/lib/market';
import { ConsumerLoading } from './consumer-ui';
import { TeamChip } from '@/components/GameBoard';

type Level = 'hi' | 'mid' | 'lo';
const BOOK_SHORT: Record<string, string> = { draftkings: 'DK', fanduel: 'FD' };
const pctOf = (value: number) => `${Math.round(value * 100)}%`;
const units = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}u`;
const pct = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
const fixed = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toFixed(digits);
const level = (value: number | null | undefined, high: number, low: number): Level =>
  value === null || value === undefined ? 'mid' : value >= high ? 'hi' : value <= low ? 'lo' : 'mid';
const LEVEL_TEXT: Record<Level, string> = { hi: 'Strong', mid: 'Average', lo: 'Weak' };

function kickoffText(iso: string | null) {
  if (!iso) return 'Time TBD';
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function factors(pick: ConsumerTouchdownPick) {
  const f = pick.factors;
  const receiver = (f.targetShare ?? 0) >= (f.carryShare ?? 0);
  return [
    receiver
      ? { title: 'Volume', value: fixed(f.targetsPerGame), unit: 'targets per game', detail: `${pct(f.targetShare)} of team targets`, level: level(f.targetShare, 0.24, 0.12) }
      : { title: 'Volume', value: fixed(f.carriesPerGame), unit: 'carries per game', detail: `${pct(f.carryShare)} of team carries${(f.targetsPerGame ?? 0) >= 2 ? `, plus ${fixed(f.targetsPerGame)} targets` : ''}`, level: level(f.carryShare, 0.5, 0.25) },
    { title: 'Red zone', value: fixed(f.redZoneTouchesPerGame), unit: 'touches inside the 20 per game',
      detail: (f.goalLineShare ?? 0) > 0 ? `${pct(f.goalLineShare)} of goal-line carries` : `${pct(f.redZoneShare)} of team red-zone looks`, level: level(f.redZoneTouchesPerGame, 2.5, 1) },
    { title: 'Team scoring', value: fixed(f.teamImpliedPoints), unit: 'points expected by Vegas',
      detail: `${pick.team} ${pick.isHome ? 'at home' : 'on the road'} vs ${pick.opponent}`, level: level(f.teamImpliedPoints, 26, 21.5) },
    { title: 'Matchup', value: f.opponentTdsAllowedRatio === null ? '—' : `${f.opponentTdsAllowedRatio.toFixed(2)}×`, unit: `league-average TDs allowed to ${pick.position}s`,
      detail: (f.opponentTdsAllowedRatio ?? 1) >= 1.15 ? `Soft against ${pick.position}s lately` : (f.opponentTdsAllowedRatio ?? 1) <= 0.85 ? `Tough against ${pick.position}s lately` : 'About average', level: level(f.opponentTdsAllowedRatio, 1.15, 0.85) },
    { title: 'Track record', value: pct(f.recentTdRate), unit: 'of recent games with a TD', detail: 'Last 17 games, adjusted for sample size', level: level(f.recentTdRate, 0.35, 0.15) },
  ];
}

function PickRow({ pick, rank, max }: { pick: ConsumerTouchdownPick; rank: number; max: number }) {
  const injury = pick.injuryStatus;
  return <details className="gl-card gl-td">
    <summary>
      <span className="gl-rank">{rank}</span>
      <span className="gl-who">
        <strong>{pick.name}</strong>
        <span>
          <span className="pos">{pick.position}</span><TeamChip team={pick.team} />{pick.isHome ? 'vs' : 'at'} {pick.opponent} · {kickoffText(pick.kickoff)}
          {pick.value && <span className="gl-flag value" title="Top-5 pick priced longer than our fair odds">Value</span>}
          {injury && <span className={`gl-flag${/^out$/i.test(injury) ? ' out' : ''}`}>{injury}</span>}
          {pick.scored !== null && <span className={`gl-scored ${pick.scored ? 'yes' : 'no'}`}>{pick.scored ? 'Scored ✓' : 'No TD'}</span>}
        </span>
      </span>
      <span className="gl-bar"><i><b style={{ width: `${((pick.probability / max) * 100).toFixed(1)}%` }} /></i><small>Fair {formatPrice(pick.fairOdds)}{pick.bookOdds && <> · Book <b>{formatPrice(pick.bookOdds.price)}</b> {BOOK_SHORT[pick.bookOdds.book] ?? pick.bookOdds.book}</>}</small></span>
      <span className="gl-pct">{Math.round(pick.probability * 100)}%</span>
    </summary>
    <div className="gl-why">
      {factors(pick).map(item => <div key={item.title} className="gl-factor">
        <span className="gl-label">{item.title}</span>
        <span className={`gl-level ${item.level}`}>{LEVEL_TEXT[item.level]}</span>
        <b>{item.value}</b>
        <p>{item.unit}</p>
        <p>{item.detail}</p>
      </div>)}
      {pick.bookOdds && <div className="gl-factor">
        <span className="gl-label">Sportsbooks</span>
        <b>{pick.bookOdds.books.map(item => `${BOOK_SHORT[item.book] ?? item.book} ${formatPrice(item.price)}`).join(' · ')}</b>
        <p>Book implies {pctOf(impliedProbability(pick.bookOdds.price))} with its cut, about {pctOf(tdFairProbability(pick.bookOdds.price))} without; we say {pctOf(pick.probability)}</p>
        {pick.expectedValue !== null && <p>At {formatPrice(pick.bookOdds.price)}, expected return {pick.expectedValue >= 0 ? '+' : '−'}{Math.abs(Math.round(pick.expectedValue * 100))}¢ per $1{pick.value ? ': a value pick.' : pick.rank > 5 ? '. Value picks come from our top 5 only.' : '.'}</p>}
        <p>Captured {new Date(pick.bookOdds.capturedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Prices move; check your book.</p>
      </div>}
    </div>
  </details>;
}

const POSITIONS = ['All', 'RB', 'WR', 'TE', 'QB'] as const;

export default function TouchdownPicks() {
  const [selected, setSelected] = useState<{ season: number; week: number } | undefined>();
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>('All');
  const [limit, setLimit] = useState(40);
  const query = useGetConsumerTouchdowns(selected, { query: { queryKey: getGetConsumerTouchdownsQueryKey(selected), staleTime: 60_000 } });
  const data = query.data;
  const picks = (data?.picks ?? []).filter(pick => position === 'All' || pick.position === position);
  const max = Math.max(0.01, ...(data?.picks ?? []).map(pick => pick.probability));
  const record = data?.record;
  const value = data?.valueRecord;

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{data?.season && data.week ? `${data.season} season · Week ${data.week}` : 'Anytime touchdown'}</p>
        <h1 className="gl-title">Touchdown <span>picks</span></h1>
        <p className="gl-lede">The chance each player scores a rushing or receiving touchdown this week. The ranking weighs how often the ball comes their way, their role near the goal line, how many points Vegas expects their team to score, and the defense they face.</p>
      </div>
      <div className="gl-stats" aria-label="Model accuracy">
        {data?.evaluation.topTenHitRate !== null && data?.evaluation.topTenHitRate !== undefined && <div className="gl-stat">
          <b><CountUp text={pct(data.evaluation.topTenHitRate)} /></b><small>of top-10 picks scored in testing</small>
        </div>}
        {record && record.weeksGraded > 0 && <div className="gl-stat">
          <b><CountUp text={`${record.topTenHits}/${record.topTenPicks}`} /></b><small>top-10 picks scored this season</small>
        </div>}
        {value && value.picks > 0 && <div className="gl-stat">
          <b><CountUp text={`${value.hits}/${value.picks} · ${units(value.units)}`} /></b><small>value picks this season, 1 unit each</small>
        </div>}
        {data?.evaluation.testedOn && <p className="gl-stats-note">Tested on {data.evaluation.testedOn}.</p>}
      </div>
    </header>

    <div className="gl-section-head">
      <div className="gl-filters" role="group" aria-label="Filter by position">
        {POSITIONS.map(item => <button key={item} type="button" aria-pressed={position === item} onClick={() => setPosition(item)}>{item}</button>)}
      </div>
      {data && data.weeks.length > 1 && <label className="gl-week-nav">
        <span className="gl-label">Week</span>
        <select id="td-week" value={data.season && data.week ? `${data.season}-${data.week}` : ''}
          onChange={event => { const [season, week] = event.target.value.split('-').map(Number); setSelected({ season, week }); }}>
          {data.weeks.map(item => <option key={`${item.season}-${item.week}`} value={`${item.season}-${item.week}`}>{item.season} Week {item.week}</option>)}
        </select>
      </label>}
    </div>

    {query.isLoading && <ConsumerLoading label="Loading touchdown picks…" />}
    {query.isError && <div className="gl-empty"><strong>We couldn&apos;t load touchdown picks.</strong>Refresh the page in a minute.</div>}
    {data && data.status === 'unavailable' && <div className="gl-empty"><strong>This week&apos;s touchdown picks aren&apos;t posted yet.</strong>Rankings update Tuesday, Thursday, Friday after the injury report, Saturday, Sunday morning, after the 1:00 inactives, and before the Sunday and Monday night games.</div>}

    {picks.length > 0 && <div className="gl-td-list">
      {picks.slice(0, limit).map((pick, index) => <PickRow key={pick.playerId} pick={pick} rank={index + 1} max={max} />)}
    </div>}
    {picks.length > limit && <button type="button" className="gl-card" style={{ padding: 12, fontWeight: 600, cursor: 'pointer', color: 'inherit' }} onClick={() => setLimit(limit + 60)}>Show more players ({picks.length - limit} left)</button>}

    {data?.generatedAt && <p className="gl-note">Updated {new Date(data.generatedAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Players ruled out on the injury report are removed; questionable players are flagged. Check final inactives before kickoff.</p>}

    <footer className="gl-card" style={{ padding: 18 }}>
      <div className="gl-footer-inner" style={{ padding: 0 }}>
        <p><b>Fair odds</b>The price that matches our probability. In testing on 2021 through 2026, our top 5 players each week scored 55% of the time (43% to 64% depending on the season), and our percentages matched how often players actually scored. The model averages five fits so one random draw can&apos;t move the board.</p>
        <p><b>Book</b>The best anytime-TD price at DraftKings or FanDuel when we last checked. Books keep a cut of roughly 20% on these bets, so compare our chance with the book&apos;s chance after the cut, not the raw price.</p>
        <p><b>Value</b>A top-5 pick whose best book price pays more than our probability says it should, so it returns money on average if our numbers are right. We haven&apos;t been able to test this against past prices, so we track every value pick here at the price we captured, 1 unit each. Prices move; check your book before betting.</p>
        <p><b>Red-zone touches</b>Targets plus carries inside the opponent&apos;s 20-yard line, per game over the player&apos;s last 8 games.</p>
        <p><b>Matchup</b>Touchdowns this defense allowed to the position over its last 8 games, compared with the league average. <Link href="/defense-vs-position" className="gl-link">See all matchups</Link>.</p>
      </div>
    </footer>
  </div>;
}
