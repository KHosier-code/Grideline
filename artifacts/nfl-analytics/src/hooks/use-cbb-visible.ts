import { useAuth } from '@clerk/react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { cbbVisible } from '@/lib/sports';

/** Whether this visitor sees college basketball: everyone after launch, administrators before. */
export function useCbbVisible() {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  return cbbVisible(consumerAccountState(isLoaded, isSignedIn, admin).adminVerified);
}
