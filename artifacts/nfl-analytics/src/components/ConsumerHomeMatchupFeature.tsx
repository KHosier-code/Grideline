import {
  getGetConsumerGameQueryKey,
  getGetConsumerTeamAnalyticsQueryKey,
  useGetConsumerGame,
  useGetConsumerTeamAnalytics,
  type ConsumerGame,
} from '@workspace/api-client-react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import { ConsumerPregameComparisonChart } from './ConsumerPregameComparisonChart';
import { ConsumerTeamTrendChart, validTrendValue } from './ConsumerTeamTrendChart';
import { latestCompletePriorWeek, pregameTrendTeams } from '../lib/home-chart-evidence';
import { formatKickoff } from '../pages/consumer/consumer-ui';
import '../pages/consumer/ConsumerTeams.css';
import '../pages/consumer/ConsumerHomeFeature.css';

function FeatureState({ title, description, retry }: { title: string; description: string; retry?: () => void }) {
  return <div className="ch-trend-state" role={retry ? 'alert' : 'status'}>
    <strong>{title}</strong><p>{description}</p>
    {retry && <button type="button" onClick={retry} data-testid="button-retry-home-evidence">Try again</button>}
  </div>;
}

export function ConsumerHomeMatchupFeature({ game, now }: { game: ConsumerGame; now: number }) {
  const detail = useGetConsumerGame(game.gameId, { query: {
    queryKey: getGetConsumerGameQueryKey(game.gameId), staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: true,
  } });
  // Discovery is bounded by the upcoming game's *prior* weeks. A partial week
  // cannot become historical form merely because another game has gone final.
  const priorWeek = Math.max(0, Math.min(18, game.week - 1));
  const discoveryParams = { season: game.season, throughWeek: Math.max(1, priorWeek), window: 'season' as const };
  const discovery = useGetConsumerTeamAnalytics(discoveryParams, { query: {
    queryKey: getGetConsumerTeamAnalyticsQueryKey(discoveryParams), enabled: priorWeek > 0, staleTime: 60_000,
  } });
  const coverageWeeks = discovery.data?.coverage.weeks ?? [];
  const throughWeek = latestCompletePriorWeek(coverageWeeks, priorWeek);
  const codes = [game.matchup.away.abbreviation, game.matchup.home.abbreviation];
  const trendsParams = { season: game.season, throughWeek: Math.max(1, throughWeek), window: 'season' as const, teams: codes.join(',') };
  const trends = useGetConsumerTeamAnalytics(trendsParams, { query: {
    queryKey: getGetConsumerTeamAnalyticsQueryKey(trendsParams), enabled: !!discovery.data && throughWeek > 0,
    staleTime: 60_000,
  } });
  const kickoff = game.kickoffTime ? new Date(game.kickoffTime).getTime() : NaN;
  const detailKickoff = detail.data?.kickoffTime ? new Date(detail.data.kickoffTime).getTime() : NaN;
  const isUpcoming = Number.isFinite(kickoff) && kickoff > now && (game.gameState === 'pregame' || game.gameState === 'scheduled');
  const samePregame = detail.data?.gameId === game.gameId && detail.data?.season === game.season
    && detail.data?.week === game.week && Number.isFinite(detailKickoff) && detailKickoff > now
    && (detail.data?.gameState === 'pregame' || detail.data?.gameState === 'scheduled');
  const cutoff = detail.data?.matchupBoard.sourceCutoff ? new Date(detail.data.matchupBoard.sourceCutoff).getTime() : NaN;
  const safeBoard = isUpcoming && samePregame && Number.isFinite(cutoff) && cutoff <= now && cutoff < detailKickoff;
  const trendTeams = pregameTrendTeams(trends.data?.teams ?? [], codes, throughWeek, kickoff);
  const observedPoints = trendTeams.reduce((sum, team) => sum + team.observations.filter(item => validTrendValue(item.offenseEpa)).length, 0);
  const covered = coverageWeeks.filter(item => item.week <= throughWeek && item.statGames > 0);
  const coverageLabel = covered.map(item => `W${item.week} ${item.statGames}/${item.finalGames}`).join(' · ');

  return <section className="ch-feature" aria-labelledby="home-feature-title" data-testid="section-home-matchup-evidence">
    <div className="ch-feature-top">
      <div><p className="consumer-eyebrow">01 / MATCHUP EVIDENCE</p>
        <h2 id="home-feature-title">{game.matchup.away.abbreviation} at {game.matchup.home.abbreviation}</h2>
        <p>{formatKickoff(game.kickoffTime)} · {game.season} season, Week {game.week}</p>
      </div>
      <div className="ch-feature-links">
        <Link href={`/games/${game.gameId}`} data-testid="link-home-feature-game">Game details <ArrowUpRight className="h-4 w-4" /></Link>
        <Link href="/teams" data-testid="link-home-feature-teams">Explore teams <ArrowUpRight className="h-4 w-4" /></Link>
      </div>
    </div>
    <div className="ch-feature-meta" aria-label="Evidence boundaries">
      <span>Pregame comparison / cutoff-safe</span>
      <span>Historical form / final games only</span>
      <span>No future weeks inferred</span>
    </div>
    <div className="ch-feature-grid">
      {detail.isLoading ? <div className="ch-trend-skeleton" aria-label="Loading pregame comparison" /> :
        detail.isError ? <FeatureState title="Pregame comparison unavailable" description="The game's pregame evidence could not be loaded." retry={() => { void detail.refetch(); }} /> :
        safeBoard && detail.data ? <ConsumerPregameComparisonChart board={detail.data.matchupBoard} away={detail.data.matchup.away} home={detail.data.matchup.home} /> :
          <FeatureState title="Pregame comparison withheld" description="A verified, pre-kickoff matchup board is not available for this scheduled game." />}
      <div className="ch-trends">
        <div><p className="consumer-eyebrow">02 / HISTORICAL FORM</p><h3>What the final games show</h3>
          <p>Offensive EPA per play, game by game. Gaps are missing evidence, not zeroes.</p></div>
        {priorWeek === 0 ? <FeatureState title="No prior weeks" description="This matchup opens the season; no same-season final-game form exists yet." /> :
          discovery.isLoading ? <div className="ch-trend-skeleton" aria-label="Loading historical coverage" /> :
          discovery.isError ? <FeatureState title="Coverage unavailable" description="We couldn't verify which prior weeks have complete final-game statistics." retry={() => { void discovery.refetch(); }} /> :
          throughWeek <= 0 ? <FeatureState title="No complete prior week" description="Historical form waits for a prior week with complete final-game statistics. Partial weeks are excluded." /> :
          trends.isLoading ? <div className="ch-trend-skeleton" aria-label="Loading team trends" /> :
          trends.isError ? <FeatureState title="Team trends unavailable" description="We couldn't load the final-game observations for these teams." retry={() => { void trends.refetch(); }} /> :
          !observedPoints ? <FeatureState title="No supported team observations" description="No valid offensive EPA observations are available for these teams in the completed-week window." /> :
          <ConsumerTeamTrendChart teams={trendTeams} selected={codes} throughWeek={throughWeek} metric="offenseEpa" compact />}
        {throughWeek > 0 && discovery.data && <div className="ch-feature-meta" data-testid="text-home-trend-provenance">
          <span>{game.season} · Season to date · W1–W{throughWeek} (prior final weeks)</span>
          {trendTeams.map(team => <span key={team.teamId}>{team.abbreviation}: {team.observations.filter(item => validTrendValue(item.offenseEpa)).length} valid games · {team.offenseSamples} source samples</span>)}
        </div>}
        {discovery.data && <p data-testid="text-home-trend-coverage">Coverage: {coverageLabel || 'No complete prior weeks'}{throughWeek < priorWeek ? ' · Missing/incomplete later weeks excluded' : ''}. Source: {trends.data?.source ?? discovery.data.source}.</p>}
      </div>
    </div>
  </section>;
}