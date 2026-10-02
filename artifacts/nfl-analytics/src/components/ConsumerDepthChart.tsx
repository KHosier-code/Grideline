import type {
  ConsumerContext,
  ConsumerContextTeam,
  ConsumerCurrentRolePlayer,
  ConsumerDefensivePlayer,
  ConsumerInjuryPlayer,
} from '@workspace/api-client-react';

type RolePlayer = Pick<ConsumerCurrentRolePlayer, 'name' | 'availability'>;

const AVAILABILITY_LABEL: Partial<Record<string, string>> = { questionable: 'Questionable', unavailable: 'Out' };

/** One role: the player, plus a status flag only when they might not play. */
function RoleEntry({ label, player, detail }: { label: string; player: RolePlayer | null; detail?: string }) {
  if (!player?.name) return null;
  const flag = AVAILABILITY_LABEL[player.availability];
  return (
    <div className="personnel-role">
      <span className="personnel-role-label">{label}</span>
      <div className="personnel-role-detail">
        <strong>{player.name}</strong>
        {detail && <span className="personnel-position">{detail}</span>}
        {flag && <span className={`gl-flag ${player.availability === 'unavailable' ? 'out' : ''}`}>{flag}</span>}
      </div>
    </div>
  );
}

function DefenseGroup({ title, players }: { title: string; players: ConsumerDefensivePlayer[] }) {
  const named = players.filter(player => player.name && player.name !== 'Player name unconfirmed');
  if (!named.length) return null;
  return (
    <div className="personnel-defense-group">
      <h5>{title}</h5>
      {named.map((player, index) => (
        <RoleEntry
          key={`${player.name}-${player.position}-${player.role ?? ''}-${index}`}
          label={player.role && !['starter', 'backup'].includes(player.role) ? player.role : player.position}
          player={player}
        />
      ))}
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
  const backs = roles.runningBackCommittee.players;
  const hasDefense = [defense.front, defense.linebackers, defense.corners, defense.safeties].some(group => group.some(player => player.name));
  return (
    <article className="depth-team">
      <header>
        <div><p>{team.side} team</p><h3>{team.abbreviation} <span>{team.name}</span></h3></div>
        {team.asOf && <small>Updated {new Date(team.asOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>}
      </header>
      <section className="depth-unit" aria-label={`${team.name} likely offensive roles`}>
        <h4>Likely offensive roles</h4>
        {team.depthFreshness !== 'current' && <p className="consumer-note">This week&apos;s depth chart isn&apos;t in yet, so roles come from recent snap counts.</p>}
        <RoleEntry label="QB" player={team.expectedQb} />
        {backs.map((player, index) => (
          <RoleEntry key={`${player.name ?? 'unknown'}-${index}`} label={backs.length > 1 ? `RB${index + 1}` : 'RB'} player={player} />
        ))}
        <RoleEntry label="WR1" player={roles.wr1} />
        <RoleEntry label="WR2" player={roles.wr2} />
        <RoleEntry label="TE" player={roles.primaryTe} />
      </section>
      {hasDefense && <section className="depth-unit" aria-label={`${team.name} defensive roles`}>
        <h4>Defensive personnel</h4>
        <div className="personnel-defense-grid">
          <DefenseGroup title="Defensive front" players={defense.front} />
          <DefenseGroup title="Linebackers" players={defense.linebackers} />
          <DefenseGroup title="Corners" players={defense.corners} />
          <DefenseGroup title="Safeties" players={defense.safeties} />
        </div>
      </section>}
      <section className="injury-report" aria-label={`${team.name} injury report`}>
        <div className="injury-report-heading"><h4>Injury report</h4></div>
        {team.injuries.length
          ? <ul>{team.injuries.map((player, index) => <InjuryRow player={player} key={`${player.name}-${player.position ?? 'unknown'}-${index}`} />)}</ul>
          : <p className="depth-empty">No injuries reported.</p>}
      </section>
    </article>
  );
}

export function ConsumerDepthChart({ context }: { context: ConsumerContext }) {
  return (
    <section className="depth-section" data-section="personnel" data-testid="premium-depth-chart" aria-labelledby="personnel-heading">
      <div className="consumer-section-heading"><div><h2 id="personnel-heading">Likely roles and depth</h2></div></div>
      {context.teams.length
        ? <div className="depth-teams">{context.teams.map((team) => <TeamDepth team={team} key={team.side} />)}</div>
        : <div className="depth-fallback"><strong>Depth chart updating</strong><p>{context.message ?? 'Supported player roles are not yet available for this matchup.'}</p></div>}
    </section>
  );
}