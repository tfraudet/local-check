/**
 * OpenAIP airports service — data-export flavour.
 *
 * Instead of hitting the OpenAIP REST API on every viewport change, we fetch
 * the per-country JSON exports published at
 *   https://storage.openaip.net/openaip-system-exports/<cc>_apt.json
 * (see https://www.openaip.net/docs), map airports onto the app's `LandingZone`
 * shape, and cache the payloads in localStorage for 24 h so re-uploading an
 * IGC in the same country doesn't re-download anything.
 */

import type { LandingZone } from '../domain/landingZone';
import { lzId } from '../domain/landingZone';

/**
 * OpenAIP's storage bucket doesn't send CORS headers, so we go through the
 * Vite proxy whenever the app is served from localhost (both `vite dev` and
 * `vite preview` honour `server.proxy` / `preview.proxy`). In a real
 * deployment we hit the bucket directly and rely on the hosting layer to
 * proxy it if needed.
 */
const IS_LOCAL_SERVE =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');
const STORAGE_BASE = IS_LOCAL_SERVE
  ? '/openaip-storage-proxy/openaip-system-exports'
  : 'https://storage.openaip.net/openaip-system-exports';

const CACHE_KEY_PREFIX = 'openaip:apt:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface OpenAipElevation {
  value: number;
  unit: number;
  referenceDatum?: number;
}

interface OpenAipRunway {
  trueHeading?: number;
}

interface OpenAipAirport {
  _id: string;
  name: string;
  icaoCode?: string;
  altIdentifier?: string;
  type: number;
  country?: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  elevation?: OpenAipElevation;
  runways?: OpenAipRunway[];
}

interface CacheEntry {
  timestamp: number;
  airports: OpenAipAirport[];
}

export class OpenAipExportApiError extends Error {
  public readonly statusCode?: number;
  public readonly country?: string;
  constructor(message: string, country?: string, statusCode?: number) {
    super(message);
    this.name = 'OpenAipExportApiError';
    this.country = country;
    this.statusCode = statusCode;
  }
}

/**
 * Airport `type` codes we keep as landing zones:
 *   0 Airport (civil/military), 1 Glider Site, 2 Airfield Civil,
 *   3 International Airport, 6 Ultra Light Flying Site,
 *   9 Airport resp. Airfield IFR, 11 Landing Strip, 13 Altiport.
 * Everything else (heliports, military, closed, water fields, agricultural
 * strips, …) is dropped up-front so the cache never stores them.
 */
const KEPT_TYPES = new Set([0, 1, 2, 3, 6, 9, 11, 13]);

/**
 * Fetch airports for every country the flight crosses. Returns a flat, already
 * de-duplicated array of `LandingZone`s ready to hand to the store.
 */
export async function fetchAirportsForCountries(
  countries: readonly string[],
  signal?: AbortSignal,
): Promise<LandingZone[]> {
  const settled = await Promise.allSettled(
    countries.map((cc) => fetchCountryAirports(cc, signal)),
  );

  const zones: LandingZone[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      console.warn('[openaip-export] country fetch failed:', result.reason);
      continue;
    }
    for (const zone of result.value) {
      if (seen.has(zone.id)) continue;
      seen.add(zone.id);
      zones.push(zone);
    }
  }
  return zones;
}

async function fetchCountryAirports(
  country: string,
  signal?: AbortSignal,
): Promise<LandingZone[]> {
  const cc = country.toLowerCase();
  const cached = readCache(cc);
  if (cached) {
    if (import.meta.env.DEV) {
      console.log(`[openaip-export] cache hit for ${cc} (${cached.airports.length} airports)`);
    }
    return mapAirports(cached.airports);
  }

  const url = `${STORAGE_BASE}/${cc}_apt.json`;
  if (import.meta.env.DEV) console.log('[openaip-export] GET', url);
  const startedAt = performance.now();

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new OpenAipExportApiError(
      `OpenAIP export for ${cc} returned HTTP ${response.status}`,
      cc,
      response.status,
    );
  }
  const raw = (await response.json()) as OpenAipAirport[];
  const airports = raw.filter((a) => KEPT_TYPES.has(a.type));
  if (import.meta.env.DEV) {
    console.log(
      `[openaip-export] ← ${raw.length} airports for ${cc} (${airports.length} kept after type filter) in ${(performance.now() - startedAt).toFixed(0)}ms`,
    );
  }

  writeCache(cc, airports);
  return mapAirports(airports);
}

function mapAirports(airports: OpenAipAirport[]): LandingZone[] {
  const zones: LandingZone[] = [];
  for (const a of airports) {
    const zone = airportToLandingZone(a);
    if (zone) zones.push(zone);
  }
  return zones;
}

function airportToLandingZone(a: OpenAipAirport): LandingZone | null {
  const [lon, lat] = a.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const name = (a.icaoCode ? `${a.icaoCode} — ${a.name}` : a.name).trim();
  return {
    id: lzId(name, lat, lon),
    name,
    code: a.icaoCode ?? a.altIdentifier ?? null,
    latitude: lat,
    longitude: lon,
    elevationM: elevationToMeters(a.elevation),
    style: mapTypeToSeeYouStyle(a.type),
    difficulty_level: 'green',
    description: null,
    isAirfield: true,
    runwayHeading: lastRunwayHeading(a.runways),
    source: 'openaip',
  };
}

function lastRunwayHeading(runways: OpenAipRunway[] | undefined): number {
  if (!runways || runways.length === 0) return 0;
  const h = runways[runways.length - 1].trueHeading;
  if (typeof h !== 'number' || !isFinite(h)) return 0;
  return ((h % 360) + 360) % 360;
}

function elevationToMeters(e: OpenAipElevation | undefined): number | null {
  if (!e || typeof e.value !== 'number') return null;
  return e.unit === 1 ? e.value * 0.3048 : e.value;
}

function mapTypeToSeeYouStyle(type: number): number {
  switch (type) {
    case 1:
      return 4;
    case 2:
    case 6:
    case 11:
    case 12:
      return 2;
    default:
      return 5;
  }
}

function readCache(cc: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + cc);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + cc);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(cc: string, airports: OpenAipAirport[]): void {
  const entry: CacheEntry = { timestamp: Date.now(), airports };
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + cc, JSON.stringify(entry));
  } catch (err) {
    // Quota exceeded is common for large countries; evict older entries and
    // drop this write silently. The next flight will refetch as needed.
    if (import.meta.env.DEV) {
      console.warn(`[openaip-export] localStorage write failed for ${cc}:`, err);
    }
    evictOldestCacheEntries();
  }
}

function evictOldestCacheEntries(): void {
  const entries: Array<{ key: string; timestamp: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CACHE_KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as CacheEntry;
      entries.push({ key, timestamp: parsed.timestamp });
    } catch {
      localStorage.removeItem(key);
    }
  }
  entries.sort((a, b) => a.timestamp - b.timestamp);
  for (const { key } of entries.slice(0, Math.ceil(entries.length / 2))) {
    localStorage.removeItem(key);
  }
}
