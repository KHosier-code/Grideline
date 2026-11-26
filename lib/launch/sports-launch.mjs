// When college basketball opens to the public. Shared by the website, its
// server (sitemap and page metadata) and the API, so they all flip together.
//
// To move the launch, change this one line. 11:00 UTC is 6 AM Eastern in December.
export const CBB_PUBLIC_LAUNCH = '2026-12-01T11:00:00Z';

// College pages carry a small "New: tracking since Nov 2" note until this date.
export const CBB_NEW_NOTE_UNTIL = '2027-02-01T05:00:00Z';

/** True once college basketball is open to everyone, not only administrators. */
export function isCbbPublic(now = Date.now()) {
  return now >= Date.parse(CBB_PUBLIC_LAUNCH);
}

// College picks (the daily card, leans and their record) stay admin-only even
// after launch: in private tracking from Nov 2 they went 43-57 against the
// spread. Power ratings and team stats are what goes public. Set to true to
// publish picks again; nothing else needs to change.
export const CBB_PICKS_PUBLIC = false;

/** True when everyone may see college picks: never before launch, and only if CBB_PICKS_PUBLIC. */
export function isCbbPicksPublic(now = Date.now()) {
  return CBB_PICKS_PUBLIC && isCbbPublic(now);
}

/** True while college pages should still say they're new. */
export function showCbbNewNote(now = Date.now()) {
  return now < Date.parse(CBB_NEW_NOTE_UNTIL);
}

// The bowl pool page opens the afternoon the bowl matchups are announced
// (Sunday, December 6). Before then only administrators see it.
// 17:00 UTC is noon Eastern in December.
export const BOWLS_PUBLIC_LAUNCH = '2026-12-06T17:00:00Z';

/** True once the bowl pool page is open to everyone. */
export function isBowlsPublic(now = Date.now()) {
  return now >= Date.parse(BOWLS_PUBLIC_LAUNCH);
}
