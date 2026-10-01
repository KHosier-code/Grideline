import {
  getGetConsumerGameProjectionsQueryKey, getGetConsumerGameQueryKey, useGetConsumerGame, useGetConsumerGameProjections,
  useGetConsumerTouchdowns, type ConsumerGameProjection, type ConsumerProjectionQb,
} from '@workspace/api-client-react';
import { ChevronLeft, CloudRain, ShieldCheck } from 'lucide-react';
import { useSearch, useParams, Link } from 'wouter';
import { ConsumerDepthChart } from '../../components/ConsumerDepthChart';
import { ConsumerKeyPlayers } from '../../components/ConsumerKeyPlayers';
import { ConsumerMatchupBoard } from '../../components/ConsumerMatchupBoard';
import { ConsumerPregameComparisonChart } from '../../components/ConsumerPregameComparisonChart';
import { ConsumerPlayerMatchups } from '../../components/ConsumerPlayerMatchups';
import { DeferredDetailDisclosure } from '../../components/DeferredDetailDisclosure';
import { GameDefenseVsPosition } from '../../components/DefenseVsPosition';
import { PlayerPositionMatchup } from '../../components/PlayerPositionMatchup';
import { GameAlerts } from './GameAlerts';
import { BookTable } from '@/components/BookLines';
import { ConsumerLoading, ConsumerMessage, SaveGameButton, formatKickoff, useConsumerNow } from './consumer-ui';
import { useEffect } from 'react';
import { setPublicMetadata } from '../../lib/public-metadata';
import { TeamChip } from '../../components/GameBoard';
import { MatchupRanks } from '../../components/MatchupRanks';
import { HundredGrid, Simulator, abbr, toPoolGame } from '../../components/GameSim';
import { matchupAccents } from '../../lib/team-colors';
import { buildGameView, formatPrice, lineText, vegasLineText, type GameView } from '../../lib/pick-sheet';

const pct = (value: number) => `${Math.round(value * 100)}%`;
const epa = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;

function QbCard({ team, qb }: { team: string; qb: ConsumerProjectionQb | null }) {
  return <div className="gl-factor">
    <span className="gl-label">{team} quarterback</span>
    <b>{qb?.name ?? 'Not announced'}</b>
    <p>{epa(qb?.value)} EPA per dropback, recent games weighted most</p>
    {qb?.outName ? <p><span className="gl-flag out">{qb.outName}: {qb.outReason ?? 'out'}</span> Starting in their place.</p>
      : qb?.newStarter && <p><span className="gl-flag">Not the usual starter</span></p>}
    {qb && !qb.listed && <p>Expected starter based on recent starts</p>}
  </div>;
}

function drivers(view: GameView, projection: ConsumerGameProjection | undefined) {
  const home = view.game.matchup.home.abbreviation;
  const away = view.game.matchup.away.abbreviation;
  if (!projection) return [];
  const f = projection.factors;
  const side = (value: number | null, threshold: number) => value === null || Math.abs(value) < threshold ? null : value > 0 ? home : away;
  const lines: string[] = [];
  const qb = side(f.qbEdge, 0.02);
  if (qb) lines.push(`Quarterback: ${qb}'s starter has been the more efficient passer (${epa(f.qbEdge)} EPA per dropback difference, home minus away).`);
  const team = side(f.teamEdge, 0.03);
  if (team) lines.push(`Overall matchup: ${team}'s offense against the other defense projects better per play.`);
  const pass = side(f.passEdge, 0.04);
  if (pass) lines.push(`Passing game: the edge goes to ${pass}.`);
  const rush = side(f.rushEdge, 0.04);
  if (rush) lines.push(`Running game: the edge goes to ${rush}.`);
  if (f.restDiff && Math.abs(f.restDiff) >= 2) lines.push(`Rest: ${f.restDiff > 0 ? home : away} has ${Math.abs(f.restDiff)} more days off.`);
  lines.push(f.neutralSite ? 'Neutral site: no home-field adjustment.' : `Home field: ${home} gets the usual home-field adjustment.`);
  return lines;
}

