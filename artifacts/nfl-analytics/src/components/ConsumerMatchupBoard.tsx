import type { ConsumerMatchupAssessment, ConsumerMatchupBoard as MatchupBoard, ConsumerTeam } from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, Minus } from 'lucide-react';
import { formatMatchupMetric, supportedMatchupSummary } from '../lib/consumer-matchups';

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
      {assessment.metrics.map((metric) => <div className="matchup-metric" key={metric.label}>
        <strong>{metric.label}</strong>
        <span><small>{away.abbreviation}</small>{formatMatchupMetric(metric, 'away')}</span>
        <span><small>{home.abbreviation}</small>{formatMatchupMetric(metric, 'home')}</span>
      </div>)}
      {assessment.limitations.length > 0 && <div className="matchup-limitations"><b>Limits</b><ul>{assessment.limitations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    </div>
  </details>;
}

export function ConsumerMatchupBoard({ board, home, away }: {
  board: MatchupBoard;
  home: ConsumerTeam;
  away: ConsumerTeam;
}) {
  const summary = supportedMatchupSummary(board);
  return <section className="matchup-board-section" data-section="matchup-board">
    <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Pregame matchup evidence</p><h2>Matchup Board</h2></div><span className={`matchup-board-status status-${board.status}`}>{board.status}</span></div>
    <p className="consumer-note">Only supported evidence available before kickoff is used. These assessments do not change the Gridline prediction.</p>
    <div className="matchup-biggest">
      <h3>Where Gridline sees the biggest matchup advantages</h3>
      {summary.length ? <div>{summary.map((item) => <article key={item.category}><strong>{item.label}</strong><span>{item.title}</span><small>{item.evidence}</small></article>)}</div>
        : <p><AlertTriangle aria-hidden="true" /> No sufficiently supported advantage is available yet.</p>}
    </div>
    <div className="matchup-team-labels" aria-hidden="true"><span>{away.abbreviation}</span><span>Assessment</span><span>{home.abbreviation}</span></div>
    <div className="matchup-assessments">{board.assessments.map((assessment) =>
      <Assessment assessment={assessment} home={home} away={away} key={assessment.category} />)}</div>
    <footer>Sources: {board.sources.join(' · ') || 'No supported sources'} · Pregame evidence through {new Date(board.sourceCutoff).toLocaleString()} · {board.completeness.supportedCategories}/{board.completeness.totalCategories} categories supported</footer>
  </section>;
}