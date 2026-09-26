// Public document metadata, shared by Vite development and the production web server.
const configuredOrigin = process.env.PUBLIC_SITE_URL || 'https://gridelineanalytics.com';
const origin = new URL(configuredOrigin).origin;
const defaultApiOrigin = process.env.INTERNAL_API_ORIGIN || 'http://127.0.0.1:80';
const base = `/${(process.env.BASE_PATH || '/').split('/').filter(Boolean).join('/')}`;
const prefix = base === '/' ? '' : base;
const escape = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const url = path => `${origin}${prefix}${path}`;

const pages = {
  '/': ['Gridline | NFL Games and Model Evidence', 'Explore saved NFL matchups, available model evidence and source status. Missing projections are marked unavailable; predictions are not guaranteed results.'],
  '/games': ['NFL Games and Saved Matchups | Gridline', 'Browse NFL matchups and their saved projections, market evidence and official results where available. Data and comparisons may be incomplete.'],
  '/methodology': ['Methodology and Limitations | Gridline', 'Learn how Gridline sources NFL data, labels saved and official predictions, separates player simulations from forecasts, and grades verified results.'],
  '/performance': ['Verified Prediction Performance | Gridline', 'Review available graded official NFL predictions, eligible sample counts and model error measures. These are not betting-return claims.'],
};

function tags({ title, description, path, index }) {
  const canonical = url(path);
  const image = url('/gridline-share.png');
  return [
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}" />`,
    `<meta name="robots" content="${index ? 'index, follow' : 'noindex, nofollow'}" />`,
    index ? `<link rel="canonical" href="${escape(canonical)}" />` : '',
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:type" content="website" />`,
    index ? `<meta property="og:url" content="${escape(canonical)}" />` : '',
    `<meta property="og:image" content="${escape(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(title)}" />`,
    `<meta name="twitter:description" content="${escape(description)}" />`,
    `<meta name="twitter:image" content="${escape(image)}" />`,
  ].filter(Boolean).join('\n    ');
}

export async function documentForPath(pathname, { apiOrigin = defaultApiOrigin } = {}) {
  const path = pathname.slice(prefix.length) || '/';
  if (pathname !== `${prefix}${path}` || (!pathname.startsWith(`${prefix}/`) && pathname !== prefix)) {
    return { status: 404, tags: tags({ title: 'Page not found | Gridline', description: 'This page is unavailable.', path: '/', index: false }) };
  }
  const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
  if (pages[normalized]) {
    const [title, description] = pages[normalized];
    return { status: 200, tags: tags({ title, description, path: normalized, index: true }) };
  }
  const match = /^\/games\/([^/]+)$/.exec(normalized);
  if (match) {
    const gameId = match[1];
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(gameId)) return { status: 404, tags: tags({ title: 'Game not found | Gridline', description: 'This matchup is unavailable.', path: '/', index: false }) };
    try {
      const endpoint = `/api/consumer/games/${encodeURIComponent(gameId)}`;
      let response;
      try {
        response = await fetch(new URL(endpoint, apiOrigin), { signal: AbortSignal.timeout(6000) });
      } catch (error) {
        if (apiOrigin === origin || apiOrigin !== defaultApiOrigin) throw error;
        // Deployment layouts need not expose the workspace's local proxy.
        response = await fetch(new URL(endpoint, origin), { signal: AbortSignal.timeout(6000) });
      }
      if (response.status === 404) return { status: 404, tags: tags({ title: 'Game not found | Gridline', description: 'This matchup is unavailable.', path: '/', index: false }) };
      if (!response.ok) throw new Error(`Game lookup failed: ${response.status}`);
      const game = await response.json();
      const away = game?.matchup?.away?.name;
      const home = game?.matchup?.home?.name;
      if (game?.gameId !== gameId || typeof away !== 'string' || typeof home !== 'string') throw new Error('Incomplete game identity');
      const title = `${away} at ${home} | Gridline Game Detail`;
      const description = `View the ${away} at ${home} matchup, schedule and available saved model evidence. Predictions and market comparisons appear only when eligible data exists.`;
      return { status: 200, tags: tags({ title, description, path: normalized, index: true }) };
    } catch {
      // A provider outage must not advertise an unverified game as a real result.
      return { status: 503, tags: tags({ title: 'Game detail unavailable | Gridline', description: 'Game identity could not be verified right now.', path: '/', index: false }) };
    }
  }
  return { status: 200, tags: tags({ title: 'Gridline | Private or unavailable page', description: 'This page is not included in public search results.', path: '/', index: false }) };
}

export function injectMetadata(html, metadata) {
  return html.replace('<!-- GRIDLINE_META -->', metadata.tags);
}