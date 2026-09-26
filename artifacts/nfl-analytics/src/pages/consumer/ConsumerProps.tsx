import { useMemo, useState } from 'react';
import {
  getGetConsumerPlayerProjectionsQueryKey,
  getGetConsumerPlayerTdForecastsQueryKey,
  getGetConsumerPropsAvailabilityQueryKey,
  getGetConsumerUpcomingPlayerProjectionReadinessQueryKey,
  getGetConsumerUpcomingPlayerProjectionsQueryKey,
  useGetConsumerPlayerProjections,
  useGetConsumerPlayerTdForecasts,
  useGetConsumerPropsAvailability,
  useGetConsumerUpcomingPlayerProjectionReadiness,
  useGetConsumerUpcomingPlayerProjections,
  type ConsumerPlayerProjection,
  type ConsumerPlayerProjectionModel,
  type ConsumerPlayerTdForecast,
  type ConsumerUpcomingPlayerForecast,
} from '@workspace/api-client-react';
import { AlertCircle, CalendarDays, ChevronDown, FlaskConical, LockKeyhole, RotateCcw, ShieldAlert } from 'lucide-react';
import { formatKickoff } from './consumer-ui';
import './ConsumerProps.css';

const number = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? 'Not available' : value.toFixed(1);

const dateTime = (value: string | null | undefined) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
};

const label = (value: string) => value
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_-]/g, ' ')
  .replace(/\b\w/g, letter => letter.toUpperCase())
  .replace(/\b(Qb|Rb|Wr|Te)\b/g, abbreviation => abbreviation.toUpperCase());

function modelFor(row: ConsumerPlayerProjection, models: ConsumerPlayerProjectionModel[]) {
  return models.find(model => model.modelVersion === row.modelVersion && model.statistic === row.statistic);
}

function groupTdForecasts(forecasts: ConsumerPlayerTdForecast[]) {
  const groups = new Map<string, ConsumerPlayerTdForecast[]>();
  for (const forecast of forecasts) {
    const group = groups.get(forecast.gameId) ?? [];
    group.push(forecast);
    groups.set(forecast.gameId, group);
  }
  return [...groups.entries()].map(([gameId, rows]) => ({
    gameId,
    rows: rows.sort((a, b) => b.probability - a.probability || a.playerName.localeCompare(b.playerName)),
  }));
}

