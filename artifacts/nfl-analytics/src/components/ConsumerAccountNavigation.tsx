import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ShieldCheck } from 'lucide-react';
import type { consumerAccountState } from '@/lib/consumer-account-state';

type AccountState = ReturnType<typeof consumerAccountState>;

export function ConsumerWorkspaceLink({ verified, onNavigate }: { verified: boolean; onNavigate?: () => void }) {
  if (!verified) return null;
  return <Link href="/admin" onClick={onNavigate}><ShieldCheck aria-hidden="true" />Admin workspace</Link>;
}

export function ConsumerAccountAction({
  state, mobile, accountControl, onNavigate, onManageAccount,
}: {
  state: AccountState;
  mobile: boolean;
  accountControl?: ReactNode;
  onNavigate?: () => void;
  onManageAccount?: () => void;
}) {
  if (state.signedIn) {
    return mobile
      ? <button type="button" onClick={onManageAccount}>Manage account</button>
      : <>{accountControl}</>;
  }
  if (state.signedOut) {
    return <Link href="/sign-in" className={mobile ? undefined : 'button button-subtle'} onClick={onNavigate}>Sign in</Link>;
  }
  return null;
}