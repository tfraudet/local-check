/**
 * Detect the set of countries traversed by a flight from its fix track.
 *
 * Uses an offline 10 km-resolution world polygon set (@geo-maps/countries-land-10km)
 * with a polygon spatial index, then maps ISO 3166-1 alpha-3 to lowercase alpha-2
 * codes — the form used by OpenAIP data-export filenames (e.g. `fr_apt.json`).
 */

import PolygonLookup from 'polygon-lookup';
import getCountriesMap from '@geo-maps/countries-land-10km';
import { alpha3ToAlpha2 } from 'i18n-iso-countries';
import type { Fix } from '../domain/flight';

let lookup: PolygonLookup | null = null;

function getLookup(): PolygonLookup {
  if (!lookup) lookup = new PolygonLookup(getCountriesMap());
  return lookup;
}

/** ISO 3166-1 alpha-3 code at (lat, lon), or null when over open water. */
function countryAt(lat: number, lon: number): string | null {
  const result = getLookup().search(lon, lat, -1);
  const features = result?.features ?? [];
  for (const f of features) {
    const a3 = (f.properties as { A3?: string }).A3;
    if (a3) return a3;
  }
  return null;
}

/**
 * Return the set of lowercase ISO alpha-2 country codes visited by the flight.
 *
 * The track is sampled evenly (up to `sampleCount` points) rather than every
 * fix — countries only change at border crossings, and 30 samples across a
 * multi-hour flight already resolves all realistic transits.
 */
export function detectCountriesFromFixes(
  fixes: readonly Fix[],
  sampleCount = 30,
): string[] {
  if (fixes.length === 0) return [];
  const codes = new Set<string>();
  const step = Math.max(1, Math.floor(fixes.length / sampleCount));
  for (let i = 0; i < fixes.length; i += step) {
    const { latitude, longitude } = fixes[i];
    const a3 = countryAt(latitude, longitude);
    if (!a3) continue;
    const a2 = alpha3ToAlpha2(a3);
    if (a2) codes.add(a2.toLowerCase());
  }
  // Ensure the last fix is included so we cover the flight's endpoint.
  const last = fixes[fixes.length - 1];
  const a3 = countryAt(last.latitude, last.longitude);
  const a2 = a3 ? alpha3ToAlpha2(a3) : undefined;
  if (a2) codes.add(a2.toLowerCase());
  return [...codes];
}
