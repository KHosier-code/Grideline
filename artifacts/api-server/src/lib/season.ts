import { fetchCurrentSeasonWeek, logEspnFailure } from "./espn";

export function getCurrentSeasonWeek(now = new Date()) {
  const season = now.getUTCFullYear();
  const openingThursday = new Date(Date.UTC(season, 8, 8));
  while (openingThursday.getUTCDay() !== 4) {
    openingThursday.setUTCDate(openingThursday.getUTCDate() + 1);
  }
  const daysSinceOpening = Math.floor(
    (now.getTime() - openingThursday.getTime()) / (24 * 60 * 60 * 1000),
  );
  const week = daysSinceOpening < 0 ? 1 : Math.min(18, Math.floor(daysSinceOpening / 7) + 1);
  return { season, week };
}

export async function resolveCurrentSeasonWeek() {
  try {
    return await fetchCurrentSeasonWeek();
  } catch (error) {
    logEspnFailure(error);
    return { ...getCurrentSeasonWeek(), seasonType: 2 };
  }
}