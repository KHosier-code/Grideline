import type {
  ConsumerContext,
  ConsumerContextTeam,
  ConsumerDepthPlayer,
  ConsumerExpectedPlayer,
  ConsumerInjuryPlayer,
} from '@workspace/api-client-react';

const groupOrder = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];

function positionGroup(position: string) {
  if (['LT', 'LG', 'C', 'RG', 'RT', 'T', 'G', 'OT'].includes(position)) return 'OL';
  if (['DE', 'DT', 'NT', 'EDGE'].includes(position)) return 'DL';
  if (['ILB', 'OLB', 'MLB'].includes(position)) return 'LB';
  if (['FS', 'SS', 'DB'].includes(position)) return 'S';
  return position;
}

function EvidenceDetail({ player }: { player: Pick<ConsumerDepthPlayer, 'provenance'> }) {
  const provenance = player.provenance;
  const evidence = [
    provenance?.source ? `Source: ${provenance.source}` : null,
    provenance?.observedAt ? `Observed: ${new Date(provenance.observedAt).toLocaleString()}` : null,
    provenance?.verifiedAt ? `Verified: ${new Date(provenance.verifiedAt).toLocaleString()}` : null,
    provenance?.verificationMethod ? `Method: ${provenance.verificationMethod}` : null,
  ].filter(Boolean);
  return evidence.length || provenance?.sourceUrl ? <p className="depth-provenance">
    {evidence.join(' · ')}
    {provenance?.sourceUrl ? <> · <a href={provenance.sourceUrl} target="_blank" rel="noreferrer">View source</a></> : null}
  </p> : null;
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
        <span className="depth-badge depth-injury">Availability: {player.availability ?? status ?? 'unknown'}</span>
      </summary>
      <div className="depth-player-detail">
        <span><small>Recent snaps</small>{player.recentSnapShare === null ? 'Unavailable' : `${Math.round(player.recentSnapShare * 100)}%`}</span>
        <span><small>Depth rank</small>{player.depthRank ?? 'Unavailable'}</span>
        <span><small>Injury / practice</small>{[player.injuryStatus, player.practiceStatus].filter(Boolean).join(' · ') || 'No current status available'}</span>
        <span><small>Starter confidence</small>{player.starterConfidence === null ? 'Unavailable' : `${Math.round(player.starterConfidence)}/100`}</span>
        {player.unavailableReason && <p>{player.unavailableReason}</p>}
        {player.evidenceSummary && <p>{player.evidenceSummary}</p>}
        <EvidenceDetail player={player} />
      </div>
    </details>
  );
}

function ExpectedPlayerRow({ player }: { player: ConsumerExpectedPlayer }) {
  return <details className="depth-player">
    <summary>
      <span className="depth-rank">{player.depthRank ?? '–'}</span>
      <span className="depth-player-main"><strong>{player.name}</strong><small>{player.position}</small></span>
      <span className="depth-badge depth-projected_starter">{player.projected ? 'Projected · not official' : 'Expected from published depth'}</span>
      <span className="depth-badge depth-injury">Availability: {player.availability}</span>
    </summary>
    <div className="depth-player-detail">
      <span><small>Expected-lineup confidence</small>{Math.round(player.confidence)}/100</span>
      <span><small>Replacement for</small>{player.replacementForPlayerName ?? 'Not a replacement'}</span>
      <p>{player.projectionReason}</p>
      <EvidenceDetail player={player} />
    </div>
  </details>;
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
  const publishedPlayers = team.depth.filter((player) =>
    player.role === 'published_starter' || player.role === 'published_backup');
  const availability = team.starterAvailabilitySummary;
  const renderUnit = (players: ConsumerDepthPlayer[], unit: 'offense' | 'defense' | 'special_teams') => (
    <section className="depth-unit" key={unit}><h4>{unit === 'special_teams' ? 'special teams' : unit}</h4>{players.length ? groupOrder.concat(unit === 'special_teams' ? ['K', 'P', 'LS'] : []).map((group) => {
      const grouped = players.filter((player) => player.unit === unit && positionGroup(player.position) === group);
      return grouped.length ? <div className="depth-position" key={group}><b>{group}</b><div>{grouped.map((player, index) => <PlayerRow player={player} key={`${player.name}-${player.position}-${player.role}-${player.depthRank}-${player.lineupSlot ?? 'none'}-${player.sourceLabel}-${index}`} />)}</div></div> : null;
    }) : <p className="depth-empty">Supported {unit === 'special_teams' ? 'special-teams' : unit} depth evidence is unavailable.</p>}</section>
  );
  return (
    <article className="depth-team">
      <header><div><p>{team.side} team</p><h3>{team.abbreviation} <span>{team.name}</span></h3></div><small>{team.depthFreshness} · {team.asOf ? `as of ${new Date(team.asOf).toLocaleString()}` : 'cutoff unavailable'}</small></header>
      {availability ? <div className="depth-availability-summary" aria-label={`${team.abbreviation} published starter availability`}>
        <span><strong>{availability.publishedStarters}</strong> published starters</span>
        <span><strong>{availability.out}</strong> out</span>
        <span><strong>{availability.questionable}</strong> questionable</span>
        <span><strong>{availability.doubtful}</strong> doubtful</span>
        <span><strong>{availability.unknown}</strong> unknown</span>
      </div> : null}
      <section className="personnel-truth-panel"><h4>Published depth</h4><p className="depth-caption">Published role and rank are preserved even when availability changes. Published depth is not a projection.</p>{(['offense', 'defense', 'special_teams'] as const).map((unit) => renderUnit(publishedPlayers, unit))}</section>
      <section className="personnel-truth-panel expected-lineup">
        <h4>Gridline expected lineup <span className="depth-badge depth-projected_starter">separate from official depth</span></h4>
        <p className="depth-caption">Status: {team.expectedLineup?.status ?? 'unavailable'}. Replacements are projected only when supporting evidence exists.</p>
        {team.expectedLineup?.players.length
          ? <div>{team.expectedLineup.players.map((player) => <ExpectedPlayerRow player={player} key={player.playerId} />)}</div>
          : <p className="depth-empty">{team.expectedLineup?.unavailableReasons.join(' ') || 'Expected lineup is unavailable.'}</p>}
      </section>
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
      <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Personnel evidence</p><h2 id="personnel-heading">Published depth, availability & expected lineup</h2><p className="consumer-note">Published roles, injury availability, and Gridline expectations are separate evidence states. Direct WR–CB coverage assignments are not available.</p></div></div>
      {context.teams.some((team) => team.depth.length || team.expectedLineup?.players.length) ? <div className="depth-teams">{context.teams.map((team) => <TeamDepth team={team} key={team.side} />)}</div> : <div className="depth-fallback"><strong>Depth chart updating</strong><p>{context.message ?? 'Supported player roles are not yet available for this matchup.'}</p></div>}
    </section>
  );
}