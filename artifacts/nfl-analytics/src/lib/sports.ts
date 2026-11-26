import { useAuth } from '@clerk/react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { isBowlsPublic, isCbbPicksPublic, isCbbPublic, showCbbNewNote } from '../../../../lib/launch/sports-launch.mjs';

export { BOWLS_PUBLIC_LAUNCH, CBB_PUBLIC_LAUNCH, isBowlsPublic, isCbbPicksPublic, isCbbPublic, showCbbNewNote } from '../../../../lib/launch/sports-launch.mjs';

export type Sport = 'home' | 'nfl' | 'cbb';

export const isCbbPath = (location: string) => location === '/cbb' || location.startsWith('/cbb/');

/** Which tab a page sits under. The home page belongs to both sports. */
export const sportForPath = (location: string): Sport => location === '/' ? 'home' : isCbbPath(location) ? 'cbb' : 'nfl';

/**
 * Whether this visitor gets college basketball: everyone after launch, only
 * verified administrators before. `pending` while that can't be decided yet.
 */
export function cbbAccess(adminVerified: boolean, now = Date.now()) {
  return {
    visible: isCbbPublic(now) || adminVerified, launched: isCbbPublic(now), newNote: showCbbNewNote(now),
    /** The daily card, leans and record: administrators only unless CBB_PICKS_PUBLIC. */
    picks: isCbbPicksPublic(now) || adminVerified,
  };
}

/** Where the College tab and links land: today's games with picks, else the power ratings. */
export const cbbHomePath = (picks: boolean) => picks ? '/cbb' : '/cbb/ratings';

export function useCbbAccess() {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  const access = cbbAccess(account.adminVerified);
  const deciding = !isLoaded || Boolean(isSignedIn && (admin.isLoading || admin.isFetching));
  const pending = !access.visible && deciding;
  /** True while an admin's picks access can't be decided yet (so picks pages wait rather than redirect). */
  const picksPending = !access.picks && deciding;
  return { ...access, adminVerified: account.adminVerified, pending, picksPending };
}

/** The bowl pool page: everyone after it opens on matchup day, only verified administrators before. */
export function bowlsAccess(adminVerified: boolean, now = Date.now()) {
  return { visible: isBowlsPublic(now) || adminVerified, launched: isBowlsPublic(now) };
}

export function useBowlsAccess() {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  const access = bowlsAccess(account.adminVerified);
  const pending = !access.visible && (!isLoaded || Boolean(isSignedIn && (admin.isLoading || admin.isFetching)));
  return { ...access, pending };
}
