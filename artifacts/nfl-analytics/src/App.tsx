import { lazy, Suspense, type ReactNode } from 'react';
import { SignIn, SignUp, useAuth } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { useRouteMetadata } from '@/lib/public-metadata';
import { ConsumerLoadingFallback, ConsumerShell } from '@/components/ConsumerShell';
import './index.css';

const PickSheet = lazy(() => import('@/pages/consumer/PickSheet'));
const TouchdownPicks = lazy(() => import('@/pages/consumer/TouchdownPicks'));
const PowerRatings = lazy(() => import('@/pages/consumer/PowerRatings'));
const QbRankings = lazy(() => import('@/pages/consumer/QbRankings'));
const ConsumerGames = lazy(() => import('@/pages/consumer/ConsumerGames'));
const ConsumerGameDetail = lazy(() => import('@/pages/consumer/ConsumerGameDetail'));
const ConsumerSavedGames = lazy(() => import('@/pages/consumer/ConsumerSavedGames'));
const ConsumerPerformance = lazy(() => import('@/pages/consumer/ConsumerPerformance'));
const ConsumerMethodology = lazy(() => import('@/pages/consumer/ConsumerMethodology'));
const ConsumerTrends = lazy(() => import('@/pages/consumer/ConsumerTrends'));
const ConsumerUsage = lazy(() => import('@/pages/consumer/PlayerUsage'));
const ConsumerRedZone = lazy(() => import('@/pages/consumer/RedZone'));
const DefenseVsPositionLeague = lazy(() => import('@/pages/consumer/DefenseVsPositionPage'));
const ConsumerTeams = lazy(() => import('@/pages/consumer/ConsumerTeams'));
const SharePicks = lazy(() => import('@/pages/consumer/SharePicks'));
const Pickem = lazy(() => import('@/pages/consumer/Pickem'));
const AdminRoutes = lazy(() => import('@/pages/admin/AdminApp'));

const queryClient = new QueryClient();

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location} FallbackComponent={() => (
    <div className="consumer-state" role="alert">
      <h2>This page could not be loaded</h2>
      <p>Check your connection and try again.</p>
      <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Reload page</button>
    </div>
  )}><Suspense fallback={<div className="consumer-state" role="status"><Loader2 className="h-6 w-6 animate-spin" /><p>Loading page…</p></div>}>{children}</Suspense></ErrorBoundary>;
}

const authBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background lg:flex-row">
      <section className="relative isolate flex min-h-[340px] flex-col overflow-hidden bg-[#17213b] text-[#f0f3fc] sm:min-h-[390px] lg:min-h-[100dvh] lg:w-[52%]" aria-label="About Gridline">
        <img
          src={`${import.meta.env.BASE_URL}gridline-auth-field.svg`}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-[50%_44%] opacity-90 lg:object-center"
        />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#11192e]/65 via-[#11192e]/10 to-[#11192e]/95 lg:from-[#11192e]/45 lg:via-transparent lg:to-[#11192e]/95" />
        <header className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-10 sm:pt-9 lg:px-12 lg:pt-12">
          <Link href="/" aria-label="Gridline home" data-testid="link-auth-brand-home" className="inline-flex shrink-0 rounded-lg focus-visible:outline-offset-4">
            <span className="brand-wordmark-frame brand-wordmark-auth !w-[145px] !min-h-0 sm:!w-[192px]"><img src={`${import.meta.env.BASE_URL}logo-wordmark.png`} alt="Gridline NFL Analytics" /></span>
          </Link>
          <Link href="/" data-testid="link-auth-return-home" className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap border-b border-[#aec5f7]/50 text-[11px] font-bold tracking-[.03em] text-[#e7edfb] transition-colors hover:border-[#e7edfb] hover:text-white sm:text-xs">
            Return home <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </header>
        <div className="mt-auto max-w-[660px] px-6 pb-7 pt-20 sm:px-10 sm:pb-10 lg:px-12 lg:pb-14">
          <div className="mb-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[.22em] text-[#b5c9f4] sm:mb-5">
            <span className="h-px w-9 bg-[#e7ca94]" aria-hidden="true" /> Football, examined
          </div>
          <h1 className="max-w-[560px] font-serif text-[31px] font-semibold leading-[1.08] tracking-[-.055em] text-[#f4f6fc] sm:text-[42px] lg:text-[clamp(42px,4.3vw,70px)]">
            Read the field.<br /><span className="text-[#b9caf1]">Question the call.</span>
          </h1>
          <p className="mt-4 max-w-[450px] text-[13px] leading-[1.65] text-[#d2dbef] sm:text-[15px] lg:mt-6">
            Football analysis with the evidence in view. Picks appear only when eligible evidence is available; sometimes there may be no pick.
          </p>
        </div>
      </section>
      <main className="flex min-h-[500px] flex-1 flex-col justify-center border-t border-border bg-background px-5 py-10 sm:px-10 lg:w-[48%] lg:border-l lg:border-t-0 lg:px-12 lg:py-16">
        <div className="mx-auto w-full max-w-[440px]">
          <div className="mb-7 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[.19em] text-muted-foreground sm:mb-9">
            <span className="h-px w-7 bg-accent" aria-hidden="true" /> Your Gridline account
          </div>
          {children}
          <p className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
            Evidence informs a pick. It never guarantees an outcome.
          </p>
        </div>
      </main>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthPageShell>
      <SignIn
        routing="path"
        path={`${authBasePath}/sign-in`}
        signUpUrl={`${authBasePath}/sign-up`}
      />
    </AuthPageShell>
  );
}

