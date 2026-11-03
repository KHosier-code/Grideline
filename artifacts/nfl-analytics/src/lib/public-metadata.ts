import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { isCbbPublic } from '@/lib/sports';

// Keep in sync with metadata.mjs (server-rendered tags for the same pages).
const pages: Record<string, [string, string]> = {
  '/': ['Probable | Free NFL Touchdown Picks and Game Projections', 'Free weekly anytime touchdown picks and a projected score for every NFL game, adjusted for the starting quarterback, next to the Vegas line.'],
  '/nfl': ['NFL Picks This Week: Touchdowns, Game Lines and Pool Picks | Probable', 'This week\'s anytime touchdown picks, our projected score and line for every NFL game, early-line spread picks and the safest pool picks.'],
  '/touchdowns': ['Anytime Touchdown Picks This Week | Probable', 'Ranked anytime touchdown scorer picks for every NFL game, with each player\'s red-zone role, target and carry share, Vegas team total and defensive matchup.'],
  '/pickem': ['NFL Pool Picks This Week: Winners, Spreads and Totals | Probable', 'Every NFL game ranked for pick\'em, confidence, survivor, against-the-spread and over/under pools, with 100-game simulations of each matchup.'],
  '/power-ratings': ['NFL Power Ratings: All 32 Teams Ranked | Probable', 'Every NFL team ranked 1-32 by points better or worse than an average team, with offense, defense and quarterback ratings.'],
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

// College basketball pages, listed only once college basketball is public.
const cbbPages: Record<string, [string, string]> = {
  '/cbb': ['College Basketball Picks Today: Every D-I Game vs the Line | Probable', 'Our projected line for every Division I game today and tomorrow next to the sportsbook spread, with a pick wherever we disagree by 2+ points.'],
  '/cbb/ratings': ['College Basketball Power Ratings: Every D-I Team | Probable', 'Every Division I team ranked by points per 100 possessions better than average, with offense, defense, tempo, Four Factors and strength of schedule.'],
  '/cbb/record': ['College Basketball Picks Record | Probable', 'Every college basketball spread pick, saved before tip-off and graded at the line posted, tracked in public since November 2.'],
  '/cbb/how-it-works': ['How Our College Basketball Model Works | Probable', 'How Probable rates every Division I team, projects each game and decides when to make a college basketball spread pick.'],
};
// The home page covers both sports once college basketball is public.
const bothSportsHome: [string, string] = ['Probable | NFL and College Basketball Picks Priced Against the Books', 'Today\'s best NFL and college basketball picks next to the sportsbook line, each sport with its own model and its own public record.'];

const publicPages = () => isCbbPublic() ? { ...pages, '/': bothSportsHome, ...cbbPages } : pages;

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
    const page = publicPages()[path];
    // Player pages set their own title and description once their data loads.
    if (path.startsWith('/td/')) return;
    if (page) setPublicMetadata(path, page[0], page[1]);
    else if (path === '/share') setPublicMetadata(path, 'Share This Week | Probable', 'This week\'s TD picks card, post and email.', false);
    else setPublicMetadata(path, 'Probable | Private or unavailable page', 'This page is not included in public search results.', false);
  }, [location]);
}