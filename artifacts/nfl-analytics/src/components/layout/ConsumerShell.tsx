import { type ReactNode, useState } from 'react';
import { useAuth, UserButton } from '@clerk/react';
import { useLocation, Link } from 'wouter';
import { Target, X, LayoutDashboard, CalendarDays, LineChart, BarChart3, Menu, Bell, ShieldCheck } from 'lucide-react';
import { useAdminStatus } from '@/hooks/use-admin-status';

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

const consumerNav = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/games', label: 'Games', icon: CalendarDays },
  { href: '/performance', label: 'Performance', icon: BarChart3 },
  { href: '/trends', label: 'Trends', icon: LineChart },
  { href: '/props', label: 'Props', icon: Target },
];

export function ConsumerShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isSignedIn } = useAuth();
  const { data: isAdmin } = useAdminStatus();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card/80 backdrop-blur-md">
        <div className="flex h-16 items-center px-4 md:px-8 max-w-[1440px] mx-auto w-full">
          <div className="flex items-center gap-2 md:gap-8">
            <button className="md:hidden p-2 -ml-2 text-muted-foreground" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/" className="flex items-center gap-2 text-foreground font-display font-bold text-xl tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Target className="h-4 w-4" />
              </span>
              Gridline
            </Link>
            
            <nav className="hidden md:flex items-center gap-1">
              {consumerNav.map((item) => {
                const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cx(
                    'px-4 py-2 rounded-full text-sm font-semibold transition-colors',
                    active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                  )}>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          
          <div className="ml-auto flex items-center gap-4">
            {isAdmin && (
              <Link href="/admin" className="hidden md:flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin
              </Link>
            )}
            
            {isSignedIn ? (
              <UserButton />
            ) : (
              <Link href="/sign-in" className="text-sm font-bold bg-primary text-primary-foreground px-4 py-2 rounded-full hover:bg-primary/90 transition-colors">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      
      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative w-64 max-w-full bg-card h-full p-6 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <Link href="/" className="flex items-center gap-2 text-foreground font-display font-bold text-xl" onClick={() => setMobileOpen(false)}>
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Target className="h-4 w-4" />
                </span>
                Gridline
              </Link>
              <button onClick={() => setMobileOpen(false)} className="text-muted-foreground p-1"><X className="h-5 w-5" /></button>
            </div>
            <nav className="flex flex-col gap-2">
              {consumerNav.map((item) => {
                const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cx(
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-colors',
                    active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
                  )}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {isAdmin && (
                <div className="mt-4 pt-4 border-t border-border">
                  <Link href="/admin" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-accent hover:bg-accent/10 transition-colors">
                    <ShieldCheck className="h-4 w-4" />
                    Admin Area
                  </Link>
                </div>
              )}
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1 w-full max-w-[1440px] mx-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
