/**
 * The two sports on the site. Each has its own section, menu, record, wording
 * and accent color; NFL and college records never mix.
 */
import { CBB_LAUNCH_AT, CBB_PUBLIC_PATHS, cbbIsPublic } from '../../../../lib/sports-launch.mjs';

export { CBB_LAUNCH_AT, CBB_PUBLIC_PATHS, cbbIsPublic };

export type Sport = 'nfl' | 'cbb';

export const isCbbPath = (location: string) => location === '/cbb' || location.startsWith('/cbb/');

export const sportForPath = (location: string): Sport => isCbbPath(location) ? 'cbb' : 'nfl';

/** Who can see college basketball: everyone after launch, administrators before. */
export const cbbVisible = (adminVerified: boolean, now = Date.now()) => adminVerified || cbbIsPublic(now);

/** "December 1" for the launch notice. */
export const cbbLaunchLabel = () => new Date(CBB_LAUNCH_AT).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });

export const SPORTS: Record<Sport, {
  name: string; short: string; home: string; record: string; methodology: string;
  footer: { about: string; caution: string };
}> = {
  nfl: {
    name: 'NFL', short: 'NFL', home: '/', record: '/performance', methodology: '/methodology',
    footer: {
      about: 'Anytime TD picks priced against the books, game projections and power ratings, built from play-by-play data and updated through the week.',
      caution: 'Every number is a model estimate. Lines move, so check your sportsbook before betting.',
    },
  },
  cbb: {
    name: 'College Basketball', short: 'College', home: '/cbb', record: '/cbb/record', methodology: '/cbb/how-it-works',
    footer: {
      about: 'Our line for every Division I men\'s game next to the sportsbook\'s, opponent-adjusted power ratings for every team, and a spread record tracked in public. Updated four times a day.',
      caution: 'Every line is a model estimate, and our college edge is thin. Lines move fast, so check your sportsbook before betting.',
    },
  },
};