function UpcomingForecastRow({ row }: { row: ConsumerUpcomingPlayerForecast }) {
  return (
    <article className="pp-forecast-card" data-testid={`upcoming-forecast-${row.playerId}-${row.gameId}-${row.statistic}`}>
      <div className="pp-forecast-card-heading">
        <div>
          <p className="pp-forecast-label">DEVELOPMENT FORECAST — CONDITIONAL ON PARTICIPATION</p>
          <h3>{row.playerName} <span>{row.position} · {row.teamId} vs {row.opponentTeamId}</span></h3>
          <p>{label(row.statistic)} · {formatKickoff(row.kickoffTime)}</p>
        </div>
        <strong className="pp-forecast-value">{number(row.projectedValue)}</strong>
      </div>
      <dl className="pp-forecast-evidence">
        <div><dt>Recent average</dt><dd>{number(row.recentAverage)}</dd></div>
        <div><dt>Season average</dt><dd>{number(row.seasonAverage)}</dd></div>
        <div><dt>Prior appearances</dt><dd>{row.priorAppearances} · {label(row.sampleQuality)} sample</dd></div>
        <div><dt>Model</dt><dd>{row.modelVersion}</dd></div>
        <div><dt>Roster source retrieved</dt><dd>{dateTime(row.sourceRetrievedAt)}</dd></div>
        <div><dt>Calculated</dt><dd>{dateTime(row.calculatedAt)}</dd></div>
      </dl>
      <p className="pp-forecast-availability">
        Injury status: {row.injuryStatus ?? 'No matching injury status recorded; omission does not confirm health'}.
        {' '}Participation is not confirmed.
      </p>
      {(row.availabilityUncertain || row.uncertaintyReasons.length > 0) && (
        <ul className="pp-forecast-caveats" aria-label="Availability uncertainty">
          {(row.uncertaintyReasons.length > 0 ? row.uncertaintyReasons : ['Participation or availability has not been confirmed.'])
            .map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
        </ul>
      )}
      {row.missingFeatures.length > 0 && (
        <p className="pp-forecast-availability">Unavailable model inputs: {row.missingFeatures.map(label).join(', ')}.</p>
      )}
    </article>
  );
}

function ProjectionRow({ row, model, expanded, onToggle }: {
  row: ConsumerPlayerProjection;
  model?: ConsumerPlayerProjectionModel;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rowId = `${row.playerId}-${row.gameId}-${row.statistic}`;
  return (
    <div className="pp-row" data-testid={`projection-row-${rowId}`}>
      <button type="button" className="pp-row-button" onClick={onToggle} aria-expanded={expanded} aria-controls={`projection-detail-${rowId}`} data-testid={`button-expand-projection-${rowId}`}>
        <span className="pp-player">
          <strong>{row.playerName}</strong>
          <small>{row.position} · {row.teamId} · {label(row.statistic)} · {label(row.sampleQuality)} sample</small>
        </span>
        <span className="pp-cell pp-opponent">
          vs {row.opponentTeamId}
          <small>{row.season} · WK {row.week}</small>
        </span>
        <span className="pp-cell pp-recent">
          {number(row.recentAverage)}
          <small>Recent avg.</small>
        </span>
        <span className="pp-projected">
          <strong>{number(row.projectedValue)}</strong>
          <small>Estimated</small>
        </span>
        <ChevronDown className="pp-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="pp-detail" id={`projection-detail-${rowId}`} data-testid={`detail-projection-${rowId}`}>
          <section>
            <h3>Evidence at the time</h3>
            <dl>
              <div><dt>Recent average</dt><dd>{number(row.recentAverage)}</dd></div>
              <div><dt>Season average</dt><dd>{number(row.seasonAverage)}</dd></div>
               <div><dt>Last 3 appearances · {row.volumeUnit}</dt><dd>{number(row.recentVolume3)} per game</dd></div>
               <div><dt>Last 8 appearances · {row.volumeUnit}</dt><dd>{number(row.recentVolume8)} per game</dd></div>
              <div><dt>Prior appearances</dt><dd>{row.priorAppearances}</dd></div>
              <div><dt>Sample quality</dt><dd>{label(row.sampleQuality)}</dd></div>
              <div><dt>Simulated estimate</dt><dd>{number(row.projectedValue)}</dd></div>
              <div><dt>Recorded result</dt><dd>{number(row.actualValue)}</dd></div>
               <div><dt>Evidence cutoff</dt><dd>{dateTime(row.cutoffAt)}</dd></div>
            </dl>
          </section>
          <section>
            <h3>Game & model context</h3>
             <p>{row.teamId} vs {row.opponentTeamId} · {row.kickoffTime ? formatKickoff(row.kickoffTime) : `${row.gameDate} · kickoff time unverified`} · Game {row.gameId}</p>
             <p>Opponent is the recorded opposing team. Defensive strength is used only when a verified prior-game source exists; an individual assignment is not inferred.</p>
             <p>Opportunity trend compares pregame {row.volumeUnit} per appearance in the last 3 and last 8 games. Production averages are a separate measure; missing appearances are not counted as zero.</p>
             <p>Cutoff basis: {label(row.cutoffBasis)}. The archive run was calculated {dateTime(row.calculatedAt)}.</p>
             <p>{model ? `${label(model.family)} model` : 'Model family unavailable'} · Version {row.modelVersion}</p>
            {row.warnings.length > 0 && row.warnings.map((warning, index) =>
              <p className="pp-warning" key={`${warning}-${index}`}><ShieldAlert size={13} aria-hidden="true" /> {warning}</p>,
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function ConsumerProps() {
  const [family, setFamily] = useState('');
  const [team, setTeam] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const projectionsQuery = useGetConsumerPlayerProjections({
    query: { queryKey: getGetConsumerPlayerProjectionsQueryKey(), staleTime: 300_000 },
  });
  const availabilityQuery = useGetConsumerPropsAvailability({
    query: { queryKey: getGetConsumerPropsAvailabilityQueryKey(), staleTime: 300_000 },
  });
  const upcomingReadinessQuery = useGetConsumerUpcomingPlayerProjectionReadiness({
    query: { queryKey: getGetConsumerUpcomingPlayerProjectionReadinessQueryKey(), staleTime: 300_000 },
  });
  const upcomingForecastsQuery = useGetConsumerUpcomingPlayerProjections({
    query: { queryKey: getGetConsumerUpcomingPlayerProjectionsQueryKey(), staleTime: 60_000, refetchOnMount: 'always' },
  });
  const tdForecastsQuery = useGetConsumerPlayerTdForecasts({
    query: { queryKey: getGetConsumerPlayerTdForecastsQueryKey(), staleTime: 60_000, refetchOnMount: 'always' },
  });

  const data = projectionsQuery.data;
  const models = data?.models ?? [];
  const projections = data?.projections ?? [];
  const families = useMemo(() => [...new Set(models.map(model => model.family))].sort(), [models]);
  const teams = useMemo(() => [...new Set(projections.map(row => row.teamId))].sort(), [projections]);
  const filtered = useMemo(() => projections.filter(row =>
    (!team || row.teamId === team) && (!family || modelFor(row, models)?.family === family),
  ), [projections, models, team, family]);
  const tdMatchups = useMemo(
    () => groupTdForecasts(tdForecastsQuery.data?.forecasts ?? []),
    [tdForecastsQuery.data?.forecasts],
  );

  const lockedMessage = availabilityQuery.data?.message ??
    'Betting player props are not available in this version of Gridline.';

  return (
    <div className="consumer-page projection-page">
      <header className="pp-hero">
        <div className="pp-hero-copy">
          <p className="pp-overline"><span /> Player lab / development preview</p>
          <h1>Player estimates,<br /><em>with the receipts.</em></h1>
          <p>Explore conditional upcoming estimates and a separate archive of historical simulations. Upcoming projections do not confirm participation or offer betting advice.</p>
        </div>
        <div className="pp-hero-stamp">
          <small>Study type</small>
          <strong>Development preview</strong>
          <span>No live player lines</span>
        </div>
      </header>

      <section className="pp-intro" aria-label="Projection status">
        <div>
          <h2>Historical player projections</h2>
          <p data-testid="text-projection-message">{data?.message ?? 'Review archived estimates and their underlying sample context.'}</p>
        </div>
        <span className="pp-status" data-testid="status-projection-mode"><FlaskConical size={14} aria-hidden="true" /> Historical simulation · not live</span>
      </section>

      <div className="pp-summary" aria-label="Archive overview">
        <div><span>Season in view</span><strong data-testid="text-projection-season">{data?.season ?? '—'}</strong><small>From archived records</small></div>
        <div><span>Eligible players</span><strong data-testid="text-eligible-players">{data?.eligiblePlayers ?? '—'}</strong><small>In the available simulation</small></div>
        <div><span>Archive generated</span><strong data-testid="text-generated-at">{data?.generatedAt ? dateTime(data.generatedAt) : '—'}</strong><small>Not a live update timestamp</small></div>
      </div>

      <section className="pp-td" aria-labelledby="td-forecast-heading" data-testid="panel-td-forecasts">
        <div className="pp-upcoming-heading">
          <div className="pp-upcoming-title">
            <FlaskConical aria-hidden="true" />
            <div>
              <span className="pp-upcoming-kicker">Separate development ranking</span>
              <h2 id="td-forecast-heading">Player touchdown probabilities</h2>
            </div>
          </div>
          <span className={`pp-upcoming-status${tdForecastsQuery.data?.status === 'forecasts' ? ' is-ready' : ''}`} data-testid="status-td-forecasts">
            {tdForecastsQuery.data?.status === 'forecasts' ? 'Model estimates' : 'Unavailable'}
          </span>
        </div>
        <p className="pp-td-note">Probability estimates are ranked within each matchup and are not betting advice, odds, or guarantees.</p>
        <p className="pp-td-note">WR1 defensive context is a team-level estimate against the opponent defense. Named WR–CB assignments are unavailable; no individual cornerback matchup is inferred.</p>
        <p className="pp-td-evidence-link"><a href="/usage" data-testid="link-td-usage-evidence">Explore player usage evidence <span aria-hidden="true">↗</span></a></p>
        {tdForecastsQuery.isLoading ? (
          <div className="pp-upcoming-state" role="status" data-testid="status-td-forecasts-loading">
            <div className="pp-skeleton" />
            <p>Loading matchup touchdown rankings…</p>
          </div>
        ) : tdForecastsQuery.isError ? (
          <div className="pp-upcoming-state is-error" role="alert" data-testid="status-td-forecasts-error">
            <p><AlertCircle size={15} aria-hidden="true" /> Touchdown estimates could not be loaded. No other projection is substituted.</p>
            <button type="button" onClick={() => void tdForecastsQuery.refetch()} data-testid="button-retry-td-forecasts"><RotateCcw size={13} aria-hidden="true" /> Try again</button>
          </div>
        ) : tdForecastsQuery.data ? (
          <>
            <div className="pp-upcoming-message" data-testid="text-td-forecasts-message">
              <p>{tdForecastsQuery.data.message}</p>
              {tdForecastsQuery.data.status === 'unavailable' && (
                <small>Touchdown probability forecasts are unavailable for this environment.</small>
              )}
            </div>
            {tdForecastsQuery.data.status === 'forecasts' && (
              <div className="pp-td-summary" aria-label="Touchdown forecast coverage">
                <div><span>Upcoming games</span><strong>{tdForecastsQuery.data.upcomingGames}</strong></div>
                <div><span>Forecasts</span><strong>{tdForecastsQuery.data.forecasts.length}</strong></div>
                <div><span>Withheld</span><strong>{tdForecastsQuery.data.withheld.length}</strong></div>
                <div><span>Model version</span><strong>{tdForecastsQuery.data.modelVersion ?? 'Not available'}</strong></div>
                <div><span>As of</span><strong>{dateTime(tdForecastsQuery.data.asOf)}</strong></div>
              </div>
            )}
            {tdForecastsQuery.data.blockers.length > 0 && (
              <ul className="pp-td-blockers" aria-label="Touchdown forecast blockers">
                {tdForecastsQuery.data.blockers.map((blocker, index) => <li key={`${blocker}-${index}`}>{blocker}</li>)}
              </ul>
            )}
            {tdMatchups.length > 0 ? (
              <div className="pp-td-matchups" data-testid="td-forecast-matchups">
                {tdMatchups.map(({ gameId, rows }) => (
                  <section className="pp-td-matchup" key={gameId} aria-label={`Touchdown probability rankings for game ${gameId}`}>
                    <div className="pp-td-matchup-heading">
                      <div><span>Matchup ranking</span><h3>{rows[0].teamId} vs {rows[0].opponentTeamId}</h3></div>
                      <small>{rows[0].season} · Week {rows[0].week} · {formatKickoff(rows[0].kickoffTime)}</small>
                    </div>
                    <ol className="pp-td-rankings">
                      {rows.map((row, index) => (
                        <li className="pp-td-player" key={`${row.playerId}-${row.gameId}`} data-testid={`td-forecast-${row.playerId}-${row.gameId}`}>
                          <span className="pp-td-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                          <div className="pp-td-player-main">
                            <strong>{row.playerName}</strong>
                            <small>{row.position} · {row.teamId} vs {row.opponentTeamId} · {row.priorAppearances} prior appearances</small>
                          </div>
                          <strong className="pp-td-probability">{(row.probability * 100).toFixed(1)}<small>%</small></strong>
                          <details className="pp-td-details">
                            <summary>Evidence & limits</summary>
                            <dl>
                              <div><dt>Recent targets</dt><dd>{number(row.recentTargets)}</dd></div>
                              <div><dt>Recent carries</dt><dd>{number(row.recentCarries)}</dd></div>
                              <div><dt>Red-zone opportunities</dt><dd>{number(row.redZoneOpportunities)}</dd></div>
                              <div><dt>Opponent WR role evidence</dt><dd>{row.opponentWrRole ?? 'Not available'}</dd></div>
                              <div><dt>Opponent defensive context</dt><dd>{number(row.opponentDefensiveContext)}</dd></div>
                              <div><dt>Model</dt><dd>{row.modelVersion}</dd></div>
                              <div><dt>Evidence cutoff</dt><dd>{dateTime(row.cutoffAt)}</dd></div>
                            </dl>
                            <ul>
                              {row.limitations.length > 0
                                ? row.limitations.map((limitation, limitationIndex) => <li key={`${limitation}-${limitationIndex}`}>{limitation}</li>)
                                : <li>Named WR–CB assignment is unavailable; defensive context is team-level.</li>}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            ) : tdForecastsQuery.data.status === 'forecasts' ? (
              <p className="pp-upcoming-empty" data-testid="text-td-forecasts-empty">No player touchdown forecasts are available for the upcoming matchups.</p>
            ) : null}
            {tdForecastsQuery.data.withheld.length > 0 && (
              <section className="pp-td-withheld" aria-label="Players withheld from touchdown rankings">
                <h3>Players withheld</h3>
                <ul>
                  {tdForecastsQuery.data.withheld.slice(0, 16).map(row => (
                    <li key={`${row.playerId}-${row.gameId}`} data-testid={`td-withheld-${row.playerId}-${row.gameId}`}>
                      <strong>{row.playerName}</strong><span>Game {row.gameId} · {row.reason}</span>
                    </li>
                  ))}
                </ul>
                {tdForecastsQuery.data.withheld.length > 16 && (
                  <p>{tdForecastsQuery.data.withheld.length - 16} more players withheld for this slate. The readiness blockers above apply to all of them.</p>
                )}
              </section>
            )}
          </>
        ) : (
          <div className="pp-upcoming-state" role="status" data-testid="status-td-forecasts-empty">
            <p>Touchdown probability estimates are not available. No yardage projection is substituted.</p>
          </div>
        )}
      </section>

      <section className="pp-upcoming" aria-labelledby="upcoming-readiness-heading" data-testid="panel-upcoming-readiness">
        <div className="pp-upcoming-heading">
          <div className="pp-upcoming-title">
            <CalendarDays aria-hidden="true" />
            <div>
              <span className="pp-upcoming-kicker">Separate development readiness</span>
              <h2 id="upcoming-readiness-heading">Upcoming conditional projections</h2>
            </div>
          </div>
          <span className={`pp-upcoming-status${upcomingForecastsQuery.data?.status === 'development_forecasts' ? ' is-ready' : ''}`} data-testid="status-upcoming-readiness">
            {upcomingForecastsQuery.data?.status === 'development_forecasts' ? 'Development only' : 'Unavailable'}
          </span>
        </div>
        <p className="pp-upcoming-note">Conditional, development-only model outputs—not confirmed participation or betting advice. Archived historical estimates below remain separate.</p>
        {upcomingForecastsQuery.isLoading ? (
          <div className="pp-upcoming-state" role="status" data-testid="status-upcoming-forecasts-loading">
            <div className="pp-skeleton" />
            <p>Calculating conditional upcoming projections…</p>
          </div>
        ) : upcomingForecastsQuery.isError ? (
          <div className="pp-upcoming-state is-error" role="alert" data-testid="status-upcoming-forecasts-error">
            <p><AlertCircle size={15} aria-hidden="true" /> Upcoming projections could not be loaded. No historical estimates are substituted.</p>
            <button type="button" onClick={() => void upcomingForecastsQuery.refetch()} data-testid="button-retry-upcoming-forecasts"><RotateCcw size={13} aria-hidden="true" /> Try again</button>
          </div>
        ) : upcomingForecastsQuery.data ? (
          <>
            <div className="pp-upcoming-message" data-testid="text-upcoming-forecasts-message">
              <p>{upcomingForecastsQuery.data.message}</p>
              {upcomingForecastsQuery.data.status === 'unavailable' && (
                <small>Conditional projections are available only in the development preview. The production API remains unavailable for forecasts.</small>
              )}
            </div>
            <div className="pp-upcoming-summary" aria-label="Upcoming conditional forecast coverage">
              <div><span>Upcoming games</span><strong>{upcomingForecastsQuery.data.upcomingGames}</strong></div>
              <div><span>Direct coverage</span><strong>{upcomingForecastsQuery.data.coverage.direct}</strong></div>
              <div><span>Trusted crosswalk</span><strong>{upcomingForecastsQuery.data.coverage.crosswalk}</strong></div>
              <div><span>Conditional</span><strong>{upcomingForecastsQuery.data.eligibility.conditional}</strong></div>
              <div><span>Uncertain</span><strong>{upcomingForecastsQuery.data.eligibility.uncertain}</strong></div>
              <div><span>Unavailable</span><strong>{upcomingForecastsQuery.data.eligibility.unavailable}</strong></div>
              <div><span>Forecasts</span><strong>{upcomingForecastsQuery.data.forecasts.length}</strong></div>
              <div><span>As of</span><strong className="pp-upcoming-asof">{dateTime(upcomingForecastsQuery.data.asOf)}</strong></div>
            </div>
            {Object.keys(upcomingForecastsQuery.data.eligibility.reasons).length > 0 && (
              <div className="pp-upcoming-details" aria-label="Reasons conditional forecasts were withheld">
                <section>
                  <h3>Forecasts withheld</h3>
                  <ul className="pp-upcoming-reasons">
                    {Object.entries(upcomingForecastsQuery.data.eligibility.reasons).map(([reason, count]) => (
                      <li key={reason}>{label(reason)} <strong>{count}</strong></li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
            {upcomingForecastsQuery.data.forecasts.length > 0 ? (
              <div className="pp-forecast-list" data-testid="upcoming-forecast-list">
                {upcomingForecastsQuery.data.forecasts.map(row => (
                  <UpcomingForecastRow key={`${row.playerId}-${row.gameId}-${row.statistic}`} row={row} />
                ))}
              </div>
            ) : (
              <p className="pp-upcoming-empty" data-testid="text-upcoming-no-conditional-forecasts">No conditional upcoming projections are available. Historical projections remain separate.</p>
            )}
          </>
        ) : (
          <div className="pp-upcoming-state" role="status" data-testid="status-upcoming-forecasts-empty">
            <p>Conditional upcoming projections are not available. No historical estimates are substituted.</p>
          </div>
        )}
        <p className="pp-upcoming-note">Separate strict source-readiness audit: it requires an independently verified ESPN roster assignment and starter evidence. Its eligible count does not describe the conditional Sleeper-based projections above.</p>
        {upcomingReadinessQuery.isLoading ? (
          <div className="pp-upcoming-state" role="status" data-testid="status-upcoming-loading">
            <div className="pp-skeleton" />
            <p>Checking upcoming-game data readiness…</p>
          </div>
        ) : upcomingReadinessQuery.isError ? (
          <div className="pp-upcoming-state is-error" role="alert" data-testid="status-upcoming-error">
            <p><AlertCircle size={15} aria-hidden="true" /> Upcoming forecast readiness could not be loaded. No historical estimates are substituted.</p>
            <button type="button" onClick={() => void upcomingReadinessQuery.refetch()} data-testid="button-retry-upcoming-readiness"><RotateCcw size={13} aria-hidden="true" /> Try again</button>
          </div>
        ) : upcomingReadinessQuery.data ? (
          <>
            <div className="pp-upcoming-message" data-testid="text-upcoming-readiness-message">
              <p>{upcomingReadinessQuery.data.message}</p>
              {upcomingReadinessQuery.data.status === 'unavailable' && (
                <small>This readiness audit runs only in local development previews. The production API returns unavailable; no forecasts are generated or published there.</small>
              )}
            </div>
            <div className="pp-upcoming-summary" aria-label="Upcoming readiness counts">
              <div><span>Upcoming games</span><strong data-testid="text-upcoming-games">{upcomingReadinessQuery.data.upcomingGames}</strong></div>
              <div><span>Eligible</span><strong data-testid="text-upcoming-eligible">{upcomingReadinessQuery.data.eligibility.eligible}</strong></div>
              <div><span>Uncertain</span><strong data-testid="text-upcoming-uncertain">{upcomingReadinessQuery.data.eligibility.uncertain}</strong></div>
              <div><span>Excluded</span><strong data-testid="text-upcoming-excluded">{upcomingReadinessQuery.data.eligibility.excluded}</strong></div>
              <div><span>Forecast records</span><strong data-testid="text-upcoming-forecast-count">{upcomingReadinessQuery.data.forecasts.length}</strong></div>
              <div><span>As of</span><strong className="pp-upcoming-asof" data-testid="text-upcoming-as-of">{dateTime(upcomingReadinessQuery.data.asOf)}</strong></div>
            </div>
            {upcomingReadinessQuery.data.forecasts.length === 0 && (
              <p className="pp-upcoming-empty" data-testid="text-upcoming-no-forecasts">This strict audit does not generate forecasts; conditional projections are shown above.</p>
            )}
            <div className="pp-upcoming-details">
              <section aria-label="Upcoming source freshness">
                <h3>Source freshness</h3>
                <dl className="pp-freshness">
                  {([
                    ['Roster', upcomingReadinessQuery.data.sourceFreshness.roster],
                    ['Injuries', upcomingReadinessQuery.data.sourceFreshness.injuries],
                    ['Player stats', upcomingReadinessQuery.data.sourceFreshness.playerStats],
                  ] as const).map(([source, freshness]) => (
                    <div key={source}>
                      <dt>{source}</dt>
                      <dd>{freshness.status}<small>{freshness.latestSourceUpdatedAt ? dateTime(freshness.latestSourceUpdatedAt) : 'No source timestamp'}{freshness.ageHours !== null ? ` · ${number(freshness.ageHours)}h old` : ''}</small></dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-label="Upcoming forecast blockers">
                <h3>Readiness reasons & blockers</h3>
                {Object.keys(upcomingReadinessQuery.data.eligibility.reasons).length > 0 && (
                  <ul className="pp-upcoming-reasons">
                    {Object.entries(upcomingReadinessQuery.data.eligibility.reasons).map(([reason, count]) => (
                      <li key={reason}>{label(reason)} <strong>{count}</strong></li>
                    ))}
                  </ul>
                )}
                {upcomingReadinessQuery.data.blockers.length > 0 ? (
                  <ul className="pp-upcoming-blockers">
                    {upcomingReadinessQuery.data.blockers.map((blocker, index) => <li key={`${blocker}-${index}`}>{blocker}</li>)}
                  </ul>
                ) : Object.keys(upcomingReadinessQuery.data.eligibility.reasons).length === 0 ? (
                  <p className="pp-upcoming-no-blockers">No readiness blockers reported.</p>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <div className="pp-upcoming-state" role="status" data-testid="status-upcoming-empty">
            <p>Upcoming readiness is not available. No historical estimates are substituted.</p>
          </div>
        )}
      </section>

      <div className="pp-workspace">
        <main className="pp-main">
          <div className="pp-toolbar">
            <label>Model family
              <select value={family} onChange={event => { setFamily(event.target.value); setExpanded(null); }} data-testid="select-projection-family">
                <option value="">All families</option>
                {families.map(value => <option key={value} value={value}>{label(value)}</option>)}
              </select>
            </label>
            <label>Player team
              <select value={team} onChange={event => { setTeam(event.target.value); setExpanded(null); }} data-testid="select-projection-team">
                <option value="">All teams</option>
                {teams.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            {(family || team) && <button type="button" onClick={() => { setFamily(''); setTeam(''); setExpanded(null); }} data-testid="button-clear-projection-filters">Clear filters</button>}
          </div>
          {projectionsQuery.isLoading ? (
            <div className="pp-state" role="status" data-testid="status-projections-loading">
              <h3>Opening the archive</h3><p>Loading historical estimates and model evidence.</p>
              <div className="pp-skeleton" /><div className="pp-skeleton" /><div className="pp-skeleton" />
            </div>
          ) : projectionsQuery.isError ? (
            <div className="pp-state" role="alert" data-testid="status-projections-error">
              <h3>Archive unavailable</h3>
              <p>Historical player estimates could not be loaded. Betting props remain separately unavailable.</p>
              <button type="button" onClick={() => void projectionsQuery.refetch()} data-testid="button-retry-projections"><RotateCcw size={13} aria-hidden="true" /> Try again</button>
            </div>
          ) : data?.status !== 'historical_simulation' || projections.length === 0 ? (
            <div className="pp-state" data-testid="status-projections-empty">
              <h3>No historical estimates to show</h3>
              <p>{data?.message || 'No archived player projections have been published for this view.'}</p>
            </div>
          ) : (
            <>
              <div className="pp-list-heading"><strong>Archived estimates</strong><span data-testid="text-projection-count">{filtered.length} of {projections.length} records</span></div>
              <div className="pp-list">
                {filtered.length === 0 ? (
                  <div className="pp-state" data-testid="status-projections-filter-empty">
                    <h3>No matches in this slice</h3><p>Try another model family or team to see archived estimates.</p>
                    <button type="button" onClick={() => { setFamily(''); setTeam(''); }} data-testid="button-reset-projection-filters">Show all estimates</button>
                  </div>
                ) : filtered.map(row => {
                  const id = `${row.playerId}-${row.gameId}-${row.statistic}`;
                  return <ProjectionRow key={id} row={row} model={modelFor(row, models)} expanded={expanded === id} onToggle={() => setExpanded(expanded === id ? null : id)} />;
                })}
              </div>
            </>
          )}
        </main>

        <aside className="pp-sidebar" aria-label="Method and availability">
          <section className="pp-method">
            <FlaskConical aria-hidden="true" />
            <h2>How to read this</h2>
            <p>Each number is an archived model estimate for a past game. Compare it with the recorded result where one exists. A lower error is better, but model error does not describe certainty for one player.</p>
            {models.map(model => (
              <div className="pp-model" key={`${model.family}-${model.statistic}-${model.modelVersion}`}>
                <strong>{label(model.family)} · {label(model.statistic)}</strong>
                <small>Version {model.modelVersion}</small>
                <div className="pp-model-grid">
                  <span>Training samples<b>{model.trainSamples}</b></span>
                  <span>Evaluation samples<b>{model.evaluationSamples}</b></span>
                  <span>MAE<b>{number(model.mae)}</b></span>
                  <span>RMSE<b>{number(model.rmse)}</b></span>
                  <span>Bias<b>{number(model.bias)}</b></span>
                </div>
              </div>
            ))}
            {!models.length && <p>Model evaluation details are not available for this archive.</p>}
          </section>
          <section className="pp-locked" data-testid="status-betting-props">
            <LockKeyhole aria-hidden="true" />
            <span className="pp-locked-tag">Separate product status · unavailable</span>
            <h2>Betting player props</h2>
            <p>{availabilityQuery.isLoading ? 'Checking availability…' : lockedMessage}</p>
            {availabilityQuery.isError && <p>Availability status could not be refreshed. Betting player props are not offered here.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}