import { useEffect } from 'react';
import { useLocation } from 'wouter';

// Keep in sync with metadata.mjs (server-rendered tags for the same pages).
const pages: Record<string, [string, string]> = {
  '/': ['Probable | Free NFL Touchdown Picks and Game Projections', 'Free weekly anytime touchdown picks and a projected score for every NFL game, adjusted for the starting quarterback, next to the Vegas line.'],
  '/touchdowns': ['Anytime Touchdown Picks This Week | Probable', 'Ranked anytime touchdown scorer picks for every NFL game, with each player\'s red-zone role, target and carry share, Vegas team total and defensive matchup.'],
  '/pickem': ['NFL Pool Picks This Week: Winners, Spreads and Totals | Probable', 'Every NFL game ranked for pick\'em, confidence, survivor, against-the-spread and over/under pools, with 100-game simulations of each matchup.'],
  '/power-ratings': ['NFL Power Ratings: All 32 Teams Ranked | Probable', 'Every NFL team ranked 1-32 by points better or worse than an average team, with offense, defense and quarterback ratings.'],
  '/cbb': ['College Basketball Picks and Lines Today | Probable', 'Our line for every Division I college basketball game today and tomorrow next to the opening and current spread, with picks tracked in public.'],
  '/cbb/ratings': ['College Basketball Power Ratings: All D-I Teams Ranked | Probable', 'Every Division I men\'s college basketball team ranked by opponent-adjusted offense, defense and tempo, updated every morning.'],
  '/cbb/how-it-works': ['How Probable\'s College Basketball Model Works | Probable', 'How our college basketball ratings and lines are built, how they were tested against three seasons of sportsbook lines, and how picks are graded.'],
  '/qb-rankings': ['NFL QB Rankings by EPA per Dropback | Probable', 'Every team\'s expected starting quarterback ranked by value per dropback, and what each is worth to the team in points.'],
  '/games': ['NFL Games, Projections and Lines | Probable', 'Browse every NFL game by week with our projected score, the sportsbook line and final results.'],
  '/teams': ['NFL Team Rankings by EPA | Probable', 'Offense and defense for all 32 NFL teams from play-by-play data, updated after every game.'],
  '/usage': ['NFL Player Usage: Target, Carry and Red-Zone Share | Probable', 'Target share, carry share, air yards and red-zone looks for every NFL team and skill player, with week-by-week trends.'],
  '/red-zone': ['NFL Red Zone Stats: TD Rate and Red-Zone Looks | Probable', 'Red-zone trips and touchdown rate for every NFL offense and defense, plus the players who get the most looks inside the 20.'],
  '/matchups': ['NFL Matchups: Pressure, Blitz, Big Plays and Funnels | Probable', 'How every NFL offense and defense plays: pressure and blitz rates, explosive plays, pass and run funnels, play action and missed tackles, ranked 1-32.'],
  '/defense-vs-position': ['NFL Defense vs Position | Probable', 'Fantasy points and touchdowns each NFL defense allows to quarterbacks, running backs, receivers and tight ends.'],
  '/methodology': ['How Probable Makes Its Picks | Probable', 'What goes into Probable\'s game projections and touchdown picks, how they are tested, and how picks are graded.'],
  '/performance': ['NFL Model Performance | Probable', 'How Probable\'s game and touchdown models performed on seasons they never trained on, and this season\'s graded record.'],
};

const setMeta = (selector: string, attribute: string, value: string) => {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    const [key, name] = attribute === 'name' ? ['name', selector.match(/name="([^"]+)"/)?.[1]] : ['property', selector.match(/property="([^"]+)"/)?.[1]];
    if (name) element.setAttribute(key, name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', value);
};

export function setPublicMetadata(path: string, title: string, description: string, index = true) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const canonical = `${window.location.origin}${base}${path}`;
  const image = `${window.location.origin}${base}/probable-share.png`;
  document.title = title;
  setMeta('meta[name="description"]', 'name', description);
  setMeta('meta[name="robots"]', 'name', index ? 'index, follow' : 'noindex, nofollow');
  for (const [name, content] of Object.entries({
    'og:title': title, 'og:description': description, 'og:image': image,
    'twitter:title': title, 'twitter:description': description, 'twitter:image': image,
  })) setMeta(`meta[${name.startsWith('og:') ? 'property' : 'name'}="${name}"]`, name.startsWith('og:') ? 'property' : 'name', content);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!index) link?.remove();
  else {
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
    link.href = canonical;
  }
  if (index) setMeta('meta[property="og:url"]', 'property', canonical);
  else document.head.querySelector('meta[property="og:url"]')?.remove();
}

export function useRouteMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const path = location.split('?')[0].replace(/\/$/, '') || '/';
    const page = pages[path];
    // Player pages set their own title and description once their data loads.
    if (path.startsWith('/td/')) return;
    if (page) setPublicMetadata(path, page[0], page[1]);
    else if (path === '/share') setPublicMetadata(path, 'Share This Week | Probable', 'This week\'s TD picks card, post and email.', false);
    else setPublicMetadata(path, 'Probable | Private or unavailable page', 'This page is not included in public search results.', false);
  }, [location]);
}