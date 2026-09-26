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
      <div><p className="consumer-eyebrow">Gridline / Official picks</p><h1>Weekly pick history</h1>
        <p>Past winners are shown only when Gridline saved an official weekly selection and its first-line evidence still verifies. Saved outlooks and later odds are not used to fill gaps.</p></div>
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