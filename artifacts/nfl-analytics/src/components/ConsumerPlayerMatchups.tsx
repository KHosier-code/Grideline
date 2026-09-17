import type { ConsumerProjectedMatchup } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';
import { isMatchupSupported } from '../lib/consumer-presentation';

export function ConsumerPlayerMatchups({ matchups }: { matchups: ConsumerProjectedMatchup[] }) {
  const supportedMatchups = matchups.filter(isMatchupSupported);

  return (
    <section className="player-matchups-section" data-section="player-matchups" data-testid="player-matchups" aria-labelledby="player-matchups-heading">
      <div className="consumer-section-heading">
        <div>
          <p className="consumer-eyebrow">Individual assignments</p>
          <h2 id="player-matchups-heading">Player matchups</h2>
        </div>
      </div>
      
      {supportedMatchups.length > 0 ? (
        <div className="player-matchups-grid">
          {supportedMatchups.map((matchup) => (
            <article className="player-matchup-card" key={`${matchup.receiverName}-${matchup.defenderName}`}>
              <div className="pm-evidence">
                <span>{matchup.basis === 'verified' ? 'Verified basis' : 'Inferred basis'}</span>
                <span>{matchup.confidence} confidence</span>
              </div>
              <div className="pm-head">
                <strong>{matchup.receiverName}</strong>
                <span>vs</span>
                <strong>{matchup.defenderName}</strong>
              </div>
              <p className="pm-summary">{matchup.summary}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="consumer-state honest-missing-state" data-testid="player-matchups-missing">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          <h3>Player matchup evidence unavailable</h3>
          <p>Direct player-to-player matchups appear only when the evidence includes a verified or inferred basis and a clear confidence level. Gridline does not create assignments from unit-level data alone.</p>
        </div>
      )}
    </section>
  );
}
