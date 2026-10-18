import { type ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '@clerk/react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { ConsumerLoading } from '@/pages/consumer/consumer-ui';

/**
 * College basketball is a preview for administrators only. Everyone else is
 * sent to the NFL home page; nothing about it is shown or fetched for them.
 * To launch it, render the children directly and drop requireAdmin from
 * /api/consumer/cbb.
 */
export function CbbGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const admin = useAdminStatus();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  if (account.adminVerified) return <>
    <p className="cbb-preview">Preview: only administrators can see College Hoops. Customers don&apos;t see it in the menu or at these addresses.</p>
    {children}
  </>;
  if (!isLoaded || (isSignedIn && (admin.isLoading || admin.isFetching))) return <ConsumerLoading label="Checking access…" />;
  return <Redirect to="/" replace />;
}
