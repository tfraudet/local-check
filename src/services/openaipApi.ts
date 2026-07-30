/**
 * OpenAIP airports API client.
 *
 * Fetches airports (aerodromes) intersecting a bounding box from the public
 * OpenAIP REST API and maps them onto the app's `LandingZone` shape. Requires
 * an API key set via `VITE_OPENAIP_API_KEY`; register at https://openaip.net.
 */

import type { LandingZone } from '../domain/landingZone';
import { lzId } from '../domain/landingZone';

const OPENAIP_API_KEY = import.meta.env.VITE_OPENAIP_API_KEY as string | undefined;
const OPENAIP_BASE = import.meta.env.DEV
  ? '/openaip-proxy/api'
  : 'https://api.core.openaip.net/api';
const PAGE_LIMIT = 1000;
const MAX_PAGES = 5;

/**
 * OpenAIP airport type codes we request. We exclude heliports (4, 7),
 * military aerodromes (5), closed aerodromes (8) and water airfields (10)
 * — none of which are viable soaring landing sites. Codes:
 *   0 Airport (civil/military), 1 Glider Site, 2 Airfield Civil,
 *   3 International Airport, 6 Ultra Light Flying Site,
 *   9 Airport resp. Airfield IFR, 11 Landing Strip,
 *   12 Agricultural Landing Strip, 13 Altiport.
 */
const REQUESTED_TYPES = [0, 1, 2, 3, 6, 9, 11, 12, 13];

interface OpenAipElevation {
  value: number;
  unit: number; // 0 = m, 1 = ft
  referenceDatum?: number;
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
}

interface OpenAipListResponse {
  page: number;
  nextPage?: number;
  limit: number;
  items: OpenAipAirport[];
}

export class OpenAipApiError extends Error {
  public readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'OpenAipApiError';
    this.statusCode = statusCode;
  }
}

/** bbox is [minLon, minLat, maxLon, maxLat] in WGS84. */
export async function fetchOpenAipAirports(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<LandingZone[]> {
  if (!OPENAIP_API_KEY) {
    throw new OpenAipApiError(
      'No OpenAIP API key found. Set VITE_OPENAIP_API_KEY in your .env file.',
    );
  }

  const zones: LandingZone[] = [];
  let page = 1;
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({
      bbox: bbox.join(','),
      limit: String(PAGE_LIMIT),
      page: String(page),
    });
    for (const t of REQUESTED_TYPES) params.append('type', String(t));
    const url = `${OPENAIP_BASE}/airports?${params}`;
    if (import.meta.env.DEV) console.log('[openaip] GET', url);
    const startedAt = performance.now();
    const response = await fetch(url, {
      signal,
      headers: { 'x-openaip-api-key': OPENAIP_API_KEY },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (import.meta.env.DEV) {
        console.log(
          `[openaip] ← HTTP ${response.status} in ${(performance.now() - startedAt).toFixed(0)}ms`,
        );
      }
      throw new OpenAipApiError(
        `OpenAIP API returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        response.status,
      );
    }
    const json = (await response.json()) as OpenAipListResponse;
    if (import.meta.env.DEV) {
      console.log(
        `[openaip] ← HTTP ${response.status} · page ${json.page} · ${json.items.length} items · ${(performance.now() - startedAt).toFixed(0)}ms`,
        json,
      );
    }
    for (const item of json.items) {
      const zone = airportToLandingZone(item);
      if (zone) zones.push(zone);
    }
    if (!json.nextPage) break;
    page = json.nextPage;
  }
  return zones;
}

function airportToLandingZone(a: OpenAipAirport): LandingZone | null {
  const [lon, lat] = a.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const name = (a.icaoCode ? `${a.icaoCode} — ${a.name}` : a.name).trim();
  const elevationM = elevationToMeters(a.elevation);
  return {
    id: lzId(name, lat, lon),
    name,
    code: a.icaoCode ?? a.altIdentifier ?? null,
    latitude: lat,
    longitude: lon,
    elevationM,
    style: mapTypeToSeeYouStyle(a.type),
    difficulty_level: 'green',
    description: null,
    isAirfield: true,
    source: 'openaip',
  };
}

function elevationToMeters(e: OpenAipElevation | undefined): number | null {
  if (!e || typeof e.value !== 'number') return null;
  return e.unit === 1 ? e.value * 0.3048 : e.value;
}

/**
 * Coarse mapping from OpenAIP airport type to the SeeYou `style` code the
 * rest of the app already understands. Types not covered fall back to
 * "Solid Airfield" (5), which matches how OpenAIP airfields render.
 */
function mapTypeToSeeYouStyle(type: number): number {
  switch (type) {
    case 1: // Glider Site
      return 4; // Gliding Airfield
    case 2: // Airfield Civil
    case 6: // Ultra Light Flying Site
    case 11: // Landing Strip
    case 12: // Agricultural Landing Strip
      return 2; // Airfield with grass surface runway
    default:
      // 0 Airport, 3 International Airport, 9 Airfield IFR,  13 Altiport
      return 5; // Airfield with solid surface runway
  }
}
