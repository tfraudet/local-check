/**
 * Elevation API dispatcher.
 *
 * Two backends are supported, chosen at build time via VITE_ELEVATION_SOURCE:
 *   - `planetary-computer` (default): Copernicus DEM GLO-30 tiles fetched
 *     via Microsoft Planetary Computer's STAC API. No API key required.
 *   - `opentopography`: a single GeoTIFF from OpenTopography, with the DEM
 *     picked by VITE_ELEVATION_DEMTYPE.
 *
 * Both backends normalize the result into a WGS84- (or EPSG:3035-)aligned
 * `ElevationGrid`, so downstream code doesn't care where the data came from.
 */

import type { ElevationGrid } from '../domain/elevation';
import type { Bbox } from '../domain/bbox';
import { fetchElevationGridFromOpenTopography } from './openTopographyElevationApi';
import { fetchElevationGridFromPlanetaryComputer } from './planetaryComputerElevationApi';

export type ElevationSource = 'opentopography' | 'planetary-computer';

const SUPPORTED_SOURCES = ['opentopography', 'planetary-computer'] as const;

export const ELEVATION_SOURCE: ElevationSource = (() => {
  const raw = import.meta.env.VITE_ELEVATION_SOURCE as string | undefined;
  if (raw && (SUPPORTED_SOURCES as readonly string[]).includes(raw)) {
    return raw as ElevationSource;
  }
  return 'planetary-computer';
})();

export interface ElevationFetchProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (progress: ElevationFetchProgress) => void;

export async function fetchElevationGrid(
  bbox: Bbox,
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  const startedAt = import.meta.env.DEV ? performance.now() : 0;
  try {
    if (ELEVATION_SOURCE === 'planetary-computer') {
      return await fetchElevationGridFromPlanetaryComputer(bbox, onProgress);
    }
    return await fetchElevationGridFromOpenTopography(bbox, onProgress);
  } finally {
    if (import.meta.env.DEV) {
      console.log(
        `[fetchElevationGrid] ${(performance.now() - startedAt).toFixed(1)} ms`,
      );
    }
  }
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
