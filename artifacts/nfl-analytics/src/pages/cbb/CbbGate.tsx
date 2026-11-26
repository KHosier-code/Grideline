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

export function CbbGate({ children, picks = false }: { children: ReactNode; picks?: boolean }) {
  const access = useCbbAccess();
  const note = access.newNote && <p className="cbb-new"><b>New</b> {access.picks
    ? 'We started tracking college basketball picks on November 2.'
    : 'Power ratings for every Division I team, updated four times a day.'}</p>;
  // Pages built around picks (today's card, the record) need picks access; everyone else goes to the ratings.
  if (picks && access.visible && !access.picks) {
    return access.picksPending ? <ConsumerLoading label="Checking access…" /> : <Redirect to="/cbb/ratings" replace />;
  }
  if (access.visible && (!picks || access.picks)) return <>
    {!access.launched && <p className="cbb-preview">Preview: only administrators can see College Basketball until it opens to everyone on {launchDay}.</p>}
    {access.launched && picks && <p className="cbb-preview">Admin only: college picks and their record are hidden from visitors (CBB_PICKS_PUBLIC in lib/launch/sports-launch.mjs).</p>}
    {note}
    {children}
  </>;
  if (access.pending) return <ConsumerLoading label="Checking access…" />;
  return <Redirect to="/" replace />;
}
