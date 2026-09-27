import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, gamesTable, nflversePlayerIdentitiesTable, playerAvailabilitySourcesTable, teamsTable } from "@workspace/db";

export type AvailabilityCapture = {
  kind: "game-roster" | "injury-clearance";
  sourceUrl: string;
  gameId: string;
  team: string;
  playerId: string;
  playerName: string;
  /** Exact published passage containing BOTH teams, binding the observation to this game. */
  gameExcerpt: string;
  /** Exact published passage naming the player and positively asserting their status. */
  playerExcerpt: string;
};

const affirmative: Record<AvailabilityCapture["kind"], RegExp> = {
  "game-roster": /\b(active for (?:today'?s|the|this) game|on the (?:game.day |game )?active roster|will be active (?:for|against)|is active (?:for|against))\b/i,
  "injury-clearance": /\b(cleared to play|cleared for (?:today'?s|the|this) game|will play (?:against|on)|available to play)\b/i,
};

function visible(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}

function publishedAt(html: string): Date {
  const raw = html.match(/<meta\b(?=[^>]*(?:property|name)=["'](?:article:published_time|datePublished)["'])[^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1];
  // No fallback to the fetch time: the publisher must identify when it made
  // this assertion public. A changing live page without a date is not proof.
  if (!raw || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(raw) || !/(?:Z|[+-]\d\d:\d\d)$/.test(raw)) {
    throw new Error("Source has no explicit publication instant");
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid source publication instant");
  return date;
}

export function verifyPublishedAvailability(
  input: AvailabilityCapture, html: string, observedAt: Date,
  context: { home: string; away: string; kickoff: Date; providerId: string },
) {
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.nfl.com"
    || !/^\/(?:news|inactives|injuries)\//.test(url.pathname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("Only public official NFL article/report URLs are accepted");
  }
  if (html.length < 100 || html.length > 2_000_000) throw new Error("Missing or oversized publisher response");
  if (!Number.isFinite(observedAt.getTime()) || !Number.isFinite(context.kickoff.getTime())
    || observedAt >= context.kickoff || !context.providerId) throw new Error("Observation must precede kickoff");
  if (input.kind === "game-roster" && context.kickoff.getTime() - observedAt.getTime() > 24 * 60 * 60 * 1000) {
    throw new Error("Game-day roster observation must be within 24 hours of kickoff");
  }
  const publicationAt = publishedAt(html);
  if (publicationAt > observedAt || publicationAt.getTime() > context.kickoff.getTime()
    || observedAt.getTime() - publicationAt.getTime() > 48 * 60 * 60 * 1000) {
    throw new Error("Publication is future-dated or stale");
  }
  const body = visible(html).toLowerCase();
  const gameExcerpt = input.gameExcerpt.replace(/\s+/g, " ").trim();
  const playerExcerpt = input.playerExcerpt.replace(/\s+/g, " ").trim();
  if (!gameExcerpt || gameExcerpt.length > 1000 || !body.includes(gameExcerpt.toLowerCase())
    || !gameExcerpt.toLowerCase().includes(context.home.toLowerCase())
    || !gameExcerpt.toLowerCase().includes(context.away.toLowerCase())) {
    throw new Error("Published game passage must identify both teams");
  }
  if (!playerExcerpt || playerExcerpt.length > 1000 || !body.includes(playerExcerpt.toLowerCase())
    || !playerExcerpt.toLowerCase().includes(input.playerName.toLowerCase())
    || !affirmative[input.kind].test(playerExcerpt)
    || /\b(not|won't|unlikely|inactive|questionable|doubtful|ruled out)\b/i.test(playerExcerpt)) {
    throw new Error("Published player passage does not affirm availability");
  }
  if (input.kind === "game-roster" && url.pathname.startsWith("/injuries/")) {
    throw new Error("An injury report is not a game roster");
  }
  return {
    ...input, providerId: context.providerId, publisher: "NFL",
    sourceHash: createHash("sha256").update(html).digest("hex"),
    sourceBody: html, publicationAt, observedAt, assertion: input.kind === "game-roster" ? "active" : "cleared",
    excerpt: `${gameExcerpt}\n${playerExcerpt}`,
  };
}

/** Explicit operator capture; never run as an unreviewed scheduled scraper.
 * Source text is fetched from the publisher, not supplied by the operator. */
export async function captureVerifiedPlayerAvailability(input: AvailabilityCapture) {
  if (!input.gameId || !input.playerId || !input.playerName || !input.team
    || !["game-roster", "injury-clearance"].includes(input.kind)) throw new Error("Incomplete availability capture");
  // Validate the URL before making a network request.
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.nfl.com"
    || !/^\/(?:news|inactives|injuries)\//.test(url.pathname) || url.search || url.hash
    || url.username || url.password) throw new Error("Unapproved source URL");
  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.gameId, input.gameId)).limit(1);
  if (!game?.kickoffTime || !/scheduled|pregame/i.test(game.gameStatus)) throw new Error("Game is not upcoming");
  const teamRows = await db.select({ id: teamsTable.teamId, name: teamsTable.teamName,
    abbr: teamsTable.abbreviation }).from(teamsTable);
  const home = teamRows.find(t => t.id === game.homeTeamId);
  const away = teamRows.find(t => t.id === game.awayTeamId);
  if (!home || !away || ![home.abbr, away.abbr].includes(input.team)) throw new Error("Team does not belong to game");
  const identities = await db.select({ providerId: nflversePlayerIdentitiesTable.espnId,
    name: nflversePlayerIdentitiesTable.displayName }).from(nflversePlayerIdentitiesTable)
    .where(and(eq(nflversePlayerIdentitiesTable.gsisId, input.playerId)))
    .orderBy(nflversePlayerIdentitiesTable.observedAt);
  const ids = new Set(identities.map(x => x.providerId).filter((x): x is string => !!x));
  if (ids.size !== 1 || !identities.some(x => x.name.toLowerCase() === input.playerName.toLowerCase())) {
    throw new Error("Unresolved or conflicting player identity");
  }
  const response = await fetch(input.sourceUrl, { headers: { Accept: "text/html" },
    redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Publisher did not serve HTML");
  if (response.url !== input.sourceUrl) throw new Error("Publisher redirected the source URL");
  const html = await response.text();
  const row = verifyPublishedAvailability(input, html, new Date(),
    { home: home.name, away: away.name, kickoff: game.kickoffTime, providerId: [...ids][0]! });
  const [saved] = await db.insert(playerAvailabilitySourcesTable).values(row)
    .returning({ id: playerAvailabilitySourcesTable.id });
  return saved.id;
}