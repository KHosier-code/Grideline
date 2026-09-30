import { useState } from 'react';
import { teamColor, teamLogoUrl, teamTextColor } from '@/lib/team-colors';

/** Team logo with the colored abbreviation chip as a fallback. */
export function TeamLogo({ team, size = 28 }: { team: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="gl-chip" style={{ background: teamColor(team), color: teamTextColor(team), minWidth: size + 8, height: size * 0.8 }}>{team}</span>;
  }
  return <img className="gl-logo" src={teamLogoUrl(team)} alt={team} width={size} height={size} loading="lazy" onError={() => setFailed(true)} />;
}
