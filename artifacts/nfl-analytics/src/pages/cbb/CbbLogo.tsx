import type { CbbTeam } from '@/lib/cbb';
import './cbb.css';

export function CbbLogo({ team, size = 28 }: { team: CbbTeam | undefined; size?: number }) {
  if (!team?.logo) return <span className="cbb-logo-blank" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="cbb-logo" src={team.logo} alt="" width={size} height={size} loading="lazy" />;
}
