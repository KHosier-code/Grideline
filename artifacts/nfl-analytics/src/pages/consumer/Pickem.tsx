import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  getGetConsumerDashboardQueryKey, getGetConsumerGameProjectionsQueryKey, getGetConsumerPowerRatingsQueryKey,
  useGetConsumerDashboard, useGetConsumerGameProjections, useGetConsumerPowerRatings,
} from '@workspace/api-client-react';
import { TeamLogo } from '@/components/TeamLogo';
import { PoolStrategy, SurvivorPlanner } from '@/components/PoolTools';
import { normalizeTeam } from '@/lib/parlay';
import { shareCardImage } from '@/lib/share-image';
import { HundredGrid, Simulator, TeamSide, abbr, other, toPoolGame, type PoolGame, type Side } from '@/components/GameSim';
import { buildGameView, currentWeek } from '@/lib/pick-sheet';
import { groupBySlate, slateFor } from '@/lib/slates';
import { matchupAccents } from '@/lib/team-colors';
import { ConsumerLoading, useConsumerNow } from './consumer-ui';

function PoolRow({ game, points, records, now }: { game: PoolGame; points: number; records: Map<string, string>; now: number }) {
  const started = game.view.game.kickoffTime ? Date.parse(game.view.game.kickoffTime) <= now : false;
  const final = game.view.game.finalScore;
  const kickoff = game.view.game.kickoffTime
    ? new Date(game.view.game.kickoffTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'TBD';
  const disagree = game.modelPick !== null && game.modelPick !== game.pick && game.source !== 'gridline';
  const [winColor, lossColor] = matchupAccents(abbr(game, game.pick), abbr(game, other(game.pick)));
  const winner: Side | null = final ? (final.home > final.away ? 'home' : final.away > final.home ? 'away' : null) : null;
  return <details className={`gl-card gl-pool-row${started ? ' locked' : ''}`}>
    <summary>
      <span className="gl-pool-points" title="Confidence points">{points}</span>
      <span className="gl-pool-matchup">
        <TeamSide game={game} side="away" records={records} />
        <span className="gl-pool-at">@</span>
        <TeamSide game={game} side="home" records={records} />
      </span>
      <span className="gl-pool-meta">
        <span>{final ? `Final ${final.away}-${final.home}` : started ? 'Live' : kickoff}</span>
        {final && winner && <span className={`gl-pill ${winner === game.pick ? 'win' : 'loss'}`}>{winner === game.pick ? 'Pick right' : 'Upset'}</span>}
        {!final && disagree && <span className="gl-flag" title="Gridline's model picks the other side">Gridline: {abbr(game, game.modelPick!)}</span>}
      </span>
      <span className="gl-pool-wins"><b>{game.wins}</b><small>of 100</small></span>
      <HundredGrid wins={game.wins} winColor={winColor} lossColor={lossColor} label={`${abbr(game, game.pick)} wins ${game.wins} of 100`} />
      <span className="gl-go" aria-hidden="true">›</span>
    </summary>
    <Simulator game={game} />
  </details>;
}

export default function Pickem() {
  const dashboard = useGetConsumerDashboard({ query: { queryKey: getGetConsumerDashboardQueryKey(), staleTime: 60_000 } });
  const now = useConsumerNow();
  const week = useMemo(() => currentWeek(dashboard.data?.games ?? [], now), [dashboard.data, now]);
  const params = week ? { season: week.season } : undefined;
  const projections = useGetConsumerGameProjections(params, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(params), enabled: week !== null } });
  const ratings = useGetConsumerPowerRatings(undefined, { query: { queryKey: getGetConsumerPowerRatingsQueryKey(), staleTime: 5 * 60_000 } });
  const [slate, setSlate] = useState('all');
  const [copied, setCopied] = useState(false);

  const records = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of ratings.data?.teams ?? []) {
      if (!team.record) continue;
      const text = `${team.record.wins}-${team.record.losses}${team.record.ties ? `-${team.record.ties}` : ''}`;
      for (const key of [team.team, team.team === 'LA' ? 'LAR' : '', team.team === 'WAS' ? 'WSH' : ''].filter(Boolean)) map.set(key, text);
    }
    return map;
  }, [ratings.data]);

  const all = useMemo(() => {
    const byGame = new Map((projections.data?.games ?? []).map(projection => [projection.gameId, projection]));
    return (week?.games ?? []).map(game => toPoolGame(buildGameView(game, byGame.get(game.gameId))))
      .filter((game): game is PoolGame => game !== null);
  }, [week, projections.data]);
  const teamRatings = useMemo(() => new Map((ratings.data?.teams ?? []).map(team => [normalizeTeam(team.team), team.rating])), [ratings.data]);
  const slates = groupBySlate(all, game => game.view.game.kickoffTime);
  const selected = slate === 'all' ? all : all.filter(game => slateFor(game.view.game.kickoffTime).key === slate);
  // Confidence points come from the whole week's ranking, so a slate filter only hides rows.
  const byConfidence = (a: PoolGame, b: PoolGame) => b.wins - a.wins || a.view.game.gameId.localeCompare(b.view.game.gameId);
  const weekPoints = new Map([...all].sort(byConfidence).map((game, index) => [game.view.game.gameId, all.length - index]));
  const ranked = [...selected].sort(byConfidence);
  const points = (game: PoolGame) => weekPoints.get(game.view.game.gameId) ?? 0;
  const safest = ranked.filter(game => !game.view.game.finalScore).slice(0, 3);
  const closest = [...ranked].filter(game => !game.view.game.finalScore).reverse().slice(0, 3);
  const disagreements = ranked.filter(game => game.modelPick && game.modelPick !== game.pick && game.source !== 'gridline');
  const slateLabel = slate === 'all' ? `Week ${week?.week}` : slates.find(group => group.slate.key === slate)?.slate.label ?? '';

  const copyText = [`Gridline ${slateLabel} confidence picks`, ...ranked.map(game =>
    `${points(game)}  ${abbr(game, game.pick)} over ${abbr(game, other(game.pick))} (${game.wins} of 100)`), 'gridelineanalytics.com/pickem'].join('\n');

  return <div className="gl-page">
    <header className="gl-hero">
      <div>
        <p className="gl-label">{week ? `${week.season} season · Week ${week.week}` : 'Pick’em'}</p>
        <h1 className="gl-title">Pick&apos;em &amp; <span>Confidence Pool</span></h1>
        <p className="gl-lede">Every game ranked from surest thing to coin flip, as wins out of 100. Open any game to see how 100 matchups would play out, then run them yourself.</p>
      </div>
    </header>

    {(dashboard.isLoading || projections.isLoading) && <ConsumerLoading label="Loading this week's games…" />}
    {!dashboard.isLoading && !all.length && <div className="gl-empty"><strong>No games with lines yet.</strong>They appear once the week&apos;s lines post, usually Sunday night or Monday.</div>}

    {all.length > 0 && <>
      <div className="gl-pool-summary">
        <div className="gl-card"><span className="gl-label">Safest picks</span>
          {safest.map(game => <p key={game.view.game.gameId}><TeamLogo team={abbr(game, game.pick)} size={22} /><b>{abbr(game, game.pick)}</b> over {abbr(game, other(game.pick))}<span className="gl-pool-sum-value">{game.wins}</span></p>)}
          <small>Good survivor-pool candidates</small></div>
        <div className="gl-card"><span className="gl-label">Closest calls</span>
          {closest.map(game => <p key={game.view.game.gameId}><TeamLogo team={abbr(game, game.pick)} size={22} /><b>{abbr(game, game.pick)}</b> over {abbr(game, other(game.pick))}<span className="gl-pool-sum-value">{game.wins}</span></p>)}
          <small>Put your fewest points here</small></div>
        <div className="gl-card"><span className="gl-label">Gridline disagrees</span>
          {disagreements.length ? disagreements.slice(0, 3).map(game => <p key={game.view.game.gameId}><TeamLogo team={abbr(game, game.modelPick!)} size={22} /><b>{abbr(game, game.modelPick!)}</b> over {abbr(game, other(game.modelPick!))}<span className="gl-pool-sum-value">{game.modelWins}</span></p>)
            : <p className="gl-muted">Our model agrees with the market on every favorite this week.</p>}
          <small>Our model&apos;s upset leans, for tiebreakers</small></div>
      </div>

      <div className="gl-pool-controls">
        <div className="gl-filters" role="group" aria-label="Slate">
          <button type="button" aria-pressed={slate === 'all'} onClick={() => setSlate('all')}>All games</button>
          {slates.map(({ slate: item }) => <button key={item.key} type="button" aria-pressed={slate === item.key} onClick={() => setSlate(item.key)}>{item.label}</button>)}
        </div>
        <div className="gl-pool-actions">
          <button type="button" className="gl-button" onClick={() => {
            void navigator.clipboard?.writeText(copyText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
          }}>{copied ? 'Copied' : `Copy ${ranked.length} picks`}</button>
          <button type="button" className="gl-button ghost" onClick={() => void shareCardImage({
            eyebrow: `${week?.season ?? ''} ${slateLabel}`.trim(), title: 'Confidence picks',
            rows: ranked.map(game => ({ left: `${points(game)}  ${abbr(game, game.pick)} over ${abbr(game, other(game.pick))}`, right: `${game.wins} of 100` })),
            footer: 'gridelineanalytics.com/pickem',
          }, 'gridline-pickem.png')}>Share image</button>
        </div>
      </div>

      <div className="gl-pool-head" aria-hidden="true"><span>Pts</span><span>Projected winner</span><span /><span>Wins / 100</span></div>
      <div className="gl-pool-list">
        {ranked.map(game => <PoolRow key={game.view.game.gameId} game={game} points={points(game)} records={records} now={now} />)}
      </div>

      <PoolStrategy games={all} points={points} now={now} />
      {week && <SurvivorPlanner season={week.season} games={all} future={dashboard.data?.games ?? []} ratings={teamRatings} now={now} />}

      <p className="gl-note">Win chances come from the current betting line, converted with how much NFL results vary around it (about 12 points). We tested this against our own model on 1,468 games from 2021 to 2026: the line was more accurate at every blend we tried, so pool picks follow the line, and our model&apos;s different view is flagged as a second opinion. Games that have started are locked. <Link href="/methodology" className="gl-link">How we test</Link>.</p>
    </>}
  </div>;
}
