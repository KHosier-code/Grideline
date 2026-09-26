import { useMemo, useState } from 'react';
import {
  getGetConsumerPlayerProjectionsQueryKey,
  getGetConsumerPropsAvailabilityQueryKey,
  useGetConsumerPlayerProjections,
  useGetConsumerPropsAvailability,
  type ConsumerPlayerProjection,
  type ConsumerPlayerProjectionModel,
} from '@workspace/api-client-react';
import { ChevronDown, FlaskConical, LockKeyhole, RotateCcw, ShieldAlert } from 'lucide-react';
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

  const data = projectionsQuery.data;
  const models = data?.models ?? [];
  const projections = data?.projections ?? [];
  const families = useMemo(() => [...new Set(models.map(model => model.family))].sort(), [models]);
  const teams = useMemo(() => [...new Set(projections.map(row => row.teamId))].sort(), [projections]);
  const filtered = useMemo(() => projections.filter(row =>
    (!team || row.teamId === team) && (!family || modelFor(row, models)?.family === family),
  ), [projections, models, team, family]);

  const lockedMessage = availabilityQuery.data?.message ??
    'Betting player props are not available in this version of Gridline.';

  return (
    <div className="consumer-page projection-page">
      <header className="pp-hero">
        <div className="pp-hero-copy">
          <p className="pp-overline"><span /> Player lab / archive study</p>
          <h1>Player estimates,<br /><em>with the receipts.</em></h1>
          <p>Explore what the model estimated for past NFL games, alongside the evidence it had and the result that followed. This is a historical simulation, not a forecast for an upcoming game.</p>
        </div>
        <div className="pp-hero-stamp">
          <small>Study type</small>
          <strong>Historical only</strong>
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