import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CircleCheck, Clock3, Coins, ExternalLink, RefreshCw, Radio } from 'lucide-react';

/** Shape of GET /api/admin/ops (artifacts/api-server/src/routes/ops.ts). */
type Ops = {
  generatedAt: string;
  clock: {
    enabled: boolean; running: boolean; dispatchConfigured: boolean; nextKickoff: string | null;
    plan: Array<{ kind: TaskKind; at: string; kickoff: string }>;
    log: Array<{ key: string; kind: TaskKind; at: string; ok: boolean; outcome: string }>;
  };
  odds: { lastCapture: string | null; creditsRemaining: number | null; creditsAsOf: string | null; creditsUsedLast7Days: number };
  feeds: Array<{ feed: string; at: string | null; stale: boolean }>;
  picks: { touchdowns: Run | null; games: Run | null };
  reports: Array<{ kind: string; week: number | null; at: string | null }>;
  github: { runs: Array<{ name: string; status: string; conclusion: string | null; event: string; createdAt: string; url: string }> | null; error: string | null };
};
type Run = { season: number; week: number; at: string };
type TaskKind = 'odds' | 'weather' | 'injuries' | 'picks' | 'scores';

const TASK_LABEL: Record<TaskKind, string> = {
  odds: 'Sportsbook lines', weather: 'Kickoff weather', injuries: 'Injury report', picks: 'Weekly picks re-run', scores: 'Live scores',
};
const REPORT_LABEL: Record<string, string> = {
  usage: 'Player usage', replay: 'Replay', 'share-td': 'Share card', 'share-clip': 'Share clip', 'td-props': 'TD prop prices',
};
/** The Odds API free plan; the gauge reads against it. */
const MONTHLY_CREDITS = 500;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ago(iso: string | null, now: number) {
  if (!iso) return 'never';
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function countdown(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const d = Math.floor(seconds / 86_400), h = Math.floor((seconds % 86_400) / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const when = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso)) + ' ET';

function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{children}</span>;
}

function Tile({ label, value, detail, icon: Icon, tone = 'neutral', children }: { label: string; value: ReactNode; detail: ReactNode; icon: typeof Clock3; tone?: 'good' | 'warn' | 'bad' | 'neutral'; children?: ReactNode }) {
  return <div className={`metric-card ops-tile ops-tone-${tone}`}>
    <div className="flex items-start justify-between"><span className="metric-label">{label}</span><Icon className="h-4 w-4 text-accent" /></div>
    <div className="mt-4 metric-value">{value}</div>
    {children}
    <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
  </div>;
}

