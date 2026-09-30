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
