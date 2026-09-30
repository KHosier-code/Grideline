/** Primary team colors, keyed by the abbreviations ESPN and nflverse use. */
const TEAM_COLORS: Record<string, string> = {
  ARI: '#97233f', ATL: '#a71930', BAL: '#241773', BUF: '#00338d', CAR: '#0085ca', CHI: '#0b162a',
  CIN: '#fb4f14', CLE: '#ff3c00', DAL: '#003594', DEN: '#fb4f14', DET: '#0076b6', GB: '#203731',
  HOU: '#03202f', IND: '#002c5f', JAX: '#006778', JAC: '#006778', KC: '#e31837', LV: '#4a4f55',
  LAC: '#0080c6', LAR: '#003594', LA: '#003594', MIA: '#008e97', MIN: '#4f2683', NE: '#002244',
  NO: '#9f8958', NYG: '#0b2265', NYJ: '#125740', PHI: '#004c54', PIT: '#101820', SF: '#aa0000',
  SEA: '#002a5c', TB: '#d50a0a', TEN: '#4b92db', WAS: '#5a1414', WSH: '#5a1414',
};

export function teamColor(abbreviation: string | null | undefined) {
  return TEAM_COLORS[(abbreviation ?? '').toUpperCase()] ?? '#4b5468';
}

/**
 * Bright, recognizable team colors for charts and dots on dark or light cards:
 * a team whose primary is near-black uses its best-known secondary (Steelers
 * gold, Seahawks green, Bears orange) or a lighter shade of the primary.
 */
const TEAM_ACCENTS: Record<string, string> = {
  ARI: '#d6334f', ATL: '#e0303f', BAL: '#7b5cd6', BUF: '#2f6fde', CAR: '#0f96d6', CHI: '#e8672c',
  CIN: '#fb4f14', CLE: '#ff5a1f', DAL: '#5b86d9', DEN: '#fb6a2b', DET: '#1a96dc', GB: '#ffb612',
  HOU: '#d11f3a', IND: '#3f74c8', JAX: '#00a3b4', JAC: '#00a3b4', KC: '#e8263f', LV: '#a5acaf',
  LAC: '#1fa2e6', LAR: '#ffd100', LA: '#ffd100', MIA: '#00a6b0', MIN: '#8a5ad0', NE: '#d8243f',
  NO: '#d3bc8d', NYG: '#3a67d0', NYJ: '#23975f', PHI: '#16909c', PIT: '#ffb612', SF: '#d7262c',
  SEA: '#69be28', TB: '#e0302b', TEN: '#4b92db', WAS: '#e0a82e', WSH: '#e0a82e',
};

export function teamAccent(abbreviation: string | null | undefined) {
  return TEAM_ACCENTS[(abbreviation ?? '').toUpperCase()] ?? '#8a93a6';
}

/** Accent colors for two opponents, with the second grayed when the two would look alike. */
export function matchupAccents(first: string, second: string) {
  const a = teamAccent(first);
  const b = teamAccent(second);
  const rgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  const distance = Math.sqrt(x.reduce((sum, value, index) => sum + (value - y[index]) ** 2, 0));
  return [a, distance < 90 ? '#6b7280' : b] as const;
}

/** Dark or light badge text, whichever reads better on the team color. */
export function teamTextColor(abbreviation: string | null | undefined) {
  const hex = teamColor(abbreviation).slice(1);
  const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.2 ? '#10141f' : '#ffffff';
}

const TEAM_NAMES: Record<string, string> = {
  ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals',
  CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts',
  JAX: 'Jaguars', KC: 'Chiefs', LV: 'Raiders', LAC: 'Chargers', LA: 'Rams', LAR: 'Rams', MIA: 'Dolphins',
  MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants', NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers',
  SF: '49ers', SEA: 'Seahawks', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders', WSH: 'Commanders',
};
const ESPN_CODES: Record<string, string> = { LA: 'lar', WAS: 'wsh', JAC: 'jax' };

export function teamName(abbreviation: string) {
  return TEAM_NAMES[abbreviation.toUpperCase()] ?? abbreviation;
}

/** ESPN's team logo, the same source the schedule feed uses. */
export function teamLogoUrl(abbreviation: string) {
  const code = ESPN_CODES[abbreviation.toUpperCase()] ?? abbreviation.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`;
}

/**
 * Background for a 1-32 rank cell: green for the best ranks, red for the
 * worst, fading to neutral in the middle. Rank 1 is always best.
 */
export function rankCellStyle(rank: number | null | undefined, teams = 32) {
  if (rank === null || rank === undefined) return undefined;
  const t = (rank - 1) / (teams - 1);
  const strength = Math.abs(t - 0.5) * 2;
  const token = t < 0.5 ? '--gl-good-cell' : '--gl-bad-cell';
  return { background: `hsl(var(${token}) / ${(0.12 + strength * 0.78).toFixed(2)})` };
}
