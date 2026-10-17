import { Link } from 'wouter';
import { teamName } from '@/lib/team-colors';
import { funnel, unitEdges, type MatchupEdge } from '@/lib/matchup-edges';
import { useMatchupReport } from '@/lib/matchup-report';
import { TeamLogo } from './TeamLogo';

const MAX_PER_SIDE = 3;

function EdgeList({ offense, defense, edges }: { offense: string; defense: string; edges: MatchupEdge[] }) {
  return <div className="gl-card gl-edges-side">
    <h3><TeamLogo team={offense} size={22} /> {teamName(offense)} offense <span>vs</span> {teamName(defense)} defense</h3>
    {edges.length === 0
      ? <p className="gl-edges-none">No big mismatches: neither unit ranks top 10 where the other ranks bottom 10.</p>
      : <ul>{edges.slice(0, MAX_PER_SIDE).map(edge => <li key={edge.topic} className={`gl-edge gl-edge-${edge.favors}`}>
        <span className="gl-edge-tag">{edge.favors === 'offense' ? `Edge: ${teamName(edge.offense)} offense` : `Edge: ${teamName(edge.defense)} defense`} · {edge.topic}</span>
        <p>{edge.text}</p>
      </li>)}</ul>}
  </div>;
}

/** Where each offense's strengths meet the other defense's weaknesses (and the reverse), in plain English. */
export function MatchupEdges({ home, away }: { home: string; away: string }) {
  const { report } = useMatchupReport();
  if (!report) return null;
  const awayEdges = unitEdges(report, away, home, teamName);
  const homeEdges = unitEdges(report, home, away, teamName);
  const funnels = [funnel(report, home, teamName), funnel(report, away, teamName)].filter(item => item !== null);
  return <section className="gl-section" aria-labelledby="edges-heading">
    <div className="gl-section-head">
      <h2 id="edges-heading">Matchup edges</h2>
      <p>Top-10 units against bottom-10 units, through week {report.throughWeek}. <Link href="/matchups" className="gl-link">All teams</Link></p>
    </div>
    <div className="gl-edges">
      <EdgeList offense={away} defense={home} edges={awayEdges} />
      <EdgeList offense={home} defense={away} edges={homeEdges} />
    </div>
    {funnels.map(item => <p key={item.text} className="gl-note">{item.text}</p>)}
  </section>;
}
