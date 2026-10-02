import type { ConsumerGame } from '@workspace/api-client-react';

export type Slate = { season: number; week: number };
export function readSlate(search: string): Slate | null {
  const params = new URLSearchParams(search);
  const season = params.get('season');
  const week = params.get('week');
  if (!season || !week || !/^\d+$/.test(season) || !/^\d+$/.test(week)) return null;
  const values = { season: Number(season), week: Number(week) };
  return values.season >= 2020 && values.week >= 1 && values.week <= 22 ? values : null;
}

export function officialResult(game: Pick<ConsumerGame, 'gameState' | 'finalScore'>) {
  return game.gameState === 'final' ? game.finalScore : null;
}
