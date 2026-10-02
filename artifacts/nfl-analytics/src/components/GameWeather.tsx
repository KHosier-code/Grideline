import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, Warehouse, Wind, type LucideIcon } from 'lucide-react';

type Forecast = {
  available?: unknown; summary?: unknown; temperature?: unknown; sustainedWind?: unknown;
  precipitationProbability?: unknown; indoorOutdoor?: unknown;
} | null | undefined;

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function icon(summary: string): LucideIcon {
  if (/thunder|storm/i.test(summary)) return CloudLightning;
  if (/snow|flurr|sleet|ice|wintry/i.test(summary)) return CloudSnow;
  if (/rain|shower|drizzle/i.test(summary)) return CloudRain;
  if (/fog|haze|smoke|mist/i.test(summary)) return CloudFog;
  if (/partly|mostly sunny|mostly clear/i.test(summary)) return CloudSun;
  if (/cloud|overcast/i.test(summary)) return Cloud;
  if (/sunny|clear|fair/i.test(summary)) return Sun;
  return Cloud;
}

/** "Mostly Cloudy then Chance Rain Showers" → "Mostly cloudy then chance rain showers". */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** Kickoff forecast as one line under the matchup title: icon, temperature, wind, conditions. */
export function GameWeather({ weather }: { weather: Forecast }) {
  if (!weather || weather.available === false) return null;
  if (weather.indoorOutdoor === 'indoor') {
    return <p className="gl-weather" data-testid="game-weather"><Warehouse aria-hidden="true" /><span>Indoors, weather won&apos;t be a factor</span></p>;
  }
  const summary = typeof weather.summary === 'string' ? weather.summary : '';
  const temperature = num(weather.temperature);
  const wind = num(weather.sustainedWind);
  const rain = num(weather.precipitationProbability);
  if (!summary && temperature === null && wind === null) return null;
  const Icon = icon(summary);
  return <p className="gl-weather" data-testid="game-weather" aria-label="Kickoff forecast">
    <Icon aria-hidden="true" />
    {temperature !== null && <b>{Math.round(temperature)}°F</b>}
    {wind !== null && <span className={wind >= 15 ? 'gl-weather-windy' : undefined}>{wind >= 15 && <Wind aria-hidden="true" />}{Math.round(wind)} mph wind</span>}
    {summary && <span>{sentence(summary)}{rain !== null && rain >= 20 ? ` (${Math.round(rain)}%)` : ''}</span>}
  </p>;
}
