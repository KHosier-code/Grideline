export type ConsumerMarket = "spread" | "total" | "moneyline";

export const COMPLETE_GAME_MARKET_OBSERVATIONS = 12;

/**
 * Freshness follows the paid-feed schedule rather than quote-change frequency.
 * All three markets share one threshold because each complete provider event
 * contains both sides from DraftKings and FanDuel for every supported market.
 *
 * The worker runs on established weekly slots outside six hours, every
 * 12 minutes from six to one hour, and every five minutes in the final hour.
 * Each threshold includes a small allowance for worker claim and API latency.
 */
export function consumerMarketFreshnessMinutes(
  kickoffTime: Date,
  now: Date,
  _market: ConsumerMarket,
) {
  const minutesToKickoff = (kickoffTime.getTime() - now.getTime()) / 60_000;
  if (minutesToKickoff <= 60) return 8;
  if (minutesToKickoff <= 6 * 60) return 15;
  return 50 * 60;
}

export function completeGameMarketObservation(row: {
  outcome: string;
  observationsReceived: number;
  rejectedObservations: number;
}) {
  return row.outcome === "matched_saved"
    && row.observationsReceived === COMPLETE_GAME_MARKET_OBSERVATIONS
    && row.rejectedObservations === 0;
}