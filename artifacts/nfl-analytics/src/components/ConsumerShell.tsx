import { type ReactNode } from 'react';
import { UserButton, useAuth, useClerk } from '@clerk/react';
import { Loader2, Moon, Sun } from 'lucide-react';
import { ConsumerShellView } from '@/components/ConsumerShellView';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { consumerAccountState } from '@/lib/consumer-account-state';
import { useTheme } from '@/lib/theme';

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return <button type="button" className={cx('theme-toggle', className)} onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'} data-testid="button-theme-toggle">
    {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}

export function ConsumerShell({ children }: { children: ReactNode }) {
  const admin = useAdminStatus();
  const { isLoaded, isSignedIn } = useAuth();
  const { openUserProfile } = useClerk();
  const account = consumerAccountState(isLoaded, isSignedIn, admin);
  return <ConsumerShellView account={account} accountControl={<UserButton appearance={{ elements: { avatarBox: 'grayscale saturate-0' } }} />} onManageAccount={openUserProfile} themeToggle={<ThemeToggle />}>{children}</ConsumerShellView>;
}

export function ConsumerLoadingFallback() {
  return <div className="consumer-state"><Loader2 className="h-6 w-6 animate-spin" /><p>Checking access…</p></div>;
}
