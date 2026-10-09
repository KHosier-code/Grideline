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
  '/': ['Probable | Free NFL Touchdown Picks and Game Projections', 'Free weekly anytime touchdown picks and a projected score for every NFL game, adjusted for the starting quarterback, next to the Vegas line.'],
  '/touchdowns': ['Anytime Touchdown Picks This Week | Probable', 'Ranked anytime touchdown scorer picks for every NFL game, with each player\'s red-zone role, target and carry share, Vegas team total and defensive matchup.'],
  '/pickem': ['NFL Pool Picks This Week: Winners, Spreads and Totals | Probable', 'Every NFL game ranked for pick\'em, confidence, survivor, against-the-spread and over/under pools, with 100-game simulations of each matchup.'],
  '/parlays': ['NFL Parlay Builder: Real Hit Chances | Probable', 'Build an NFL parlay from game winners and anytime touchdown scorers and see how often it really hits, its fair payout and what your sportsbook charges.'],
  '/power-ratings': ['NFL Power Ratings: All 32 Teams Ranked | Probable', 'Every NFL team ranked 1-32 by points better or worse than an average team, with offense, defense and quarterback ratings.'],
  '/qb-rankings': ['NFL QB Rankings by EPA per Dropback | Probable', 'Every team\'s expected starting quarterback ranked by value per dropback, and what each is worth to the team in points.'],
  '/games': ['NFL Games, Projections and Lines | Probable', 'Browse every NFL game by week with our projected score, the sportsbook line and final results.'],
  '/teams': ['NFL Team Rankings by EPA | Probable', 'Offense and defense for all 32 NFL teams from play-by-play data, updated after every game.'],
  '/usage': ['NFL Player Usage: Target, Carry and Red-Zone Share | Probable', 'Target share, carry share, air yards and red-zone looks for every NFL team and skill player, with week-by-week trends.'],
  '/red-zone': ['NFL Red Zone Stats: TD Rate and Red-Zone Looks | Probable', 'Red-zone trips and touchdown rate for every NFL offense and defense, plus the players who get the most looks inside the 20.'],
  '/defense-vs-position': ['NFL Defense vs Position | Probable', 'Fantasy points and touchdowns each NFL defense allows to quarterbacks, running backs, receivers and tight ends.'],
  '/methodology': ['How Probable Makes Its Picks | Probable', 'What goes into Probable\'s game projections and touchdown picks, how they are tested, and how picks are graded.'],
  '/performance': ['NFL Model Performance | Probable', 'How Probable\'s game and touchdown models performed on seasons they never trained on, and this season\'s graded record.'],
};

function tags({ title, description, path, index }) {
  const canonical = url(path);
  // TD Picks and Home preview with this week's picks card. The version changes
  // every Tuesday so X and iMessage don't keep showing last week's card.
  const nflWeek = Math.floor((Date.now() - Date.UTC(2020, 0, 7, 12)) / (7 * 86_400_000));
  const image = path === '/touchdowns' || path === '/'
    ? `${origin}/api/share/td-card.png?v=${nflWeek}`
    : url('/probable-share.png');
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
    return { status: 404, tags: tags({ title: 'Page not found | Probable', description: 'This page is unavailable.', path: '/', index: false }) };
  }
  const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
  if (pages[normalized]) {
    const [title, description] = pages[normalized];
    return { status: 200, tags: tags({ title, description, path: normalized, index: true }) };
  }
  if (normalized === '/share') {
    return { status: 200, tags: tags({ title: 'Share This Week | Probable', description: 'This week\'s TD picks card, post and email.', path: '/touchdowns', index: false }) };
  }
  const match = /^\/games\/([^/]+)$/.exec(normalized);
  if (match) {
    const gameId = match[1];
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(gameId)) return { status: 404, tags: tags({ title: 'Game not found | Probable', description: 'This matchup is unavailable.', path: '/', index: false }) };
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
      if (response.status === 404) return { status: 404, tags: tags({ title: 'Game not found | Probable', description: 'This matchup is unavailable.', path: '/', index: false }) };
      if (!response.ok) throw new Error(`Game lookup failed: ${response.status}`);
      const game = await response.json();
      const away = game?.matchup?.away?.name;
      const home = game?.matchup?.home?.name;
      if (game?.gameId !== gameId || typeof away !== 'string' || typeof home !== 'string') throw new Error('Incomplete game identity');
      const title = `${away} at ${home} | Probable`;
      const description = `View the ${away} at ${home} matchup, schedule and available saved model evidence. Predictions and market comparisons appear only when eligible data exists.`;
      return { status: 200, tags: tags({ title, description, path: normalized, index: true }) };
    } catch {
      // A provider outage must not advertise an unverified game as a real result.
      return { status: 503, tags: tags({ title: 'Game detail unavailable | Probable', description: 'Game identity could not be verified right now.', path: '/', index: false }) };
    }
  }
  return { status: 200, tags: tags({ title: 'Probable | Private or unavailable page', description: 'This page is not included in public search results.', path: '/', index: false }) };
}

export function injectMetadata(html, metadata) {
  return html.replace('<!-- GRIDLINE_META -->', metadata.tags);
}