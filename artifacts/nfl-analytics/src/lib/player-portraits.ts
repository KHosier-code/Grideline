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
    const url = new URL(player.headshotUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      ? url.href : null;
  } catch {
    return null;
  }
}