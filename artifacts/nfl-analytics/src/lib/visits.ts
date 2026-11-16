/**
 * First-party visit counting (api-server lib/visit-counts.ts). The browser
 * remembers only the last day it visited, in local storage, and sends
 * yes/no flags: first page today, and back within a week. No cookies, no ids.
 */

const LAST_VISIT_KEY = 'probable-last-visit';
/** Set on a browser that opened the admin area, so the owner's own browsing isn't counted. */
const OWNER_KEY = 'probable-owner';

const easternDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Days between two "YYYY-MM-DD" dates. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Whether this is the first page today, and whether the browser was here in the week before. */
export function visitFlags(lastVisit: string | null, now = new Date()) {
  const today = easternDay(now);
  const first = lastVisit !== today;
  const returning = first && lastVisit !== null && /^\d{4}-\d{2}-\d{2}$/.test(lastVisit)
    && daysBetween(lastVisit, today) >= 1 && daysBetween(lastVisit, today) <= 7;
  return { today, first, returning };
}

/** Where a new visit came from, in broad buckets. Links within the site don't count as a source. */
export function visitSource(referrer: string, ownHost: string) {
  let host = '';
  try { host = referrer ? new URL(referrer).hostname.replace(/^www\./, '') : ''; } catch { return 'other'; }
  if (!host) return 'direct';
  if (host === ownHost.replace(/^www\./, '')) return 'direct';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing';
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'duckduckgo';
  if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host)) return 'x';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) return 'facebook';
  if (/(^|\.)(reddit\.com|redd\.it)$/.test(host)) return 'reddit';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/(mail\.|outlook\.|buttondown)/.test(host)) return 'email';
  return 'other';
}

/** Paths that are never counted. */
export const uncountedPath = (path: string) => /^\/(admin|sign-in|sign-up)(\/|$)/.test(path);

function send(body: Record<string, unknown>) {
  try {
    const payload = JSON.stringify(body);
    if (navigator.sendBeacon?.('/api/visit', new Blob([payload], { type: 'application/json' }))) return;
    void fetch('/api/visit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Counting must never affect the page.
  }
}

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/** Counts one page view. */
export function countPageView(path: string) {
  if (typeof window === 'undefined') return;
  const store = storage();
  if (path.startsWith('/admin')) { try { store?.setItem(OWNER_KEY, '1'); } catch { /* ignore */ } }
  if (uncountedPath(path)) return;
  try { if (store?.getItem(OWNER_KEY)) return; } catch { /* ignore */ }
  let last: string | null = null;
  try { last = store?.getItem(LAST_VISIT_KEY) ?? null; } catch { /* ignore */ }
  const { today, first, returning } = visitFlags(last);
  if (first) { try { store?.setItem(LAST_VISIT_KEY, today); } catch { /* ignore */ } }
  send({ page: path, first, returning, ...(first ? { source: visitSource(document.referrer, window.location.hostname) } : {}) });
}

/** Counts a product event, e.g. a bowl sheet being built ("confidence-25-mixed"). */
export function countEvent(event: 'bowl_sheet_built' | 'bowl_sheet_copied' | 'newsletter_signup', detail?: string) {
  if (typeof window === 'undefined') return;
  try { if (storage()?.getItem(OWNER_KEY)) return; } catch { /* ignore */ }
  send({ page: window.location.pathname, event, ...(detail ? { detail } : {}) });
}
