/** Bowl pool sheets: shapes written by research/pools/bowls_daily.py, and helpers for the page. */

export type BowlScoring = 'confidence' | 'straight';
export type BowlPoolType = 'casual' | 'mixed' | 'sharp';

export type BowlTeam = {
  id: string | null; abbr: string | null; name: string; logo: string | null; color: string | null;
  rank: number | null; record: string | null; home: boolean; moneyline: number | null;
  /** Share of ESPN Bowl Mania players picking this team, by scoring format. */
  crowdStraight: number | null; crowdConfidence: number | null;
};
export type BowlGame = {
  id: string; bowl: string; kickoff: string | null; status: string;
  /** Chance the first team wins, from the betting line. */
  winA: number; lineSource: string | null;
  /** 0 or 1 once the game is final. */
  winner: 0 | 1 | null;
  teams: [BowlTeam, BowlTeam];
};
export type BowlSheet = {
  /** Per game: 0 = first team, 1 = second team. */
  picks: Array<0 | 1>;
  points: number[];
  /** Estimated chance of finishing first, from simulations; null when the sheet is plain chalk without crowd data. */
  win: number | null; chalkWin: number | null; fair: number;
  /** False when there was no real crowd data and the sheet is every favorite. */
  tuned: boolean;
};
export type BowlsReport = {
  season: number; generatedAt: string; firstKickoff: string | null;
  poolSizes: number[]; poolTypes: BowlPoolType[]; scorings: BowlScoring[];
  crowd: Record<BowlScoring, { available: boolean; entries: number | null }>;
  games: BowlGame[];
  sheets: Record<string, BowlSheet>;
};

export const POOL_TYPE_LABELS: Record<BowlPoolType, { label: string; hint: string }> = {
  casual: { label: 'Casual', hint: 'Most people pick teams they like.' },
  mixed: { label: 'Mixed', hint: 'Some pick favorites, some love upsets.' },
  sharp: { label: 'Sharp', hint: 'A few people check the betting odds too.' },
};

export const SCORING_LABELS: Record<BowlScoring, { label: string; hint: string }> = {
  confidence: { label: 'Confidence points', hint: 'Rank every game; your surest pick is worth the most.' },
  straight: { label: 'One point a game', hint: 'Every correct pick is worth the same.' },
};

export const sheetKey = (scoring: BowlScoring, size: number, type: BowlPoolType) => `${scoring}-${size}-${type}`;

/** "about 25 people"; the largest size covers anything bigger. */
export const poolSizeLabel = (size: number, sizes: number[]) =>
  size === Math.max(...sizes) ? `${size}+ people` : `about ${size} people`;

export const pct = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;

/** Chance of finishing first, shown with enough precision for small numbers. */
export const winPct = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 0.095) return `${Math.round(value * 100)}%`;
  if (value >= 0.001) return `${(value * 100).toFixed(1)}%`;
  return 'under 0.1%';
};

const crowdShare = (team: BowlTeam, scoring: BowlScoring) => scoring === 'confidence' ? team.crowdConfidence : team.crowdStraight;

export type SheetRow = {
  game: BowlGame;
  pickIndex: 0 | 1;
  pick: BowlTeam;
  opponent: BowlTeam;
  /** Our pick's chance to win, from the line. */
  chance: number;
  points: number;
  /** Share of the pool format's players who made the same pick. */
  crowd: number | null;
  /** We picked the betting underdog. */
  upset: boolean;
  /** We picked the favorite, but most players picked the other team. */
  crowdMisses: boolean;
  result: 'win' | 'loss' | null;
};

/** The sheet as rows: by points (confidence) or by date (one point a game). */
export function sheetRows(report: BowlsReport, scoring: BowlScoring, size: number, type: BowlPoolType): SheetRow[] {
  const sheet = report.sheets[sheetKey(scoring, size, type)];
  if (!sheet) return [];
  const rows = report.games.map((game, index): SheetRow => {
    const pickIndex = sheet.picks[index] ?? 0;
    const pick = game.teams[pickIndex];
    const opponent = game.teams[pickIndex === 0 ? 1 : 0];
    const chance = pickIndex === 0 ? game.winA : 1 - game.winA;
    const crowd = crowdShare(pick, scoring);
    return {
      game, pickIndex, pick, opponent, chance, points: sheet.points[index] ?? 1, crowd,
      upset: chance < 0.5,
      crowdMisses: chance >= 0.5 && crowd !== null && crowd < 0.5,
      result: game.winner === null ? null : game.winner === pickIndex ? 'win' : 'loss',
    };
  });
  return scoring === 'confidence'
    ? rows.sort((a, b) => b.points - a.points)
    : rows.sort((a, b) => (a.game.kickoff ?? '').localeCompare(b.game.kickoff ?? '') || a.game.bowl.localeCompare(b.game.bowl));
}

/** Bowls where most players backed the betting underdog, biggest gap first. */
export function crowdMistakes(report: BowlsReport, scoring: BowlScoring) {
  return report.games.flatMap(game => {
    const favoriteIndex = game.winA >= 0.5 ? 0 : 1;
    const favorite = game.teams[favoriteIndex];
    const share = crowdShare(favorite, scoring);
    if (share === null || share >= 0.5) return [];
    const chance = favoriteIndex === 0 ? game.winA : 1 - game.winA;
    return [{ game, favorite, underdog: game.teams[favoriteIndex === 0 ? 1 : 0], chance, crowd: share, gap: chance - share }];
  }).sort((a, b) => b.gap - a.gap);
}

/** Points earned and possible so far, once games are final. */
export function sheetScore(rows: SheetRow[]) {
  const done = rows.filter(row => row.result !== null);
  return {
    games: done.length, wins: done.filter(row => row.result === 'win').length,
    points: done.reduce((sum, row) => sum + (row.result === 'win' ? row.points : 0), 0),
    possible: done.reduce((sum, row) => sum + row.points, 0),
  };
}

/** Plain text for pasting into a pool site or a message. */
export function sheetText(rows: SheetRow[], scoring: BowlScoring) {
  const lines = rows.map(row => `${row.game.bowl}: ${row.pick.name}${scoring === 'confidence' ? ` (${row.points})` : ''}`);
  return [`Bowl pool picks from probablesports.com/pools/bowls`, ...lines].join('\n');
}

/** Pools usually lock at the first kickoff. */
export const poolsLocked = (report: BowlsReport, now = Date.now()) =>
  report.firstKickoff !== null && Date.parse(report.firstKickoff) <= now;
