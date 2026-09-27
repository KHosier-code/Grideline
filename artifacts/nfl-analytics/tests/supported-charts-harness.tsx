import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ConsumerMatchupAssessment, ConsumerMatchupBoard, ConsumerMovement, ConsumerMovementItem, ConsumerTeam } from '@workspace/api-client-react';
import { ConsumerPregameComparisonChart } from '../src/components/ConsumerPregameComparisonChart';
import { LineMovementExperience } from '../src/components/LineMovementExperience';
import '../src/index.css';

const away: ConsumerTeam = { name: 'Away Fixture', abbreviation: 'AWY', logoUrl: null };
const home: ConsumerTeam = { name: 'Home Fixture', abbreviation: 'HME', logoUrl: null };

function assessment(category: string, label: string, awayValue: number | null, homeValue: number | null): ConsumerMatchupAssessment {
  return {
    category, title: category, edge: 'away', edgeLabel: 'Away edge', confidence: 'medium',
    strength: null, explanation: 'Fixture evidence', coverage: 'Cutoff-safe fixture', limitations: [],
    metrics: [{ label, awayValue, homeValue, unit: 'epa_per_play', higherIsBetter: true }],
  };
}

function board(supported: boolean): ConsumerMatchupBoard {
  return {
    status: supported ? 'partial' : 'absent', sourceCutoff: '2026-09-01T12:00:00Z',
    completeness: { supportedCategories: supported ? 1 : 0, totalCategories: 2 },
    sources: [], methodology: 'Fixture', summary: [],
    assessments: [
      assessment('passing', 'Blended pass EPA / dropback', supported ? 0.123 : null, supported ? -0.234 : null),
      assessment('rushing', 'Blended rush EPA / carry', 0.321, null),
    ],
  };
}

const quote = (point: number | null, price: number, capturedAt: string) => ({ point, price, capturedAt });
const first = '2026-09-01T12:00:00Z';
const second = '2026-09-01T13:00:00Z';

const streams: ConsumerMovementItem[] = [
  {
    sportsbook: 'DraftKings', market: 'spread', selection: 'AWY',
    firstObserved: quote(-3.5, -110, first), current: quote(-2.5, -105, second),
    finalPreKickoff: null, observations: [quote(-3.5, -110, first), quote(-2.5, -105, second)],
  },
  {
    sportsbook: 'FanDuel', market: 'total', selection: 'Over',
    firstObserved: quote(null, -115, first), current: quote(null, -108, second),
    finalPreKickoff: null, observations: [quote(null, -115, first), quote(null, -108, second)],
  },
];

function movement(supported: boolean): ConsumerMovement {
  return {
    available: supported, streams: supported ? streams : [],
    completeness: { status: 'complete', maximumObservations: 200, totalObservations: supported ? 4 : 0, returnedObservations: supported ? 4 : 0, omittedObservations: 0 },
    message: supported ? null : 'No line history available',
  };
}

function Harness() {
  const [supported, setSupported] = useState(false);
  return <main className="consumer-shell">
    <button type="button" onClick={() => setSupported(value => !value)} data-testid="toggle-evidence">
      {supported ? 'Remove evidence' : 'Make evidence available'}
    </button>
    <ConsumerPregameComparisonChart board={board(supported)} away={away} home={home} />
    <LineMovementExperience movement={movement(supported)} beforeKickoff />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);