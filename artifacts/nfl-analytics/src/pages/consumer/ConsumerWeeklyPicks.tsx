import { getGetConsumerWeeklyPicksQueryKey, useGetConsumerWeeklyPicks, type ConsumerWeeklyPickArchive } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import { ConsumerLoading, ConsumerMessage } from './consumer-ui';
import './VisitorHome.css';

export function WeeklyPickArchiveContent({ archive, state, onSeasonChange }: {
  archive?: ConsumerWeeklyPickArchive;
  state: 'loading' | 'error' | 'ready';
  onSeasonChange: (season: number) => void;
}) {
  return <div className="consumer-page pick-archive">
    <header className="consumer-page-header">
      <div><p className="consumer-eyebrow">Gridline / Pick history</p><h1>Weekly pick history</h1>
        <p>Official selections require saved first-line evidence. Retrospective reviews are separate, recorded later, and never count as original picks. Saved outlooks and later odds do not fill gaps.</p></div>
    </header>
    {state === 'loading' ? <ConsumerLoading label="Loading official weekly pick history…" />
      : state === 'error' || !archive ? <ConsumerMessage error title="Pick history unavailable" detail="The saved weekly selections could not be loaded right now. Please try again later." />
      : archive.seasons.length === 0 ? <ConsumerMessage title="No past weeks available" detail="There are no completed weeks in the saved schedule to review yet." />
      : <>
        <label className="pick-archive-season">Season
          <select value={archive.season ?? ''} onChange={(event) => onSeasonChange(Number(event.target.value))}>
            {!archive.seasons.includes(archive.season ?? -1) && <option value={archive.season ?? ''}>{archive.season} (not in saved schedule)</option>}
            {archive.seasons.map((season) => <option value={season} key={season}>{season}</option>)}
          </select>
        </label>
        {archive.weeks.length === 0 ? <ConsumerMessage title="No past weeks for this season" detail="There are no completed weeks in the saved schedule for this season." />
          : <ol className="pick-archive-list">
            {archive.weeks.map((item) => <li key={`${item.season}-${item.week}`}>
              <article className="pick-archive-item">
                <p className="consumer-eyebrow">{item.season} · Week {item.week}</p>
                {item.pick ? <><h2>{item.pick.teamName}</h2><p>Official weekly winner · first verified lines. Not a guaranteed result.</p></>
                  : <><h2>Official pick unavailable</h2><p>{item.reason ?? 'Saved initial-line evidence is unavailable.'}</p></>}
                {item.retrospective && <div className="mt-4 border-t border-border pt-3">
                  <p className="consumer-eyebrow"><strong>{item.retrospective.label}</strong></p>
                  {item.retrospective.choice ? <>
                    <h3>{item.retrospective.choice.teamName}</h3>
                    <p>{item.retrospective.choice.matchup} · algorithm probability {(item.retrospective.choice.probability * 100).toFixed(1)}%</p>
                    <p>Original evidence cutoff {new Date(item.retrospective.choice.cutoffAt).toLocaleString()} · reviewed {new Date(item.retrospective.choice.reviewedAt).toLocaleString()}
                      {item.retrospective.choice.publishedAt && <> · published {new Date(item.retrospective.choice.publishedAt).toLocaleString()}</>}</p>
                    <p>Evidence identity: {item.retrospective.choice.evidenceId}</p>
                  </> : <p>Choice cannot be established: {item.retrospective.reason}</p>}
                </div>}
              </article>
            </li>)}
          </ol>}
      </>}
    <p className="consumer-note"><Link href="/">Back to Home</Link> · <Link href="/methodology">Methodology and limitations</Link></p>
  </div>;
}

export default function ConsumerWeeklyPicks() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const raw = new URLSearchParams(search).get('season');
  const season = raw && /^\d{4}$/.test(raw) && Number(raw) >= 2020 ? Number(raw) : undefined;
  const params = season === undefined ? undefined : { season };
  const query = useGetConsumerWeeklyPicks(params, { query: {
    queryKey: getGetConsumerWeeklyPicksQueryKey(params), staleTime: 60_000,
  } });
  return <WeeklyPickArchiveContent archive={query.data}
    state={query.isLoading ? 'loading' : query.isError || !query.data ? 'error' : 'ready'}
    onSeasonChange={(chosen) => navigate(`/weekly-picks?season=${chosen}`)} />;
}