/**
 * Parlay math for the builder. Legs must come from different games: legs in
 * one game move together (a team that scores a lot makes its players' TDs
 * more likely), so multiplying their chances would overstate or understate
 * the parlay. Same-game parlays need a joint simulation and are not offered.
 */
import { devig, impliedProbability } from './market';
import { mulberry32 } from './sim';

export type ParlayLeg = {
  id: string;
  kind: 'winner' | 'spread' | 'total' | 'td';
  /** The team the leg is on, for its logo. */
  team: string;
  /** Stable key for the game, shared by every leg from that game. */
  gameKey: string;
  label: string;
  detail: string;
  probability: number;
  /** Best sportsbook American price for this leg, when captured. */
  bookPrice: number | null;
  kickoff: string | null;
};

export const toDecimal = (american: number) => (american > 0 ? 1 + american / 100 : 1 + 100 / -american);

export function toAmerican(decimal: number) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export const fairAmerican = (probability: number) => toAmerican(1 / Math.min(Math.max(probability, 1e-6), 0.999999));

/** Team pair key, the same for either team's point of view. */
export const gameKeyFor = (teamA: string, teamB: string) => [teamA, teamB].map(normalizeTeam).sort().join('-');

const TEAM_ALIASES: Record<string, string> = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX' };
export const normalizeTeam = (team: string) => TEAM_ALIASES[team.toUpperCase()] ?? team.toUpperCase();

/**
 * Typical overround on a spread or total (both sides at -110). Used only when the
 * other side's price wasn't saved, so the vig can't be removed exactly.
 */
export const SIDE_MARKET_HOLD = 0.0476;

/** A side's chance from its own price and, when saved, the other side's. */
export const sideChance = (price: number, otherPrice: number | null) =>
  otherPrice !== null ? devig(price, otherPrice)[0] : impliedProbability(price) / (1 + SIDE_MARKET_HOLD);

type SideQuote = { point: number | null; price: number } | null | undefined;
export type LineMarket = { spread?: SideQuote; awaySpread?: SideQuote; total?: SideQuote; under?: SideQuote };

const signed = (point: number) => (point > 0 ? `+${point}` : point === 0 ? 'pick' : String(point));

/**
 * Spread and over/under legs for one game, from the sportsbook's saved lines.
 * Chances come from the book's two prices with its cut removed, the same
 * market that sets the payout.
 */
export function lineLegs(home: string, away: string, market: LineMarket | null | undefined, kickoff: string | null) {
  const key = gameKeyFor(home, away);
  const spreads: ParlayLeg[] = [];
  const totals: ParlayLeg[] = [];
  const homeSpread = market?.spread;
  if (homeSpread && homeSpread.point !== null) {
    const awaySpread = market?.awaySpread && market.awaySpread.point === -homeSpread.point ? market.awaySpread : null;
    const homeChance = sideChance(homeSpread.price, awaySpread?.price ?? null);
    spreads.push(
      { id: `spread-${home}-${key}`, kind: 'spread', team: home, gameKey: key, label: `${home} ${signed(homeSpread.point)}`, detail: `Spread · vs ${away}`,
        probability: homeChance, bookPrice: homeSpread.price, kickoff },
      { id: `spread-${away}-${key}`, kind: 'spread', team: away, gameKey: key, label: `${away} ${signed(-homeSpread.point)}`, detail: `Spread · at ${home}`,
        probability: 1 - homeChance, bookPrice: awaySpread?.price ?? null, kickoff },
    );
  }
  const over = market?.total;
  if (over && over.point !== null) {
    const under = market?.under && market.under.point === over.point ? market.under : null;
    const overChance = sideChance(over.price, under?.price ?? null);
    totals.push(
      { id: `over-${key}`, kind: 'total', team: home, gameKey: key, label: `Over ${over.point}`, detail: `Total points · ${away} at ${home}`,
        probability: overChance, bookPrice: over.price, kickoff },
      { id: `under-${key}`, kind: 'total', team: home, gameKey: key, label: `Under ${over.point}`, detail: `Total points · ${away} at ${home}`,
        probability: 1 - overChance, bookPrice: under?.price ?? null, kickoff },
    );
  }
  return { spreads, totals };
}

export type ParlayQuote = {
  legs: number;
  probability: number;
  fairOdds: number | null;
  /** Book parlay price when every leg has a captured price. */
  bookOdds: number | null;
  /** Expected profit or loss on a $10 bet at the book price. */
  expectedOnTen: number | null;
  sameGame: boolean;
};

export function quoteParlay(legs: ParlayLeg[]): ParlayQuote {
  const probability = legs.reduce((product, leg) => product * leg.probability, 1);
  const priced = legs.length > 0 && legs.every(leg => leg.bookPrice !== null);
  const bookDecimal = priced ? legs.reduce((product, leg) => product * toDecimal(leg.bookPrice!), 1) : null;
  const games = new Set(legs.map(leg => leg.gameKey));
  return {
    legs: legs.length,
    probability,
    fairOdds: legs.length ? fairAmerican(probability) : null,
    bookOdds: bookDecimal ? toAmerican(bookDecimal) : null,
    expectedOnTen: bookDecimal ? Math.round((probability * (bookDecimal - 1) * 10 - (1 - probability) * 10) * 100) / 100 : null,
    sameGame: games.size < legs.length,
  };
}

/**
 * 100 simulated weekends: for each, whether the parlay hit and how many legs
 * missed. Legs are independent because they come from different games.
 */
export function simulateParlay(legs: ParlayLeg[], seed: number, weekends = 100) {
  const random = mulberry32(seed);
  return Array.from({ length: weekends }, () => {
    const misses = legs.filter(leg => random() >= leg.probability).length;
    return { hit: misses === 0, misses };
  });
}

/** Adds a leg, replacing any other leg from the same game. */
export function addLeg(legs: ParlayLeg[], leg: ParlayLeg) {
  if (legs.some(item => item.id === leg.id)) return legs.filter(item => item.id !== leg.id);
  return [...legs.filter(item => item.gameKey !== leg.gameKey), leg];
}