function SignUpPage() {
  return (
    <AuthPageShell>
      <SignUp
        routing="path"
        path={`${authBasePath}/sign-up`}
        signInUrl={`${authBasePath}/sign-in`}
      />
    </AuthPageShell>
  );
}

function Router() {
  useRouteMetadata();
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  // Public pages can render while Clerk initializes. Admin and account routes
  // still wait for a definitive identity before making an access decision.
  const publicRoute = location === '/' || location === '/games' || location.startsWith('/games/')
    || location === '/performance' || location === '/methodology'
    || location === '/defense-vs-position' || location === '/teams' || location === '/usage'
    || location === '/saved-games' || location === '/touchdowns' || location === '/props'
    || location === '/power-ratings' || location === '/qb-rankings'
    || location === '/weekly-picks'
    || location === '/red-zone' || location === '/share' || location === '/pickem';
  if (!isLoaded && !publicRoute) return <ConsumerLoadingFallback />;
  if (!isSignedIn) return <RoutedErrorBoundary><Switch>
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/games/:gameId"><ConsumerShell><ConsumerGameDetail /></ConsumerShell></Route>
    <Route path="/games"><ConsumerShell><ConsumerGames /></ConsumerShell></Route>
    <Route path="/saved-games"><ConsumerShell><ConsumerSavedGames /></ConsumerShell></Route>
    <Route path="/methodology"><ConsumerShell><ConsumerMethodology /></ConsumerShell></Route>
    <Route path="/weekly-picks"><Redirect to="/performance" replace /></Route>
    <Route path="/performance"><ConsumerShell><ConsumerPerformance /></ConsumerShell></Route>
    <Route path="/defense-vs-position"><ConsumerShell><DefenseVsPositionLeague /></ConsumerShell></Route>
    <Route path="/teams"><ConsumerShell><ConsumerTeams /></ConsumerShell></Route>
    <Route path="/usage"><ConsumerShell><ConsumerUsage /></ConsumerShell></Route>
    <Route path="/red-zone"><ConsumerShell><ConsumerRedZone /></ConsumerShell></Route>
    <Route path="/touchdowns"><ConsumerShell><TouchdownPicks /></ConsumerShell></Route>
    <Route path="/share"><ConsumerShell><SharePicks /></ConsumerShell></Route>
    <Route path="/pickem"><ConsumerShell><Pickem /></ConsumerShell></Route>
    <Route path="/power-ratings"><ConsumerShell><PowerRatings /></ConsumerShell></Route>
    <Route path="/qb-rankings"><ConsumerShell><QbRankings /></ConsumerShell></Route>
    <Route path="/props"><ConsumerShell><TouchdownPicks /></ConsumerShell></Route>
    <Route path="/"><ConsumerShell><PickSheet /></ConsumerShell></Route>
    <Route component={SignInPage} />
  </Switch></RoutedErrorBoundary>;
  return <RoutedErrorBoundary><Switch>
      <Route path="/admin" component={AdminRoutes} />
      <Route path="/admin/*" component={AdminRoutes} />
      <Route path="/games/:gameId"><ConsumerShell><ConsumerGameDetail /></ConsumerShell></Route>
      <Route path="/games"><ConsumerShell><ConsumerGames /></ConsumerShell></Route>
      <Route path="/saved-games"><ConsumerShell><ConsumerSavedGames /></ConsumerShell></Route>
      <Route path="/methodology"><ConsumerShell><ConsumerMethodology /></ConsumerShell></Route>
      <Route path="/weekly-picks"><Redirect to="/performance" replace /></Route>
      <Route path="/defense-vs-position"><ConsumerShell><DefenseVsPositionLeague /></ConsumerShell></Route>
      <Route path="/teams"><ConsumerShell><ConsumerTeams /></ConsumerShell></Route>
      <Route path="/usage"><ConsumerShell><ConsumerUsage /></ConsumerShell></Route>
      <Route path="/red-zone"><ConsumerShell><ConsumerRedZone /></ConsumerShell></Route>
      <Route path="/performance"><ConsumerShell><ConsumerPerformance /></ConsumerShell></Route>
      <Route path="/trends"><ConsumerShell><ConsumerTrends /></ConsumerShell></Route>
      <Route path="/touchdowns"><ConsumerShell><TouchdownPicks /></ConsumerShell></Route>
    <Route path="/share"><ConsumerShell><SharePicks /></ConsumerShell></Route>
    <Route path="/pickem"><ConsumerShell><Pickem /></ConsumerShell></Route>
      <Route path="/power-ratings"><ConsumerShell><PowerRatings /></ConsumerShell></Route>
      <Route path="/qb-rankings"><ConsumerShell><QbRankings /></ConsumerShell></Route>
      <Route path="/props"><ConsumerShell><TouchdownPicks /></ConsumerShell></Route>
      {/* The production-build performance fixture mounts this same weekly Home
          component without Clerk; only this branch grants signed-in routing. */}
      <Route path="/"><ConsumerShell><PickSheet /></ConsumerShell></Route>
      <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
