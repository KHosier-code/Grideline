import type { ConsumerContext, ConsumerContextTeam, ConsumerDepthPlayer, ConsumerInjuryPlayer } from '@workspace/api-client-react';

const groupOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];

function positionGroup(position: string) {
  if (['LT', 'LG', 'C', 'RG', 'RT', 'T', 'G', 'OT'].includes(position)) return 'OL';
  if (['DE', 'DT', 'NT', 'EDGE'].includes(position)) return 'DL';
  if (['ILB', 'OLB', 'MLB'].includes(position)) return 'LB';
  if (['FS', 'SS', 'DB'].includes(position)) return 'S';
  return position;
}

function PlayerRow({ player }: { player: ConsumerDepthPlayer }) {
  const role = player.role.replaceAll('_', ' ');
  const receiverSlot = player.position === 'WR'
    ? player.lineupSlot === 'LWR' ? 'WR1'
      : player.lineupSlot === 'RWR' ? 'WR2'
        : player.lineupSlot === 'SWR' ? 'Slot WR'
          : null
    : null;
  const status = player.injuryStatus ?? player.practiceStatus;
  return (
    <details className="depth-player">
      <summary>
        <span className="depth-rank">{player.depthRank ?? '–'}</span>
        <span className="depth-player-main"><strong>{player.name}</strong><small>{[receiverSlot, role].filter(Boolean).join(' · ')}</small></span>
        <span className={`depth-badge depth-${player.role}`}>{player.sourceLabel}</span>
        {status && <span className="depth-badge depth-injury">{status}</span>}
      </summary>
      <div className="depth-player-detail">
        <span><small>Recent snaps</small>{player.recentSnapShare === null ? 'Unavailable' : `${Math.round(player.recentSnapShare * 100)}%`}</span>
        <span><small>Depth rank</small>{player.depthRank ?? 'Unavailable'}</span>
        <span><small>Injury / practice</small>{[player.injuryStatus, player.practiceStatus].filter(Boolean).join(' · ') || 'No current status available'}</span>
        <span><small>Starter confidence</small>{player.starterConfidence === null ? 'Unavailable' : `${Math.round(player.starterConfidence)}/100`}</span>
        {player.evidenceSummary && <p>{player.evidenceSummary}</p>}
      </div>
    </details>
  );
}

function InjuryRow({ player }: { player: ConsumerInjuryPlayer }) {
  return <li className="injury-player">
    <div><strong>{player.name}</strong><span>{player.position ?? 'Position unavailable'}</span></div>
    <p>{player.injury ?? 'Injury description unavailable'}</p>
    <div className="injury-statuses">
      {player.gameStatus && <span>{player.gameStatus}</span>}
      {player.practiceStatus && <span>{player.practiceStatus}</span>}
      {!player.gameStatus && !player.practiceStatus && <span>Status unavailable</span>}
    </div>
  </li>;
}

function TeamDepth({ team }: { team: ConsumerContextTeam }) {
  return (
    <article className="depth-team">
      <header><div><p>{team.side} team</p><h3>{team.abbreviation} <span>{team.name}</span></h3></div><small>{team.depthFreshness} · {team.asOf ? `as of ${new Date(team.asOf).toLocaleString()}` : 'cutoff unavailable'}</small></header>
      {(['offense', 'defense'] as const).map((unit) => {
        const players = team.depth.filter((player) => player.unit === unit);
        return <section className="depth-unit" key={unit}><h4>{unit}</h4>{players.length ? groupOrder.map((group) => {
          const grouped = players.filter((player) => positionGroup(player.position) === group);
          return grouped.length ? <div className="depth-position" key={group}><b>{group}</b><div>{grouped.map((player) => <PlayerRow player={player} key={`${player.name}-${player.position}-${player.depthRank}`} />)}</div></div> : null;
        }) : <p className="depth-empty">Supported {unit} depth evidence is not yet available.</p>}</section>;
      })}
      <section className="injury-report" aria-label={`${team.name} injury report`}>
        <div className="injury-report-heading"><h4>Injury report</h4><span className={`market-state market-state-${team.injuryReportStatus}`}>{team.injuryReportStatus}</span></div>
        {team.injuries.length
          ? <ul>{team.injuries.map((player) => <InjuryRow player={player} key={`${player.name}-${player.position ?? 'unknown'}`} />)}</ul>
          : <p className="depth-empty">No current injury report was available at the matchup cutoff.</p>}
      </section>
    </article>
  );
}

export function ConsumerDepthChart({ context }: { context: ConsumerContext }) {
  return (
    <section className="depth-section" data-section="personnel" data-testid="premium-depth-chart" aria-labelledby="personnel-heading">
      <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Personnel evidence</p><h2 id="personnel-heading">Likely roles and depth</h2></div></div>
      {context.teams.some((team) => team.depth.length) ? <div className="depth-teams">{context.teams.map((team) => <TeamDepth team={team} key={team.side} />)}</div> : <div className="depth-fallback"><strong>Depth chart updating</strong><p>{context.message ?? 'Supported player roles are not yet available for this matchup.'}</p></div>}
    </section>
  );
}