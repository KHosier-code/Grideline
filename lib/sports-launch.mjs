// When each sport opens to the public. Shared by the website (pages, menu,
// metadata, sitemap) and the API (/api/consumer/cbb), so they switch together.
// Plain JavaScript so serve.mjs and metadata.mjs can import it without a build.

/**
 * College basketball goes public at this moment. Before it, only
 * administrators see the college pages, tabs and data. To move the launch,
 * change this one line.
 */
export const CBB_LAUNCH_AT = '2026-12-01T06:00:00-05:00'; // 6 a.m. Eastern

/** The college pages that go in the sitemap and search results once public. */
export const CBB_PUBLIC_PATHS = ['/cbb', '/cbb/ratings', '/cbb/record', '/cbb/how-it-works'];

/** True once college basketball is open to everyone. */
export function cbbIsPublic(now = Date.now()) {
  return (now instanceof Date ? now.getTime() : now) >= Date.parse(CBB_LAUNCH_AT);
}
