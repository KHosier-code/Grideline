import { getGetConsumerRedZoneOpportunitiesQueryKey, useGetConsumerRedZoneOpportunities, type ConsumerKeyPlayer, type ConsumerTeam, type GetConsumerRedZoneOpportunitiesParams } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';
import { PlayerPortrait } from './VerifiedImage';
import { USAGE_METRIC_LABELS, formatUsageMetric, usagePeriodLabel } from '../lib/consumer-presentation';
import { RED_ZONE_FALLBACK_LABEL, formatRedZoneCoverage, formatRedZoneValue, normalizeRedZoneResponse, readableTime, selectRedZoneFallback, type RedZonePlayer, type RedZonePeriod } from '../lib/consumer-red-zone';

const redZoneEnabled = import.meta.env.VITE_GRIDLINE_RED_ZONE_ENABLED === '1';

function RedZoneFigures({ playerId, season, last3, loading, unavailable, sourceGaps, sourceUpdatedAt, ingestedAt }: {
  playerId: string; season?: RedZonePlayer; last3?: RedZonePlayer; loading: Record<RedZonePeriod, boolean>; unavailable: Record<RedZonePeriod, boolean>; sourceGaps: Record<RedZonePeriod, number[]>; sourceUpdatedAt: string | null; ingestedAt: string | null;
}) {
  const windows: { key: RedZonePeriod; label: string; entry?: RedZonePlayer }[] = [
    { key: 'season', label: 'Season', entry: season },
    { key: 'last3', label: 'Last 3', entry: last3 },
  ];
  return <div className="rz-card" data-testid={`red-zone-card-${playerId}`}>
    <div className="rz-card-head"><strong>Inside 20 · opportunity</strong><span>Recorded plays only</span></div>
    <div className="rz-card-grid">
      {windows.map(({ key, label, entry }) => {
        const window = entry?.[key];
        return <div className="rz-card-period" key={key} data-testid={`red-zone-${key}-${playerId}`}>
          <strong>{label} <span className="rz-value-muted">· {window?.gamesPlayed === null || window?.gamesPlayed === undefined ? 'sample unavailable' : `${window.gamesPlayed} covered`}{window?.sampleGames !== null && window?.sampleGames !== undefined && window.includedGames !== null ? ` · ${window.includedGames}/${window.sampleGames} sourced` : ''}</span></strong>
          {window && (window.coveredWeeks.length > 0 || window.missingWeeks.length > 0 || window.sampleGames !== null) && <small className="rz-card-coverage" data-testid={`red-zone-coverage-${key}-${playerId}`}>
            {window.coveredWeeks.length > 0 || window.missingWeeks.length > 0 ? `${formatRedZoneCoverage(window)} · ` : ''}
            {window.includedGames ?? 0}/{window.sampleGames ?? window.gamesPlayed ?? 0} completed appearances covered
            {window.status === 'partial' ? ' · PARTIAL SOURCE COVERAGE' : ''}
          </small>}
          {sourceGaps[key].length > 0 && window && <small className="rz-card-coverage">
            League play-by-play is missing {sourceGaps[key].map(week => `Week ${week}`).join(', ')}. The appearance ratio counts only identified player games; participation in missing weeks cannot be confirmed from this source.
          </small>}
          <div className="rz-card-stats">
            <span><small>Targets</small>{formatRedZoneValue(window?.stats.targets ?? null)}</span>
            <span><small>Carries</small>{formatRedZoneValue(window?.stats.carries ?? null)}</span>
            <span><small>Target share</small>{formatRedZoneValue(window?.stats.targetShare ?? null, true)}</span>
            <span><small>Carry share</small>{formatRedZoneValue(window?.stats.carryShare ?? null, true)}</span>
            <span><small>Rec TD / Rush TD</small>{formatRedZoneValue(window?.stats.receivingTds ?? null)} / {formatRedZoneValue(window?.stats.rushingTds ?? null)}</span>
            {(window?.stats.snaps !== null && window?.stats.snaps !== undefined || window?.stats.snapPct !== null && window?.stats.snapPct !== undefined) && <span><small>Verified snaps / %</small>{formatRedZoneValue(window?.stats.snaps ?? null)} / {formatRedZoneValue(window?.stats.snapPct ?? null, true)}</span>}
          </div>
          <small>{loading[key] ? 'Loading source evidence' : unavailable[key] ? 'Source unavailable' : window?.status === 'partial' ? `Partial · ${window.reason ?? 'Limited source coverage'}` : !entry || window?.status === 'unavailable' ? window?.reason ?? 'No verified opportunity data' : 'Completed appearances only'}{window?.snapGames !== null && window?.snapGames !== undefined ? ` · Snap sample ${window.snapGames}/${window.gamesPlayed ?? '—'}` : ''}</small>
        </div>;
      })}
    </div>
    <div className="rz-card-note mt-2">Source updated {readableTime(sourceUpdatedAt)} · Ingested {readableTime(ingestedAt)}</div>
  </div>;
}

