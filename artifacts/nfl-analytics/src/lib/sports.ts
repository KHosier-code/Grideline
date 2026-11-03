import { useAuth } from '@clerk/react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { isCbbPublic, showCbbNewNote } from '../../../../lib/launch/sports-launch.mjs';

export { CBB_PUBLIC_LAUNCH, isCbbPublic, showCbbNewNote } from '../../../../lib/launch/sports-launch.mjs';

export type Sport = 'home' | 'nfl' | 'cbb';

export const isCbbPath = (location: string) => location === '/cbb' || location.startsWith('/cbb/');

/** Which tab a page sits under. The home page belongs to both sports. */
export const sportForPath = (location: string): Sport => location === '/' ? 'home' : isCbbPath(location) ? 'cbb' : 'nfl';

/**
 * Whether this visitor gets college basketball: everyone after launch, only
 * verified administrators before. `pending` while that can't be decided yet.
 */
export function cbbAccess(adminVerified: boolean, now = Date.now()) {
  return { visible: isCbbPublic(now) || adminVerified, launched: isCbbPublic(now), newNote: showCbbNewNote(now) };
}

export function useCbbAccess() {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  const access = cbbAccess(account.adminVerified);
  const pending = !access.visible && (!isLoaded || Boolean(isSignedIn && (admin.isLoading || admin.isFetching)));
  return { ...access, adminVerified: account.adminVerified, pending };
}
