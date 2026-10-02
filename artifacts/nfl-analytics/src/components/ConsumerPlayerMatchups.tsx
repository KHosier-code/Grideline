import type { ConsumerProjectedMatchup } from '@workspace/api-client-react';
import { TeamChip } from './GameBoard';
import { isMatchupSupported } from '../lib/consumer-presentation';

/** Likely receiver vs defender pairings. Hidden when neither depth chart names both sides. */
export function ConsumerPlayerMatchups({ matchups }: { matchups: ConsumerProjectedMatchup[] }) {
  const supportedMatchups = matchups.filter(isMatchupSupported);
  if (!supportedMatchups.length) return null;
  return (
    <section className="player-matchups-section" data-section="player-matchups" data-testid="player-matchups" aria-labelledby="player-matchups-heading">
      <div className="gl-section-head">
        <h2 id="player-matchups-heading">Player matchups</h2>
        <p>Who each top receiver should see most, from the depth charts.</p>
      </div>
      <div className="player-matchups-grid">
        {supportedMatchups.map((matchup) => (
          <article className="player-matchup-card" key={`${matchup.receiverName}-${matchup.defenderName}`}>
            <div className="pm-evidence">
              {matchup.team && <TeamChip team={matchup.team} />}
              <span>{matchup.receiverRole ?? 'Receiver'} vs {matchup.defenderRole ?? 'defender'}</span>
              <span>{matchup.confidence === 'low' ? 'Likely' : 'Probable'}</span>
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
    </section>
  );
}