function PlayerUsageCard({ player, testId, redZone }: { player: ConsumerKeyPlayer; testId: string; redZone: Omit<Parameters<typeof RedZoneFigures>[0], 'playerId'> }) {
  const entries = Object.entries(player.recentUsage || {})
    .filter(([key, value]) => key in USAGE_METRIC_LABELS && value !== null
      && (player.position === 'QB' || !['attempts', 'completions', 'passingYards', 'passingTds'].includes(key)))
    .map(([key, value]) => ({
      key,
      label: USAGE_METRIC_LABELS[key],
      value: formatUsageMetric(key, value as number | null)
    }));

  return (
    <article className="player-usage-card" data-testid={testId}>
      <header className="puc-header">
        <PlayerPortrait url={player.headshotUrl} name={player.name} />
        <div className="puc-info">
          <strong>{player.name}</strong>
          <span>
            {player.position ?? 'Position unavailable'}
            {player.currentPersonnel.depthRank ? ` · depth ${player.currentPersonnel.depthRank}` : ''}
            {player.currentPersonnel.injuryStatus && player.currentPersonnel.injuryStatus !== 'None'
              ? ` · ${player.currentPersonnel.injuryStatus}`
              : ''}
          </span>
          <span className={`market-state market-state-${player.eligibility.status}`}>{player.eligibility.status === 'eligible' ? 'Status confirmed' : player.eligibility.status === 'ineligible' ? 'Unavailable for this game' : 'Status unconfirmed'}</span>
          {player.eligibility.reason && <small>{player.eligibility.reason}</small>}
        </div>
      </header>
      <div className="puc-metrics">
        {entries.length > 0 ? (
          entries.map(({ key, label, value }) => (
            <div className="puc-metric" key={key}>
              <small>{label}</small>
               <span>{value}</span>
            </div>
          ))
        ) : (
          <div className="puc-missing-state">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Recent usage is unavailable
          </div>
        )}
      </div>
      {redZoneEnabled && <RedZoneFigures playerId={player.playerId} {...redZone} />}
    </article>
  );
}

