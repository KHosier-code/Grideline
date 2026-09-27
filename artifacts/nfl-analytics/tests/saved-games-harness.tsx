// Isolated component entry: no Clerk provider, credentials, saved-game API or production route.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsumerSavedGamesView } from '../src/pages/consumer/ConsumerSavedGames';
import { SaveGameControl } from '../src/pages/consumer/consumer-ui';
import { savedGamesFixture } from './saved-games-fixture';
import '../src/index.css';

const state = new URLSearchParams(window.location.search).get('state');
if (!['populated', 'empty', 'loading', 'error'].includes(state ?? '')) {
  throw new Error('Saved Games fixture requires state=populated|empty|loading|error');
}

function Fixture() {
  const [savedIds, setSavedIds] = useState(() => savedGamesFixture.map(game => game.gameId));
  const [retried, setRetried] = useState(false);
  return <div className="consumer-shell"><main className="consumer-main">
    <ConsumerSavedGamesView isLoaded userId="fixture-only" games={state === 'populated' || retried ? savedGamesFixture : []}
      isLoading={state === 'loading'} isError={state === 'error' && !retried} onRetry={() => setRetried(true)}
      renderSaveControl={gameId => <SaveGameControl isSignedIn saved={savedIds.includes(gameId)}
        onToggle={() => setSavedIds(ids => ids.includes(gameId) ? ids.filter(id => id !== gameId) : [...ids, gameId])} />} />
  </main></div>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);