export default function ConsumerGameDetail() {
  const { gameId = '' } = useParams();
  const detailSearch = useSearch();
  const backHref = detailSearch ? `/games?${detailSearch}` : '/games';
  const query = useGetConsumerGame(gameId, { query: { queryKey: getGetConsumerGameQueryKey(gameId), enabled: Boolean(gameId), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true } });
  const now = useConsumerNow();
  const projectionParams = query.data ? { season: query.data.season } : undefined;
  const projections = useGetConsumerGameProjections(projectionParams, { query: { queryKey: getGetConsumerGameProjectionsQueryKey(projectionParams), enabled: Boolean(query.data) } });
  const qbProjection = projections.data?.games.find(item => item.gameId === gameId);
  useEffect(() => {
    if (query.data) {
      const away = query.data.matchup.away.name;
      const home = query.data.matchup.home.name;
      setPublicMetadata(`/games/${encodeURIComponent(gameId)}`, `${away} at ${home} | Gridline Game Detail`,
        `${away} at ${home}: Gridline's projected score, line and total next to Vegas, the quarterback matchup and the top touchdown picks for this game.`);
    } else if (query.isError) {
      setPublicMetadata(`/games/${encodeURIComponent(gameId)}`, 'Game unavailable | Gridline', 'This matchup could not be verified.', false);
    }
  }, [gameId, query.data, query.isError]);
  if (query.isLoading) return <ConsumerLoading label="Loading matchup details…" />;
  if (query.isError || !query.data) return <ConsumerMessage error title="This matchup is unavailable" detail="We couldn’t load this game right now. Return to Games and try again shortly." />;
  const game = query.data;
  const beforeKickoff = Boolean(game.kickoffTime && new Date(game.kickoffTime).getTime() > now
    && (game.gameState === 'pregame' || game.gameState === 'scheduled'));
  const weather = game.weather as { summary?: unknown; temperature?: unknown; sustainedWind?: unknown; precipitationProbability?: unknown } | null;
  const weatherParts = weather ? [
    typeof weather.summary === 'string' ? weather.summary : null,
    typeof weather.temperature === 'number' ? `${weather.temperature.toFixed(0)}°F` : null,
    typeof weather.sustainedWind === 'number' ? `${weather.sustainedWind.toFixed(0)} mph wind` : null,
    typeof weather.precipitationProbability === 'number' ? `${weather.precipitationProbability.toFixed(0)}% precipitation` : null,
  ].filter(Boolean) : [];
  const view = buildGameView(game, qbProjection);

  return <div className="gl-page consumer-detail">
    <Link href={backHref} className="consumer-back"><ChevronLeft className="h-4 w-4" /> Back to games</Link>
    <header className="gl-hero gl-game-hero">
      <div>
        <p className="gl-label">{game.season} Week {game.week} · {formatKickoff(game.kickoffTime)}{game.venue ? ` · ${game.venue}` : ''}</p>
        <h1 className="gl-title gl-matchup-title">
          <TeamChip team={game.matchup.away.abbreviation} large /> {game.matchup.away.name}
          <span className="gl-at">at</span>
          <TeamChip team={game.matchup.home.abbreviation} large /> {game.matchup.home.name}
        </h1>
        {game.finalScore && <p className="gl-lede gl-final-line">Final: {game.matchup.away.abbreviation} {game.finalScore.away}, {game.matchup.home.abbreviation} {game.finalScore.home}</p>}
      </div>
      <SaveGameButton gameId={game.gameId} />
    </header>

    <GameProjectionPanel view={view} projection={qbProjection} />
    {beforeKickoff && <BookTable books={view.books} home={game.matchup.home.abbreviation} away={game.matchup.away.abbreviation} />}
    <HundredGames view={view} />
    <MatchupRanks home={game.matchup.home.abbreviation} away={game.matchup.away.abbreviation} />
    <GameTouchdowns teams={[game.matchup.away.abbreviation, game.matchup.home.abbreviation]} />
    <GameAlerts gameId={game.gameId} upcoming={beforeKickoff} />
    <DeferredDetailDisclosure key={`${game.gameId}-matchups`} testId="disclosure-matchups" title="Team matchup details" status="Offense vs defense, category by category">
      <ConsumerMatchupBoard board={game.matchupBoard} away={game.matchup.away} home={game.matchup.home} />
      <ConsumerPregameComparisonChart board={game.matchupBoard} away={game.matchup.away} home={game.matchup.home} />
    </DeferredDetailDisclosure>
    <DeferredDetailDisclosure key={`${game.gameId}-personnel`} testId="disclosure-personnel" title="Players and depth chart" status="Depth, usage and position matchups">
      {beforeKickoff && <><GameDefenseVsPosition gameId={game.gameId} season={game.season} away={game.matchup.away} home={game.matchup.home} /><PlayerPositionMatchup gameId={game.gameId} /></>}
      <ConsumerDepthChart context={game.context} />
      <ConsumerKeyPlayers players={game.keyPlayers} away={game.matchup.away} home={game.matchup.home} season={game.season} week={game.week} gameId={game.gameId} />
      <ConsumerPlayerMatchups matchups={game.context.projectedMatchups} />
    </DeferredDetailDisclosure>
    <DeferredDetailDisclosure key={`${game.gameId}-sources`} testId="disclosure-sources" title="Weather" status="Forecast for kickoff">
      <div className="premium-weather" data-testid="game-weather"><CloudRain className="h-4 w-4" aria-hidden="true" /><span>{weatherParts.length > 0 ? weatherParts.join(' · ') : game.analysis.availability.weather ?? 'Weather unavailable'}</span></div>
    </DeferredDetailDisclosure>
  </div>;
}

