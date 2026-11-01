import { type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '@clerk/react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { cbbIsPublic, cbbLaunchLabel } from '@/lib/sports';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';

/**
 * College basketball is an administrator preview until CBB_LAUNCH_AT
 * (lib/sports-launch.mjs). Before then everyone else is sent to the home page
 * and nothing about it is shown or fetched for them; from then on this gate
 * renders the page for everyone. The API route switches on the same date.
 */
export function CbbGate({ children }: { children: ReactNode }) {
  if (cbbIsPublic()) return <>{children}</>;
  return <CbbPreviewGate>{children}</CbbPreviewGate>;
}

function CbbPreviewGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  if (account.adminVerified) return <>
    <p className="cbb-preview">Preview: College Basketball opens to everyone on {cbbLaunchLabel()}. Until then only administrators see it.</p>
    {children}
  </>;
  if (!isLoaded || (isSignedIn && (admin.isLoading || admin.isFetching))) return <ConsumerLoading label="Checking access…" />;
  return <Redirect to="/" replace />;
}
