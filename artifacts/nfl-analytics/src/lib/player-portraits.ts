/**
 * The consumer API is the authority for identity reconciliation and display
 * rights. Never substitute a roster URL, a name-matched image, or a coach image.
 * This last-mile check rejects incomplete identities and unsafe image URLs.
 */
export function safeApiPlayerPortraitUrl(player: {
  playerId: string;
  name: string;
  headshotUrl: string | null;
}): string | null {
  if (!player.playerId?.trim() || !player.name?.trim() || !player.headshotUrl) return null;
  try {
    const url = new URL(player.headshotUrl, window.location.origin);
    return url.origin === window.location.origin &&
      url.pathname === `/api/verified-imagery/player/${encodeURIComponent(player.playerId)}` &&
      !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}