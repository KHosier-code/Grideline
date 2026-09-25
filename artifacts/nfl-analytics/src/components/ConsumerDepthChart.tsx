import type {
  ConsumerContext,
  ConsumerContextTeam,
  ConsumerCurrentRolePlayer,
  ConsumerDefensivePlayer,
  ConsumerInjuryPlayer,
} from '@workspace/api-client-react';

function sourceTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Source time unavailable';
  return `Source ${new Date(value).toLocaleString()}`;
}

function RoleEntry({
  label,
  player,
  detail,
}: {
  label: string;
  player: ConsumerCurrentRolePlayer | null;
  detail?: string;
}) {
  const supported = Boolean(player?.name && player.confirmed);
  return (
    <div className="personnel-role">
      <span className="personnel-role-label">{label}</span>
      <div className="personnel-role-detail">
        <strong>{player?.name ?? 'Unconfirmed'}</strong>
        {detail && <span className="personnel-position">{detail}</span>}
        <span className={`personnel-availability ${supported ? '' : 'personnel-unconfirmed'}`}>
          {player?.availability ?? 'unknown'} · {supported ? 'supported role' : 'role unconfirmed'}
        </span>
        <small>{player?.confidence == null ? 'Confidence unavailable' : `Role confidence ${Math.round(player.confidence)}/100`} · {sourceTime(player?.asOf ?? null)}</small>
      </div>
    </div>
  );
}

function Quarterback({ team }: { team: ConsumerContextTeam }) {
  const qb = team.expectedQb;
  return (
    <RoleEntry
      label="Starting QB"
      player={{
        name: qb.name,
        availability: qb.availability,
        confidence: qb.confidence,
        asOf: qb.asOf,
        confirmed: qb.confirmed,
      }}
    />
  );
}

function DefenseGroup({
  title,
  players,
}: {
  title: string;
  players: ConsumerDefensivePlayer[];
}) {
  return (
    <div className="personnel-defense-group">
      <h5>{title}</h5>
      {players.length
        ? players.map((player, index) => (
          <RoleEntry
            key={`${player.name ?? 'unknown'}-${player.position}-${player.role ?? ''}-${index}`}
            label={player.role ?? player.position}
            detail={player.role ? player.position : undefined}
            player={player}
          />
        ))
        : <p className="depth-empty">No supported role evidence — unconfirmed.</p>}
    </div>
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
  const roles = team.currentOffenseRoles;
  const defense = team.defensiveGroupings;
  return (
    <article className="depth-team">
      <header>
        <div><p>{team.side} team</p><h3>{team.abbreviation} <span>{team.name}</span></h3></div>
        <small>{team.depthFreshness} · {team.asOf ? `as of ${new Date(team.asOf).toLocaleString()}` : 'source time unavailable'}</small>
      </header>
      <section className="depth-unit" aria-label={`${team.name} likely offensive roles`}>
        <h4>Likely offensive roles</h4>
        <Quarterback team={team} />
        {roles.runningBackCommittee.players.length ? roles.runningBackCommittee.players.map((player, index) => (
          <RoleEntry
            key={`${player.name ?? 'unknown'}-${index}`}
            label={roles.runningBackCommittee.players.length > 1 ? `RB committee ${index + 1}` : 'Lead RB'}
            player={{ ...player, confirmed: player.confirmed && roles.runningBackCommittee.status === 'confirmed' }}
          />
        )) : <RoleEntry label="Lead RB / committee" player={null} />}
        <RoleEntry label="Primary TE" player={roles.primaryTe} />
        <RoleEntry label="WR1" player={roles.wr1} />
        <RoleEntry label="WR2" player={roles.wr2} />
      </section>
      <section className="depth-unit" aria-label={`${team.name} defensive roles`}>
        <h4>Defensive personnel</h4>
        <p className="consumer-note">Grouped by supported position evidence; no formation or starter is assumed from an unverified depth row.</p>
        <div className="personnel-defense-grid">
          <DefenseGroup title="Defensive front" players={defense.front} />
          <DefenseGroup title="Linebackers" players={defense.linebackers} />
          <DefenseGroup title="Corners" players={defense.corners} />
          <DefenseGroup title="Safeties" players={defense.safeties} />
        </div>
      </section>
      <section className="injury-report" aria-label={`${team.name} injury report`}>
        <div className="injury-report-heading"><h4>Injury report</h4><span className={`market-state market-state-${team.injuryReportStatus}`}>{team.injuryReportStatus}</span></div>
        {team.injuries.length
          ? <ul>{team.injuries.map((player, index) => <InjuryRow player={player} key={`${player.name}-${player.position ?? 'unknown'}-${index}`} />)}</ul>
          : <p className="depth-empty">No current injury report was available at the matchup cutoff.</p>}
      </section>
    </article>
  );
}

export function ConsumerDepthChart({ context }: { context: ConsumerContext }) {
  return (
    <section className="depth-section" data-section="personnel" data-testid="premium-depth-chart" aria-labelledby="personnel-heading">
      <div className="consumer-section-heading"><div><p className="consumer-eyebrow">Personnel evidence</p><h2 id="personnel-heading">Likely roles and depth</h2></div></div>
      {context.teams.length
        ? <div className="depth-teams">{context.teams.map((team) => <TeamDepth team={team} key={team.side} />)}</div>
        : <div className="depth-fallback"><strong>Depth chart updating</strong><p>{context.message ?? 'Supported player roles are not yet available for this matchup.'}</p></div>}
    </section>
  );
}