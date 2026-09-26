import type { ConsumerMatchupAssessment, ConsumerMatchupBoard as MatchupBoard, ConsumerTeam } from '@workspace/api-client-react';
import { ArrowRight, Minus } from 'lucide-react';
import { formatMatchupMetric } from '../lib/consumer-matchups';
import { supportedAssessments } from '../lib/consumer-presentation';

function Assessment({ assessment, home, away }: {
  assessment: ConsumerMatchupAssessment;
  home: ConsumerTeam;
  away: ConsumerTeam;
}) {
  const EdgeIcon = assessment.edge === 'neutral' || assessment.edge === 'insufficient' ? Minus : ArrowRight;
  return <details className={`matchup-assessment matchup-edge-${assessment.edge}`}>
    <summary>
      <span className="matchup-category"><strong>{assessment.title}</strong><small>{assessment.coverage}</small></span>
      <span className="matchup-edge-label"><EdgeIcon aria-hidden="true" />{assessment.edgeLabel}</span>
      <span className="matchup-confidence">{assessment.confidence} confidence</span>
    </summary>
    <div className="matchup-detail">
      <p>{assessment.explanation}</p>
       {assessment.metrics.filter(metric => metric.homeValue !== null || metric.awayValue !== null).map((metric) => <div className="matchup-metric" key={metric.label}>
        <strong>{metric.label}</strong>
        <span><small>{away.abbreviation}</small>{formatMatchupMetric(metric, 'away')}</span>
        <span><small>{home.abbreviation}</small>{formatMatchupMetric(metric, 'home')}</span>
      </div>)}
       {assessment.metrics.some(metric => metric.homeValue === null && metric.awayValue === null) && <details className="detail-zero-coverage"><summary>{assessment.metrics.filter(metric => metric.homeValue === null && metric.awayValue === null).length} metrics without two-team values · view details</summary>
         {assessment.metrics.filter(metric => metric.homeValue === null && metric.awayValue === null).map(metric => <p key={metric.label}>{metric.label}: unavailable · {assessment.coverage}</p>)}
       </details>}
      {assessment.limitations.length > 0 && <div className="matchup-limitations"><b>Limits</b><ul>{assessment.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>
  </details>;
}

export function ConsumerMatchupBoard({ board, home, away }: {
  board: MatchupBoard;
  home: ConsumerTeam;
  away: ConsumerTeam;
}) {
  const supported = supportedAssessments(board.assessments);
  const unsupported = board.assessments.length - supported.length;
  return <section className="matchup-board-section" data-section="matchup-board">
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Pregame matchup evidence</p><h2>Matchup Board</h2></div><span className={`matchup-board-status status-${board.status}`}>{board.status}</span></div>
    <p className="consumer-note">Only supported evidence available before kickoff is used. These assessments do not change the Gridline prediction.</p>
    {supported.length > 0 && <div className="matchup-team-labels" aria-hidden="true"><span>{away.abbreviation}</span><span>Assessment</span><span>{home.abbreviation}</span></div>}
    <div className="matchup-assessments">{supported.map((assessment) =>
      <Assessment assessment={assessment} home={home} away={away} key={assessment.category} />)}</div>
    {unsupported > 0 && <details className="detail-zero-coverage"><summary>{unsupported} unavailable matchup {unsupported === 1 ? 'category' : 'categories'} · view limitations</summary>
      {board.assessments.filter(assessment => assessment.edge === 'insufficient').map(assessment => <article key={assessment.category}><strong>{assessment.title}</strong><p>{assessment.coverage} · {assessment.explanation}</p></article>)}
    </details>}
    <footer>Sources: {board.sources.join(' · ') || 'No supported sources'} · Pregame evidence through {new Date(board.sourceCutoff).toLocaleString()} · {board.completeness.supportedCategories}/{board.completeness.totalCategories} categories supported</footer>
  </section>;
}