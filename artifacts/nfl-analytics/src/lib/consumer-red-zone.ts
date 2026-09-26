/** Presentation boundary for the source-backed red-zone read model.
 * Unknown/missing fields stay unavailable; never infer an opportunity from a TD.
 */
export type RedZonePeriod = 'season' | 'last3';
export type RedZoneZone = 20 | 10 | 5;
export type RedZoneStat = 'targets' | 'carries' | 'targetShare' | 'carryShare' | 'receivingTds' | 'rushingTds' | 'snaps' | 'snapPct';
export type RedZoneCoverage = { coveredWeeks: number[]; missingWeeks: number[]; firstCoveredKickoff: string | null; lastCoveredKickoff: string | null };
export type RedZoneWindow = RedZoneCoverage & { gamesPlayed: number | null; sampleGames: number | null; includedGames: number | null; snapGames: number | null; status: string; reason: string | null; stats: Record<RedZoneStat, number | null> };
export type RedZonePlayer = { playerId: string; playerName: string; team: string; position: string; season: RedZoneWindow; last3: RedZoneWindow };
export type RedZoneResponse = RedZoneCoverage & { season: number | null; status: string; players: RedZonePlayer[]; sourceUpdatedAt: string | null; ingestedAt: string | null; partialReasons: string[]; availableTeams: string[]; availableSeasons: number[] };

type Raw = Record<string, unknown>;
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const numeric = (value: unknown): number | null => {
  if (value && typeof value === 'object') {
    const metric = object(value);
    return metric.available === false ? null : number(metric.value);
  }
  return number(value);
};

export function normalizeRedZoneWindow(value: unknown, selectedZone: RedZoneZone = 20, responseStatus?: string): RedZoneWindow {
  const raw = object(value);
  const sourceCoverage = object(raw.sourceCoverage);
  const requestedGames = number(sourceCoverage.requestedGames);
  const includedGames = number(sourceCoverage.includedGames);
  const missingGames = Array.isArray(sourceCoverage.missingGames) ? sourceCoverage.missingGames : [];
  const zones = Array.isArray(raw.zones) ? raw.zones : [];
  const selected = zones.find(zone => object(zone).zone === selectedZone);
  const metrics = object(selected ?? raw.metrics ?? raw.aggregate ?? raw);
  const read = (...keys: string[]) => {
    for (const key of keys) if (key in metrics) return numeric(metrics[key]);
    for (const key of keys) if (key in raw) return numeric(raw[key]);
    return null;
  };
  return {
    coveredWeeks: normalizeWeeks(sourceCoverage.coveredWeeks ?? raw.coveredWeeks),
    missingWeeks: normalizeWeeks(sourceCoverage.missingWeeks ?? raw.missingWeeks),
    firstCoveredKickoff: text(sourceCoverage.firstCoveredKickoff ?? raw.firstCoveredKickoff),
    lastCoveredKickoff: text(sourceCoverage.lastCoveredKickoff ?? raw.lastCoveredKickoff),
    gamesPlayed: number(raw.gamesPlayed),
    sampleGames: requestedGames ?? number(raw.sampleGames),
    includedGames,
    snapGames: number(raw.snapGames),
    // Player/team coverage takes precedence over league-level completeness.
    status: requestedGames !== null && includedGames !== null
      ? includedGames === 0 ? 'unavailable' : includedGames < requestedGames ? 'partial' : 'available'
      : text(raw.status) ?? (selected || raw.metrics ? responseStatus ?? 'available' : 'unavailable'),
    reason: text(raw.reason) ?? (missingGames.length ? `${missingGames.length} appearance${missingGames.length === 1 ? '' : 's'} without verified play-by-play` : null),
    stats: {
      targets: read('targets', 'redZoneTargets'),
      carries: read('carries', 'redZoneCarries'),
      targetShare: read('targetShare', 'teamTargetShare'),
      carryShare: read('carryShare', 'teamCarryShare'),
      receivingTds: read('receivingTouchdowns', 'receivingTds', 'receivingTD', 'receivingTd'),
      rushingTds: read('rushingTouchdowns', 'rushingTds', 'rushingTD', 'rushingTd'),
      snaps: read('snaps', 'offenseSnaps'),
      snapPct: read('snapPct', 'snapShare', 'offenseSnapPct', 'offensePct'),
    },
  };
}

function normalizeWeeks(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(number).filter((week): week is number => week !== null && Number.isInteger(week) && week > 0))]
      .sort((left, right) => left - right)
    : [];
}

/** A stable, human-readable source span; UTC avoids dates shifting with browser locale. */
export function formatRedZoneDateRange(first: string | null, last: string | null): string | null {
  if (!first) return null;
  const start = new Date(first);
  const end = last ? new Date(last) : start;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const year = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fullDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (start.getTime() === end.getTime()) return fullDate.format(start);
  if (year === endYear) return `${monthDay.format(start)}–${monthDay.format(end)}, ${year}`;
  return `${fullDate.format(start)}–${fullDate.format(end)}`;
}

