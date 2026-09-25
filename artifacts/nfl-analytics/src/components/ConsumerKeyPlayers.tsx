import type { ConsumerKeyPlayer, ConsumerTeam } from '@workspace/api-client-react';
import { AlertTriangle, UserRound } from 'lucide-react';
import { USAGE_METRIC_LABELS, formatUsageMetric, usagePeriodLabel } from '../lib/consumer-presentation';

function PlayerUsageCard({ player, testId }: { player: ConsumerKeyPlayer; testId: string }) {
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
        <div className="puc-avatar"><UserRound className="h-5 w-5" /></div>
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
    </article>
  );
}

export function ConsumerKeyPlayers({ players, away, home, season, week }: { players: ConsumerKeyPlayer[], away: ConsumerTeam, home: ConsumerTeam, season: number, week: number }) {
  const awayPlayers = (players ?? []).filter(p => p.teamId === away.abbreviation);
  const homePlayers = (players ?? []).filter(p => p.teamId === home.abbreviation);

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
            {awayPlayers.length > 0 ? awayPlayers.map((p, index) => <PlayerUsageCard key={`away-${p.playerId}-${index}`} player={p} testId={`player-usage-away-${index}`} />) : <p className="pkp-empty text-muted-foreground text-sm">No verified {season} usage from completed games before this matchup.</p>}
          </div>
        </div>
        <div className="pkp-team" data-testid="pkp-home">
          <h3>{home.name}</h3>
          <div className="pkp-cards">
            {homePlayers.length > 0 ? homePlayers.map((p, index) => <PlayerUsageCard key={`home-${p.playerId}-${index}`} player={p} testId={`player-usage-home-${index}`} />) : <p className="pkp-empty text-muted-foreground text-sm">No verified {season} usage from completed games before this matchup.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}