/**
 * "If they played 100 times": win chances and outcome counts for a game.
 *
 * The final margin is modeled as normal around the expected home margin with a
 * 12-point standard deviation, the spread that best fit 1,468 games (2021-2026)
 * against the closing line. In that backtest the betting line gave more
 * accurate win chances than Gridline's model or any blend of the two, so the
 * line is the default center and our model is shown as a second opinion.
 */
export const MARGIN_SD = 12;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export const homeWinChance = (expectedHomeMargin: number) => normalCdf(expectedHomeMargin / MARGIN_SD);

/** Rounds shares to whole counts that add up to `total` (largest remainder). */
export function toCounts(shares: number[], total = 100) {
  const raw = shares.map(share => share * total);
  const counts = raw.map(Math.floor);
  let left = total - counts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => [value - Math.floor(value), index] as const).sort((a, b) => b[0] - a[0]);
  for (const [, index] of order) {
    if (left <= 0) break;
    counts[index] += 1;
    left -= 1;
  }
  return counts;
}

export type Outcome = { side: 'home' | 'away'; label: string; min: number; max: number; count: number };

/**
 * How 100 games split by winner and margin: by 15+, by 8-14 (two scores), by
 * 1-7 (one score), for each side. Counts add to 100.
 */
export function outcomeCounts(expectedHomeMargin: number): Outcome[] {
  const p = (x: number) => normalCdf((x - expectedHomeMargin) / MARGIN_SD); // P(home margin < x)
  const edges: Array<[Outcome['side'], string, number, number]> = [
    ['away', '15+', -Infinity, -14.5], ['away', '8-14', -14.5, -7.5], ['away', '1-7', -7.5, 0],
    ['home', '1-7', 0, 7.5], ['home', '8-14', 7.5, 14.5], ['home', '15+', 14.5, Infinity],
  ];
  const shares = edges.map(([, , lo, hi]) => (hi === Infinity ? 1 : p(hi)) - (lo === -Infinity ? 0 : p(lo)));
  const counts = toCounts(shares);
  return edges.map(([side, label, min, max], index) => ({ side, label, min, max, count: counts[index] }));
}

/** Small deterministic PRNG so a run can be replayed from its seed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 100 simulated home margins (whole points, no ties: overtime settles them). */
export function simulateMargins(expectedHomeMargin: number, seed: number, games = 100) {
  const random = mulberry32(seed);
  const margins: number[] = [];
  while (margins.length < games) {
    const u = Math.max(random(), 1e-12);
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    const margin = Math.round(expectedHomeMargin + z * MARGIN_SD);
    margins.push(margin === 0 ? (random() < homeWinChance(expectedHomeMargin) ? 3 : -3) : margin);
  }
  return margins;
}

/**
 * Where a run's win count usually lands: about 19 of 20 runs of `games` fall
 * inside this range (normal approximation to the binomial, clamped to 0-games).
 * An 80% favorite: 72-88.
 */
export function winRange(winChance: number, games = 100) {
  const mean = winChance * games;
  const spread = 1.96 * Math.sqrt(games * winChance * (1 - winChance));
  return { low: Math.max(0, Math.round(mean - spread)), high: Math.min(games, Math.round(mean + spread)) };
}

/** "as of Sep 30, 2:15 PM" for a capture time, or null when missing or unreadable. */
export function capturedText(capturedAt: string | null | undefined) {
  if (!capturedAt) return null;
  const when = new Date(capturedAt);
  if (Number.isNaN(when.getTime())) return null;
  return `as of ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}
