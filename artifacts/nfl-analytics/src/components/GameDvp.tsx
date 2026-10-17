import { Link } from 'wouter';
import { TeamLogo } from './TeamLogo';
import { rankCellStyle, teamName } from '@/lib/team-colors';
import { POSITIONS, TONE_LABEL, defenseLine, matchupTone, type MatchupTone, type Position } from '@/lib/dvp-matchups';
import { normalizeTeam } from '@/lib/parlay';
import { fixed, pct, useUsageReport, type UsageReport } from '@/lib/usage-report';

const PILL: Record<MatchupTone, string> = { favorable: 'win', tough: 'loss', neutral: 'small' };

/** "Favorable" / "Tough" / "Neutral" for a defense's rank against a position. */
export function MatchupTag({ rank, prefix }: { rank: number | null | undefined; prefix?: string }) {
  const tone = matchupTone(rank);
  if (!tone) return <span className="gl-muted">—</span>;
  return <span className={`gl-pill ${PILL[tone]}`} title={`Defense ranks #${rank} of 32 in PPR points allowed to this position (1 allows the most)`}>
    {prefix ? `${prefix} · ` : ''}{TONE_LABEL[tone]}
  </span>;
}

/** Normalized names (see playerKey) by injury status, from the game's injury report. */
export type InjuryNames = { out: Set<string>; questionable: Set<string> };

/** "D.J. Moore Jr." → "dj moore", so injury report and usage names match. */
export const playerKey = (name: string) => name.toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();

/** The offense's main healthy player at a position, by the share that matters for it. */
function keyPlayer(report: UsageReport, team: string, position: Position, injuries?: InjuryNames) {
  const code = normalizeTeam(team);
  const players = report.players.filter(player => normalizeTeam(player.team) === code && player.position === position && player.season.games > 0
    && !injuries?.out.has(playerKey(player.name)));
  const score = (player: typeof players[number]) => position === 'QB' ? player.season.passingYardsPerGame ?? 0
    : position === 'RB' ? player.season.carryShare ?? 0 : player.season.targetShare ?? 0;
  const best = [...players].sort((a, b) => score(b) - score(a))[0];
  if (!best) return null;
  const detail = position === 'QB' ? `${fixed(best.season.passingYardsPerGame, 0)} pass yds / g`
    : position === 'RB' ? `${pct(best.season.carryShare)} of carries` : `${pct(best.season.targetShare)} of targets`;
  return { name: best.name, detail, questionable: Boolean(injuries?.questionable.has(playerKey(best.name))) };
}

function Side({ report, offense, defense, injuries }: { report: UsageReport; offense: string; defense: string; injuries?: InjuryNames }) {
  return <div className="gl-card gl-table-wrap">
    <table className="gl-table gl-game-dvp">
      <caption className="sr-only">{teamName(normalizeTeam(offense))} offense against what {teamName(normalizeTeam(defense))} allows by position</caption>
      <thead><tr>
        <th scope="col"><span className="gl-dvp-head"><TeamLogo team={normalizeTeam(offense)} size={22} />{offense} offense vs <TeamLogo team={normalizeTeam(defense)} size={22} />{defense} defense</span></th>
        <th scope="col">PPR allowed / g</th>
        <th scope="col">Matchup</th>
      </tr></thead>
      <tbody>{POSITIONS.map(position => {
        const line = defenseLine(report, defense, position);
        const player = keyPlayer(report, offense, position, injuries);
        return <tr key={position}>
          <th scope="row"><span className={`gl-pos gl-pos-${position.toLowerCase()}`}>{position}</span>{player && <span className="gl-dvp-player"><b>{player.name}{player.questionable && <span className="gl-flag">Questionable</span>}</b><small>{player.detail}</small></span>}</th>
          <td className="gl-rank-cell">{line ? <span style={rankCellStyle(line.pprRank)}><b>{fixed(line.pprPerGame)}</b><small>#{line.pprRank}</small></span> : '—'}</td>
          <td><MatchupTag rank={line?.pprRank} /></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/** Defense vs position for both sides of one game, from the weekly usage report. */
export function GameDvp({ home, away, injuries }: { home: string; away: string; injuries?: InjuryNames }) {
  const { report } = useUsageReport();
  if (!report || !report.defenses.length) return null;
  return <section className="gl-section" aria-labelledby="game-dvp-heading">
    <div className="gl-section-head">
      <h2 id="game-dvp-heading">Defense vs position</h2>
      <p>What each defense has allowed by position through week {report.throughWeek}. Rank 1 allows the most. <Link href="/defense-vs-position" className="gl-link">All defenses ›</Link></p>
    </div>
    <div className="gl-matchup-grid">
      <Side report={report} offense={away} defense={home} injuries={injuries} />
      <Side report={report} offense={home} defense={away} injuries={injuries} />
    </div>
    <p className="gl-note">Favorable means the defense ranks in the top 8 for PPR points allowed to that position this season; tough means the bottom 8. Early in the season one big game moves these a lot.</p>
  </section>;
}
