import { type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { CBB_PUBLIC_LAUNCH, useCbbAccess } from '@/lib/sports';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';

/**
 * College basketball is open to everyone from its launch date
 * (lib/launch/sports-launch.mjs). Before then only administrators see it;
 * everyone else is sent to the home page and nothing is fetched for them.
 */
const launchDay = new Date(CBB_PUBLIC_LAUNCH).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });

export function CbbGate({ children }: { children: ReactNode }) {
  const access = useCbbAccess();
  const note = access.newNote && <p className="cbb-new"><b>New</b> We started tracking college basketball picks on November 2.</p>;
  if (access.visible) return <>
    {!access.launched && <p className="cbb-preview">Preview: only administrators can see College Basketball until it opens to everyone on {launchDay}.</p>}
    {note}
    {children}
  </>;
  if (access.pending) return <ConsumerLoading label="Checking access…" />;
  return <Redirect to="/" replace />;
}
