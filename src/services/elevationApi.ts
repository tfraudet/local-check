/**
 * Elevation HTTP API client — OpenTopography Global DEM (SRTM GL3, ~90 m).
 *
 * Makes a single request to the OpenTopography REST API for the flight's
 * bounding box and returns a GeoTIFF that is parsed in-browser with geotiff.js.
 * One download replaces the hundreds of JSON point-queries used by the old
 * Open-Elevation approach.
 *
 * An API key is required and must be set via VITE_OPENTOPOGRAPHY_API_KEY.
 * Register for free at https://opentopography.org/developers
 */

import { fromArrayBuffer } from 'geotiff';
import type { ElevationGrid } from '../domain/elevation';

const OT_API_KEY = import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY as string | undefined;

const OT_BASE = import.meta.env.DEV
  ? '/ot-proxy/API/globaldem'
  : 'https://portal.opentopography.org/API/globaldem';

export interface ElevationFetchProgress {
  loaded: number;
  total: number;
}

export type ProgressCallback = (progress: ElevationFetchProgress) => void;

/**
 * Fetch a terrain elevation grid for the given bbox (with a 0.1° buffer).
 * Calls `onProgress` once the download completes and the grid is ready.
 *
 * Throws an `ElevationApiError` on any network, API, or parsing failure.
 */
export async function fetchElevationGrid(
  bbox: [number, number, number, number],
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  if (!OT_API_KEY) {
    throw new ElevationApiError(
      'No OpenTopography API key found. Set VITE_OPENTOPOGRAPHY_API_KEY in your .env file.',
    );
  }

  const [minLon, minLat, maxLon, maxLat] = bufferBbox(bbox, 0.1);

  // NOTE: only WGS84-native DEMs work here — sampleElevation() treats grid
  // coordinates as decimal degrees. EU_DTM is served in EPSG:3035 (LAEA
  // meters), which produced grid bboxes like [3782370, 2497660, …] that
  // silently excluded every fix from the terrain series.
  const params = new URLSearchParams({
    demtype: 'SRTMGL1',
    south: String(minLat),
    north: String(maxLat),
    west: String(minLon),
    east: String(maxLon),
    outputFormat: 'GTiff',
    API_Key: OT_API_KEY,
  });

  const url = `${OT_BASE}?${params}`;
  console.log('[elevationApi] GET', url);
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ElevationApiError(
      `OpenTopography API returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      response.status,
    );
  }

  // An error from the API can come back as text/plain with status 200.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('image/tiff') && !contentType.includes('application/octet-stream')) {
    const body = await response.text().catch(() => '');
    throw new ElevationApiError(
      `Unexpected content-type "${contentType}" from OpenTopography${body ? `: ${body.slice(0, 200)}` : ''}`,
    );
  }

  const buffer = await response.arrayBuffer();

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const cols = image.getWidth();
  const rows = image.getHeight();

  // getBoundingBox() returns [west, south, east, north] for geographic CRS.
  const [west, south, east, north] = image.getBoundingBox();

  const rasters = await image.readRasters();
  const band = rasters[0] as Float32Array | Int16Array;

  // GeoTIFF row 0 = north; our ElevationGrid row 0 = south — flip vertically.
  const data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const srcRow = rows - 1 - r;
    for (let c = 0; c < cols; c++) {
      const raw = band[srcRow * cols + c];
      // SRTM nodata is typically -32768; treat as 0.
      data[r * cols + c] = raw < -9000 ? 0 : raw;
    }
  }

  const latSpanM = ((north - south) * Math.PI) / 180 * 6_371_000;
  const resolutionM = Math.round(latSpanM / Math.max(rows - 1, 1));

  onProgress?.({ loaded: 1, total: 1 });

  return { bbox: [west, south, east, north], cols, rows, resolutionM, data };
}

function bufferBbox(
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

  constructor(
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = 'ElevationApiError';
    this.statusCode = statusCode;
  }
}
