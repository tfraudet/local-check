/**
 * Elevation API dispatcher.
 *
 * Two backends are supported, chosen at runtime by the user in the
 * Settings panel (persisted via the flight store):
 *   - `planetary-computer` (default): Copernicus DEM GLO-30 tiles fetched
 *     via Microsoft Planetary Computer's STAC API. DSM, ~30 m.
 *   - `aws-terrain`: AWS Open Data "Terrain Tiles" (Terrarium PNG tiles)
 *     served from a CloudFront-fronted S3 bucket. DTM, ~10-30 m depending
 *     on region.
 *
 * Both are key-less. Backends normalize the result into a WGS84-aligned
 * `ElevationGrid`, so downstream code doesn't care where the data came
 * from.
 */

import type { ElevationGrid } from '../domain/elevation';
import type { Bbox } from '../domain/bbox';
import { fetchElevationGridFromPlanetaryComputer } from './planetaryComputerElevationApi';
import { fetchElevationGridFromAwsTerrain } from './awsTerrainElevationApi';

export type ElevationSource = 'planetary-computer' | 'aws-terrain';

export const SUPPORTED_ELEVATION_SOURCES: readonly ElevationSource[] = [
  'planetary-computer',
  'aws-terrain',
] as const;

export const DEFAULT_ELEVATION_SOURCE: ElevationSource = 'aws-terrain';

export interface ElevationFetchProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (progress: ElevationFetchProgress) => void;

export async function fetchElevationGrid(
  bbox: Bbox,
  source: ElevationSource,
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  const startedAt = import.meta.env.DEV ? performance.now() : 0;
  try {
    if (source === 'aws-terrain') {
      return await fetchElevationGridFromAwsTerrain(bbox, onProgress);
    }
    return await fetchElevationGridFromPlanetaryComputer(bbox, onProgress);
  } finally {
    if (import.meta.env.DEV) {
      console.log(
        `[fetchElevationGrid:${source}] ${(performance.now() - startedAt).toFixed(1)} ms`,
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
    serviceName = 'Elevation API',
  ) {
    super(message);
    this.name = 'ElevationApiError';
    this.statusCode = statusCode;
    this.serviceName = serviceName;
  }
}
