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

/** True while college pages should still say they're new. */
export function showCbbNewNote(now = Date.now()) {
  return now < Date.parse(CBB_NEW_NOTE_UNTIL);
}