function GameProjectionPanel({ view, projection }: { view: GameView; projection: ConsumerGameProjection | undefined }) {
  const { game, projection: p, vegas } = view;
  const home = game.matchup.home.abbreviation;
  const away = game.matchup.away.abbreviation;
  if (!p) return <div className="gl-empty"><strong>Our projection for this game is being prepared.</strong>It usually posts by Tuesday morning.</div>;
  const reasons = drivers(view, projection);
  return <section className="gl-section" aria-labelledby="projection-heading">
    <div className="gl-section-head"><h2 id="projection-heading">Gridline projection</h2>
      <p>{p.source === 'qb-model' ? 'Adjusted for the starting quarterbacks' : 'From our earlier model'}{game.finalScore ? '' : ' · updates through the week'}</p></div>
    <div className="gl-card gl-projection">
      <div className="gl-projection-score">
        <div><TeamChip team={away} /><b>{p.away.toFixed(1)}</b><small>{pct(1 - p.homeWin)} to win</small></div>
        <div><TeamChip team={home} /><b>{p.home.toFixed(1)}</b><small>{pct(p.homeWin)} to win</small></div>
      </div>
      <div className="gl-winbar" role="img" aria-label={`${away} ${pct(1 - p.homeWin)}, ${home} ${pct(p.homeWin)} to win`}>
        <span style={{ width: `${(1 - p.homeWin) * 100}%` }} />
      </div>
      <div className="gl-edge-compare">
        <div><span className="gl-label">Spread · Gridline</span><b>{lineText(p.margin, home, away)}</b></div>
        <div><span className="gl-label">Spread · Vegas</span><b>{vegas.homeLine !== null ? vegasLineText(vegas.homeLine, home, away) : '—'}</b></div>
        <div><span className="gl-label">Total · Gridline</span><b>{p.total.toFixed(1)}</b></div>
        <div><span className="gl-label">Total · Vegas</span><b>{vegas.total ?? '—'}</b></div>
      </div>
      {view.result && <p className="gl-note">Our projected winner was {view.result === 'win' ? 'right' : view.result === 'loss' ? 'wrong' : 'tied'}.</p>}
    </div>
    {p.source === 'qb-model' && <div className="gl-why gl-card"><QbCard team={away} qb={p.awayQb} /><QbCard team={home} qb={p.homeQb} /></div>}
    {reasons.length > 0 && <div className="gl-card gl-reasons"><h3 className="gl-label">What drives the projection</h3><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    <p className="gl-note">This is a projection, not a pick. Our lines haven&apos;t beaten Vegas closing lines in testing, so use them as a second opinion. <Link href="/methodology" className="gl-link">How we test</Link>.</p>
  </section>;
}

function GameTouchdowns({ teams }: { teams: string[] }) {
  const touchdowns = useGetConsumerTouchdowns();
  const picks = (touchdowns.data?.picks ?? []).filter(pick => teams.includes(pick.team)).slice(0, 6);
  if (!picks.length) return null;
  return <section className="gl-section" aria-labelledby="game-td-heading">
    <div className="gl-section-head"><h2 id="game-td-heading">Touchdown picks in this game</h2><Link href="/touchdowns" className="gl-link">All TD picks ›</Link></div>
    <ol className="gl-td-grid">
      {picks.map(pick => <li key={pick.playerId}><Link href="/touchdowns" className="gl-card gl-td-card">
        <span className="gl-rank">#{pick.rank}</span>
        <span className="gl-who"><strong>{pick.name}</strong><span><span className="pos">{pick.position}</span><TeamChip team={pick.team} />{pick.injuryStatus && <span className="gl-flag">{pick.injuryStatus}</span>}{pick.scored !== null && <span>{pick.scored ? 'Scored ✓' : 'No TD'}</span>}</span></span>
        <span className="gl-td-card-odds"><b className="gl-pct">{pct(pick.probability)}</b><small>Fair {formatPrice(pick.fairOdds)}</small></span>
      </Link></li>)}
    </ol>
  </section>;
}

/** The same 100-game view as Pick'em, for this matchup. */
function HundredGames({ view }: { view: GameView }) {
  const game = toPoolGame(view);
  if (!game) return null;
  const pick = abbr(game, game.pick);
  const [winColor, lossColor] = matchupAccents(pick, abbr(game, game.pick === 'home' ? 'away' : 'home'));
  return <section className="gl-section" aria-labelledby="hundred-heading">
    <div className="gl-section-head"><h2 id="hundred-heading">If they played 100 times</h2><Link href="/pickem" className="gl-link">Every game this week ›</Link></div>
    <div className="gl-card gl-hundred-card">
      <div className="gl-hundred-top">
        <HundredGrid wins={game.wins} winColor={winColor} lossColor={lossColor} label={`${pick} wins ${game.wins} of 100`} />
        <p><b>{pick} wins {game.wins} of 100.</b> {game.source === 'gridline'
          ? 'From our model; the betting line is not posted yet.'
          : 'From the current betting line, the most accurate source in our testing. Our model\'s view is above.'}</p>
      </div>
      <Simulator game={game} showLink={false} title="How they'd finish" />
    </div>
  </section>;
}
