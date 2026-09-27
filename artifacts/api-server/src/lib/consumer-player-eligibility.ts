import type { NflGameState } from "./game-state";

function normalizedStatus(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function statusMeaning(value: string) {
  if (/\b(?:out|inactive|ir|reserve|suspended|released)\b|injured reserve/.test(value)) {
    return "unavailable";
  }
  if (/\b(?:questionable|doubtful|limited|day to day)\b/.test(value)) {
    return "uncertain";
  }
  if (
    /\b(?:active|available|healthy|probable|playing|cleared)\b/.test(value)
    || /\bfull(?: participation)?\b/.test(value)
    || /\b(?:will|expected to) play\b/.test(value)
  ) {
    return "available";
  }
  return "unknown";
}

export function classifyPlayerEligibility(input: {
  gameState: NflGameState;
  injuryStatus?: string | null;
  rosterStatus?: string | null;
  statusAsOf?: Date | null;
  now?: Date;
  maxAgeMs?: number;
}): { status: "eligible" | "ineligible" | "unknown"; reason: string | null } {
  if (!["scheduled", "pregame"].includes(input.gameState)) {
    return { status: "ineligible", reason: `Game is ${input.gameState}.` };
  }

  const statuses = [input.injuryStatus, input.rosterStatus]
    .map(normalizedStatus)
    .filter(Boolean);
  if (!statuses.length) {
    return { status: "unknown", reason: "No current injury or roster status is available." };
  }

  const asOf = input.statusAsOf?.getTime();
  const now = (input.now ?? new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? 7 * 86_400_000;
  if (
    asOf === undefined
    || !Number.isFinite(asOf)
    || !Number.isFinite(now)
    || !Number.isFinite(maxAgeMs)
    || maxAgeMs < 0
    || asOf > now
    || now - asOf > maxAgeMs
  ) {
    return { status: "unknown", reason: "Player status evidence is missing, invalid, or stale." };
  }

  const meanings = statuses.map(statusMeaning);
  if (meanings.includes("unavailable")) {
    const status = statuses[meanings.indexOf("unavailable")];
    return { status: "ineligible", reason: `Player status is ${status}.` };
  }
  if (meanings.includes("uncertain")) {
    const status = statuses[meanings.indexOf("uncertain")];
    return { status: "unknown", reason: `Player status is uncertain (${status}).` };
  }
  if (meanings.includes("unknown")) {
    return { status: "unknown", reason: "Player status does not confirm availability." };
  }

  return { status: "eligible", reason: null };
}