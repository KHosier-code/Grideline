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
