import { type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { BOWLS_PUBLIC_LAUNCH, useBowlsAccess } from '@/lib/sports';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';

const launchDay = new Date(BOWLS_PUBLIC_LAUNCH).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });

/**
 * The bowl pool page opens to everyone on matchup day (lib/launch/sports-launch.mjs).
 * Before then only administrators see it; everyone else goes to the home page.
 */
export function BowlsGate({ children }: { children: ReactNode }) {
  const access = useBowlsAccess();
  if (access.visible) return <>
    {!access.launched && <p className="pools-preview">Preview: only administrators can see this page until it opens on {launchDay}.</p>}
    {children}
  </>;
  if (access.pending) return <ConsumerLoading label="Checking access…" />;
  return <Redirect to="/" replace />;
}
