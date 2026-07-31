/**
 * Elevation API dispatcher.
 *
 * Two backends are supported, chosen at build time via VITE_ELEVATION_SOURCE:
 *   - `opentopography` (default): a single GeoTIFF from OpenTopography,
 *     with the DEM picked by VITE_ELEVATION_DEMTYPE.
 *   - `planetary-computer`: Copernicus DEM GLO-30 tiles fetched via
 *     Microsoft Planetary Computer's STAC API.
 *
 * Both backends normalize the result into a WGS84- (or EPSG:3035-)aligned
 * `ElevationGrid`, so downstream code doesn't care where the data came from.
 */

import type { ElevationGrid } from '../domain/elevation';
import { fetchElevationGridFromOpenTopography } from './openTopographyElevationApi';
import { fetchElevationGridFromPlanetaryComputer } from './planetaryComputerElevationApi';

export type ElevationSource = 'opentopography' | 'planetary-computer';

const SUPPORTED_SOURCES = ['opentopography', 'planetary-computer'] as const;

export const ELEVATION_SOURCE: ElevationSource = (() => {
  const raw = import.meta.env.VITE_ELEVATION_SOURCE as string | undefined;
  if (raw && (SUPPORTED_SOURCES as readonly string[]).includes(raw)) {
    return raw as ElevationSource;
  }
  return 'opentopography';
})();

export interface ElevationFetchProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (progress: ElevationFetchProgress) => void;

export async function fetchElevationGrid(
  bbox: [number, number, number, number],
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  if (ELEVATION_SOURCE === 'planetary-computer') {
    return fetchElevationGridFromPlanetaryComputer(bbox, onProgress);
  }
  return fetchElevationGridFromOpenTopography(bbox, onProgress);
}

/** Expand a bbox by `deg` on every side, clamped to lat/lon bounds. */
export function bufferBbox(
  bbox: [number, number, number, number],
  deg: number,
): [number, number, number, number] {
  return [
    Math.max(-180, bbox[0] - deg),
    Math.max(-90, bbox[1] - deg),
    Math.min(180, bbox[2] + deg),
    Math.min(90, bbox[3] + deg),
  ];
}

export class ElevationApiError extends Error {
  public readonly statusCode?: number;
  public readonly serviceName: string;

  constructor(
    message: string,
    statusCode?: number,
    serviceName = 'OpenTopography',
  ) {
    super(message);
    this.name = 'ElevationApiError';
    this.statusCode = statusCode;
    this.serviceName = serviceName;
  }
}