export function formatRedZoneCoverage(coverage: RedZoneCoverage): string {
  const weeks = (values: number[]) => {
    const normalized = normalizeWeeks(values);
    return normalized.length ? normalized.map(week => `Week ${week}`).join(', ') : 'none';
  };
  const range = formatRedZoneDateRange(coverage.firstCoveredKickoff, coverage.lastCoveredKickoff);
  return [
    `Covered ${weeks(coverage.coveredWeeks)}`,
    range ? range : null,
    coverage.missingWeeks.length ? `missing ${weeks(coverage.missingWeeks)}` : null,
  ].filter(Boolean).join(' · ');
}

export function normalizeRedZoneResponse(value: unknown, selectedPeriod: RedZonePeriod = 'season', selectedZone: RedZoneZone = 20): RedZoneResponse {
  const raw = object(value);
  const coverage = object(raw.sourceCoverage ?? raw.coverage);
  const players = Array.isArray(raw.players) ? raw.players : [];
  const teams = Array.isArray(raw.availableTeams) ? raw.availableTeams : [];
  const seasons = Array.isArray(raw.availableSeasons) ? raw.availableSeasons : [];
  return {
    season: number(raw.season),
    status: text(raw.status) ?? 'unavailable',
    coveredWeeks: normalizeWeeks(coverage.coveredWeeks ?? raw.coveredWeeks),
    missingWeeks: normalizeWeeks(coverage.missingWeeks ?? raw.missingWeeks),
    firstCoveredKickoff: text(coverage.firstCoveredKickoff ?? raw.firstCoveredKickoff),
    lastCoveredKickoff: text(coverage.lastCoveredKickoff ?? raw.lastCoveredKickoff),
    players: players.map((item) => {
      const p = object(item);
      const windows = object(p.windows ?? p.periods);
      return {
        playerId: text(p.playerId) ?? '',
        playerName: text(p.playerName ?? p.name) ?? 'Name unavailable',
        team: text(p.team ?? p.teamId) ?? 'Team unavailable',
        position: text(p.position) ?? '—',
        season: normalizeRedZoneWindow(windows.season ?? (typeof p.season === 'object' ? p.season : undefined) ?? (selectedPeriod === 'season' ? p : undefined), selectedZone, text(raw.status) ?? undefined),
        last3: normalizeRedZoneWindow(windows.last3 ?? p.last3 ?? (selectedPeriod === 'last3' ? p : undefined), selectedZone, text(raw.status) ?? undefined),
      };
    }),
    sourceUpdatedAt: text(raw.sourceUpdatedAt ?? coverage.sourceUpdatedAt ?? raw.sourceTimestamp),
    ingestedAt: text(raw.ingestedAt ?? coverage.ingestedAt ?? raw.lastIngestedAt),
    partialReasons: [
      ...(Array.isArray(raw.partialReasons) ? raw.partialReasons : Array.isArray(coverage.partialReasons) ? coverage.partialReasons : []),
      ...(Array.isArray(coverage.missingGames) && coverage.missingGames.length ? [`${coverage.missingGames.length} completed game${coverage.missingGames.length === 1 ? '' : 's'} without play-by-play coverage.`] : []),
    ].filter((reason): reason is string => typeof reason === 'string'),
    availableTeams: teams.map((team) => text(object(team).abbreviation ?? team)).filter((team): team is string => team !== null),
    availableSeasons: seasons.map(number).filter((season): season is number => season !== null),
  };
}

export function formatRedZoneValue(value: number | null, percent = false): string {
  if (value === null) return '—';
  // Gridline usage shares are represented as ratios (0..1), not percentage points.
  return percent ? `${(value * 100).toFixed(1)}%` : String(value);
}

/** Schedule payloads can carry a string abbreviation or a team object. Never render an object as an option child. */
export function scheduleTeamAbbreviation(value: unknown): string | null {
  return text(value) ?? text(object(value).abbreviation);
}

export const RED_ZONE_FALLBACK_LABEL = 'Incomplete Player Usage · Red-zone-only evidence';

/** Rank verified opportunities for one matchup team. Missing metrics are not zero;
 * a player with no count evidence sorts after every player with a known count.
 */
export function selectRedZoneFallback(players: RedZonePlayer[], team: string, period: RedZonePeriod = 'season', limit = 3): RedZonePlayer[] {
  const opportunity = (player: RedZonePlayer): number | null => {
    const { targets, carries } = player[period].stats;
    return targets === null && carries === null ? null : (targets ?? 0) + (carries ?? 0);
  };
  return players.filter(player => player.team === team && Boolean(player.playerId))
    .sort((left, right) => {
      const a = opportunity(left);
      const b = opportunity(right);
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      return (b ?? 0) - (a ?? 0) || left.playerName.localeCompare(right.playerName) || left.playerId.localeCompare(right.playerId);
    })
    .slice(0, limit);
}

export function sortRedZonePlayers(players: RedZonePlayer[], period: RedZonePeriod, column: RedZoneStat | 'playerName' | 'gamesPlayed', direction: 'asc' | 'desc'): RedZonePlayer[] {
  return [...players].sort((a, b) => {
    const left = column === 'playerName' ? a.playerName : column === 'gamesPlayed' ? a[period].gamesPlayed : a[period].stats[column];
    const right = column === 'playerName' ? b.playerName : column === 'gamesPlayed' ? b[period].gamesPlayed : b[period].stats[column];
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const result = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : (Number(left) - Number(right));
    return (direction === 'asc' ? result : -result) || a.playerName.localeCompare(b.playerName);
  });
}

export function readableTime(value: string | null): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date);
}