export function ConsumerKeyPlayers({ players, away, home, season, week, gameId }: { players: ConsumerKeyPlayer[], away: ConsumerTeam, home: ConsumerTeam, season: number, week: number, gameId: string }) {
  const seasonParams: GetConsumerRedZoneOpportunitiesParams = { season, game: gameId, zone: 20, period: 'season' };
  const last3Params: GetConsumerRedZoneOpportunitiesParams = { season, game: gameId, zone: 20, period: 'last3' };
  const seasonQuery = useGetConsumerRedZoneOpportunities(seasonParams, { query: { enabled: redZoneEnabled && Boolean(gameId), queryKey: getGetConsumerRedZoneOpportunitiesQueryKey(seasonParams), staleTime: 60_000 } });
  const last3Query = useGetConsumerRedZoneOpportunities(last3Params, { query: { enabled: redZoneEnabled && Boolean(gameId), queryKey: getGetConsumerRedZoneOpportunitiesQueryKey(last3Params), staleTime: 60_000 } });
  const seasonData = normalizeRedZoneResponse(seasonQuery.data, 'season');
  const last3Data = normalizeRedZoneResponse(last3Query.data, 'last3');
  const redZoneFor = (player: Pick<ConsumerKeyPlayer, 'playerId' | 'teamId'>) => {
    const match = (entry: RedZonePlayer) => entry.playerId === player.playerId && entry.team === player.teamId;
    return {
      season: seasonData.players.find(match),
      last3: last3Data.players.find(match),
      loading: { season: seasonQuery.isLoading, last3: last3Query.isLoading },
      unavailable: { season: seasonQuery.isError, last3: last3Query.isError },
      sourceGaps: { season: seasonData.missingWeeks, last3: last3Data.missingWeeks },
      sourceUpdatedAt: seasonData.sourceUpdatedAt ?? last3Data.sourceUpdatedAt,
      ingestedAt: seasonData.ingestedAt ?? last3Data.ingestedAt,
    };
  };
  const awayPlayers = (players ?? []).filter(p => p.teamId === away.abbreviation);
  const homePlayers = (players ?? []).filter(p => p.teamId === home.abbreviation);
  const fallback = !players?.length;
  if (fallback && !redZoneEnabled) return null;
  const fallbackPlayers = (team: string) => {
    const seasonLeaders = selectRedZoneFallback(seasonData.players, team);
    return seasonLeaders.length ? seasonLeaders : selectRedZoneFallback(last3Data.players, team, 'last3');
  };

  if (fallback) {
    const loading = seasonQuery.isLoading || last3Query.isLoading;
    const unavailable = seasonQuery.isError && last3Query.isError;
    const reason = [...seasonData.partialReasons, ...last3Data.partialReasons].filter((value, index, all) => all.indexOf(value) === index);
    const renderTeam = (team: ConsumerTeam) => {
      const entries = fallbackPlayers(team.abbreviation);
      return <div className="pkp-team" key={team.abbreviation} data-testid={`rz-fallback-team-${team.abbreviation}`}>
        <h3>{team.name}</h3>
        <div className="pkp-cards">
          {loading && !entries.length ? <div className="skeleton h-40 rounded-xl" aria-label={`Loading ${team.name} red-zone opportunities`} /> :
            entries.length ? entries.map(player =>
              <article className="rz-fallback-card" key={`${player.playerId}:${player.team}`} data-testid={`rz-fallback-player-${player.team}-${player.playerId}`}>
                  <header className="puc-header"><PlayerPortrait url={null} name={player.playerName} />
                  <div className="puc-info"><strong>{player.playerName}</strong><span>{player.team} · {player.position}</span></div>
                </header>
                <RedZoneFigures playerId={player.playerId} {...redZoneFor({ playerId: player.playerId, teamId: player.team })} />
              </article>) :
              <p className="pkp-empty text-muted-foreground text-sm">No verified pregame red-zone opportunities available for {team.name}.</p>}
        </div>
      </div>;
    };
    return <section className="premium-key-players" data-section="player-usage" data-testid="premium-key-players" aria-labelledby="key-player-usage-heading">
      <div className="consumer-section-heading"><div><p className="consumer-eyebrow">{RED_ZONE_FALLBACK_LABEL} · {season} season</p><h2 id="key-player-usage-heading">Inside-20 opportunities</h2></div></div>
      <p className="rz-fallback-note" role="status" data-testid="status-red-zone-fallback">
        <strong>{unavailable ? 'Red-zone source unavailable.' : 'Player usage unavailable; red-zone evidence shown separately.'}</strong>{' '}
        {loading ? 'Loading pregame evidence.' : 'Completed games before this matchup only. Up to three players per team ranked by recorded targets and carries; other usage metrics are not available.'}
        {!loading && (seasonData.status === 'partial' || last3Data.status === 'partial' || reason.length > 0) && <> Partial coverage: {reason.length ? reason.join(' · ') : 'Some completed games lack source evidence.'}</>}
        {!loading && <> Source updated {readableTime(seasonData.sourceUpdatedAt ?? last3Data.sourceUpdatedAt)} · Ingested {readableTime(seasonData.ingestedAt ?? last3Data.ingestedAt)}.</>}
      </p>
      <div className="pkp-grid">{renderTeam(away)}{renderTeam(home)}</div>
    </section>;
  }

  return (
    <section className="premium-key-players" data-section="player-usage" data-testid="premium-key-players" aria-labelledby="key-player-usage-heading">
      <div className="consumer-section-heading">
        <div>
          <p className="consumer-eyebrow">{usagePeriodLabel(season, week)}</p>
          <h2 id="key-player-usage-heading">Key player usage</h2>
        </div>
      </div>
      
      <div className="pkp-grid">
        <div className="pkp-team" data-testid="pkp-away">
          <h3>{away.name}</h3>
          <div className="pkp-cards">
            {awayPlayers.length > 0 ? awayPlayers.map((p, index) => <PlayerUsageCard key={`away-${p.playerId}-${index}`} player={p} testId={`player-usage-away-${index}`} redZone={redZoneFor(p)} />) : <p className="pkp-empty text-muted-foreground text-sm">No verified {season} usage from completed games before this matchup.</p>}
          </div>
        </div>
        <div className="pkp-team" data-testid="pkp-home">
          <h3>{home.name}</h3>
          <div className="pkp-cards">
            {homePlayers.length > 0 ? homePlayers.map((p, index) => <PlayerUsageCard key={`home-${p.playerId}-${index}`} player={p} testId={`player-usage-home-${index}`} redZone={redZoneFor(p)} />) : <p className="pkp-empty text-muted-foreground text-sm">No verified {season} usage from completed games before this matchup.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}