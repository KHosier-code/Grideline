import { Link } from 'wouter';

const sections = [
  {
    title: 'Where the evidence comes from',
    text: 'Schedules and final statuses come from saved game feeds. Market lines are locally captured sportsbook quotes, not a continuous or guaranteed opening-to-close record. Team and player context may draw on separate historical statistics, personnel, injury and weather feeds. Each screen identifies missing, stale or incomplete evidence where it affects the view.',
  },
  {
    title: 'Freshness and availability',
    text: 'A source timestamp describes a recorded fetch or observation, not a promise that the underlying source has not changed. Game Detail and Home show saved feed health, capture times and eligibility where available. Missing inputs do not become zeros or inferred facts; if a projection, matchup comparison or context cannot be supported, it may be unavailable.',
  },
  {
    title: 'Saved versus official predictions',
    text: 'A saved model outlook is a persisted projection, not automatically an official pick. An official final prediction must be identified as such and frozen before kickoff. A current quote or an older saved projection is not proof of a pregame recommendation. Model-versus-market differences are informational, not betting advice.',
  },
  {
    title: 'Players: past studies are not upcoming picks',
    text: 'Historical player estimates are retrospective simulations for past games, not live forecasts. Conditional upcoming player estimates, when available in a development preview, depend on uncertain participation and are separate from the stricter roster-and-starter readiness audit. Production player forecasts and betting player props are not offered here. Past game-time feature ordering alone does not prove when original source files were published.',
  },
  {
    title: 'How performance is verified',
    text: 'Performance uses persisted official predictions with legitimate final game results. Winner accuracy counts eligible correct winners; margin and total mean absolute error measure average absolute point differences. Each measure has its own graded denominator. A small, missing or truncated sample must not be treated as a complete track record. Historical simulations and ungraded saved outlooks are not added to official performance.',
  },
  {
    title: 'What the numbers cannot establish',
    text: 'A graded model-quality measure is not a betting-return or profitability result. Coverage varies by season, source and game; a final score requires an official final status, not just a displayed score. Injury omissions do not confirm health, and incomplete depth data cannot verify participation or individual coverage assignments. Review the evidence and limitations on each game before using any estimate.',
  },
];

export default function ConsumerMethodology() {
  return <div className="consumer-page">
    <header className="consumer-page-header">
      <div><p className="consumer-eyebrow">About the evidence</p><h1>Methodology & limitations</h1>
        <p>How Gridline labels its sources, saved predictions and measured results. Availability changes with the evidence; this page does not report a live readiness or performance status.</p></div>
    </header>
    <div className="grid gap-4 mt-8 md:grid-cols-2">
      {sections.map(({ title, text }) => <section className="rounded-xl border border-border bg-card p-5 sm:p-6" key={title}>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p>
      </section>)}
    </div>
    <nav aria-label="Explore the evidence" className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
      <Link href="/games" className="text-accent hover:underline">Browse saved games</Link>
      <Link href="/performance" className="text-accent hover:underline">See verified performance</Link>
    </nav>
  </div>;
}