export default function OpsPage() {
  const now = useNow(1000);
  const ops = useQuery({
    queryKey: ['admin-ops'],
    queryFn: async (): Promise<Ops> => {
      const response = await fetch('/api/admin/ops', { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const data = ops.data;
  const credits = data?.odds.creditsRemaining ?? null;
  const creditShare = credits === null ? 0 : Math.min(1, credits / MONTHLY_CREDITS);
  const staleFeeds = data?.feeds.filter(feed => feed.stale).length ?? 0;
  const nextTask = data?.clock.plan.find(item => Date.parse(item.at) > now);
  const clockTone = !data ? 'neutral' : data.clock.running ? 'good' : data.clock.enabled ? 'warn' : 'bad';

  return <>
    <header className="page-header">
      <div>
        <p className="eyebrow">System / Live</p>
        <h1 className="page-title">Ops</h1>
        <p className="page-detail">The kickoff clock, every data feed, Odds API credits and the weekly model runs, refreshed every 30 seconds.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`ops-live ${ops.isError ? 'ops-live-off' : ''}`} aria-live="polite"><span />{ops.isError ? 'Offline' : 'Live'}</span>
        <button type="button" className="button button-subtle" onClick={() => void ops.refetch()}><RefreshCw className={`h-4 w-4 ${ops.isFetching ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>
    </header>

    {ops.isLoading && <div className="panel ops-skeleton" aria-busy="true">Loading ops…</div>}
    {ops.isError && <div className="panel"><p className="font-semibold text-ink"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-500" />Couldn&apos;t load ops data.</p><p className="mt-1 text-sm text-muted-foreground">Sign in as an admin, or try again in a minute.</p></div>}

    {data && <>
      <div className="ops-grid">
        <Tile label="Kickoff clock" icon={Radio} tone={clockTone}
          value={data.clock.running ? 'Running' : data.clock.enabled ? 'Starting' : 'Off'}
          detail={data.clock.dispatchConfigured ? 'Picks re-runs are dispatched to GitHub' : 'Add GITHUB_DISPATCH_TOKEN for pre-game picks re-runs'} />
        <Tile label="Next task" icon={Clock3} tone="neutral"
          value={nextTask ? <span className="ops-count">{countdown(nextTask.at, now)}</span> : '—'}
          detail={nextTask ? `${TASK_LABEL[nextTask.kind]} · ${when(nextTask.at)}` : 'Nothing scheduled in the next 8 days'} />
        <Tile label="Odds API credits" icon={Coins} tone={credits === null ? 'neutral' : credits < 60 ? 'bad' : credits < 150 ? 'warn' : 'good'}
          value={credits ?? '—'} detail={`${data.odds.creditsUsedLast7Days} used in 7 days · last capture ${ago(data.odds.lastCapture, now)}`}>
          <div className="ops-gauge" role="meter" aria-valuemin={0} aria-valuemax={MONTHLY_CREDITS} aria-valuenow={credits ?? 0} aria-label="Odds API credits left this month">
            <span style={{ transform: `scaleX(${creditShare})` }} />
          </div>
        </Tile>
        <Tile label="Data feeds" icon={staleFeeds ? AlertTriangle : CircleCheck} tone={staleFeeds ? 'warn' : 'good'}
          value={staleFeeds ? `${staleFeeds} stale` : 'All fresh'} detail={data.clock.nextKickoff ? `Next kickoff in ${countdown(data.clock.nextKickoff, now)}` : 'No games in the next 8 days'} />
      </div>

      <div className="ops-columns">
        <section className="panel">
          <p className="eyebrow">Kickoff clock</p>
          <h2 className="section-title">Coming up</h2>
          {data.clock.plan.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No kickoffs in the next 8 days.</p>
            : <ol className="ops-timeline">{data.clock.plan.map(item => {
              const due = Date.parse(item.at) <= now;
              return <li key={`${item.kind}-${item.at}`} className={due ? 'is-due' : ''}>
                <span className={`ops-kind ops-kind-${item.kind}`} />
                <div><b>{TASK_LABEL[item.kind]}</b><small>{when(item.at)} · for the {when(item.kickoff)} kickoff</small></div>
                <span className="ops-eta">{due ? 'now' : countdown(item.at, now)}</span>
              </li>;
            })}</ol>}
        </section>

        <section className="panel">
          <p className="eyebrow">Since the last restart</p>
          <h2 className="section-title">Clock runs</h2>
          {data.clock.log.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No tasks yet. They start 80 minutes before the next kickoff.</p>
            : <ul className="ops-log">{data.clock.log.map(entry => <li key={`${entry.key}-${entry.at}`}>
              <Pill tone={entry.ok ? (entry.outcome.startsWith('skipped') ? 'neutral' : 'good') : 'bad'}>{TASK_LABEL[entry.kind]}</Pill>
              <span className="ops-log-text">{entry.outcome}</span>
              <time dateTime={entry.at}>{ago(entry.at, now)}</time>
            </li>)}</ul>}
        </section>
      </div>

      <div className="ops-columns">
        <section className="panel">
          <p className="eyebrow">Freshness</p>
          <h2 className="section-title">Feeds and model runs</h2>
          <ul className="ops-rows">
            {data.feeds.map(feed => <li key={feed.feed}><span>{feed.feed}</span><Pill tone={feed.stale ? 'warn' : 'good'}>{ago(feed.at, now)}</Pill></li>)}
            <li><span>Sportsbook lines</span><Pill tone={data.odds.lastCapture ? 'good' : 'warn'}>{ago(data.odds.lastCapture, now)}</Pill></li>
            <li><span>TD picks{data.picks.touchdowns ? ` · week ${data.picks.touchdowns.week}` : ''}</span><Pill tone={data.picks.touchdowns ? 'good' : 'warn'}>{ago(data.picks.touchdowns?.at ?? null, now)}</Pill></li>
            <li><span>Game projections{data.picks.games ? ` · week ${data.picks.games.week}` : ''}</span><Pill tone={data.picks.games ? 'good' : 'warn'}>{ago(data.picks.games?.at ?? null, now)}</Pill></li>
            {data.reports.map(report => <li key={report.kind}><span>{REPORT_LABEL[report.kind] ?? report.kind}{report.week ? ` · week ${report.week}` : ''}</span><Pill tone={report.at ? 'neutral' : 'warn'}>{ago(report.at, now)}</Pill></li>)}
          </ul>
        </section>

        <section className="panel">
          <p className="eyebrow">GitHub Actions</p>
          <h2 className="section-title">Workflow runs</h2>
          {!data.github.runs ? <p className="mt-3 text-sm text-muted-foreground"><CalendarClock className="mr-2 inline h-4 w-4" />{data.github.error}</p>
            : <ul className="ops-log">{data.github.runs.map(run => <li key={run.url}>
              <Pill tone={run.status !== 'completed' ? 'warn' : run.conclusion === 'success' ? 'good' : run.conclusion === 'skipped' || run.conclusion === 'cancelled' ? 'neutral' : 'bad'}>
                {run.status !== 'completed' ? run.status.replace('_', ' ') : run.conclusion ?? 'done'}
              </Pill>
              <a className="ops-log-text" href={run.url} target="_blank" rel="noreferrer">{run.name} <small>({run.event === 'schedule' ? 'scheduled' : run.event === 'workflow_dispatch' ? 'dispatched' : run.event})</small> <ExternalLink className="inline h-3 w-3" /></a>
              <time dateTime={run.createdAt}>{ago(run.createdAt, now)}</time>
            </li>)}</ul>}
        </section>
      </div>
    </>}
  </>;
}
