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
import type { ElevationGrid, ElevationCrs } from '../domain/elevation';

const OT_API_KEY = import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY as string | undefined;

// Selected via VITE_ELEVATION_DEMTYPE. EU_DTM (Copernicus EU-DEM v1.1) has
// higher resolution (~25 m) but is served in EPSG:3035 (LAEA meters), so it
// requires a WGS84 → EPSG:3035 projection at sample time. SRTMGL1 is 30 m
// and native WGS84 — a good globally-available fallback outside Europe.
const SUPPORTED_DEMTYPES = ['EU_DTM', 'SRTMGL1', 'SRTMGL3', 'COP30', 'COP90'] as const;
type Demtype = (typeof SUPPORTED_DEMTYPES)[number];

const DEMTYPE: Demtype = (() => {
  const raw = import.meta.env.VITE_ELEVATION_DEMTYPE as string | undefined;
  if (raw && (SUPPORTED_DEMTYPES as readonly string[]).includes(raw)) {
    return raw as Demtype;
  }
  return 'EU_DTM';
})();

function crsFor(demtype: Demtype): ElevationCrs {
  return demtype === 'EU_DTM' ? 'EPSG:3035' : 'EPSG:4326';
}

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

  const params = new URLSearchParams({
    demtype: DEMTYPE,
    south: String(minLat),
    north: String(maxLat),
    west: String(minLon),
    east: String(maxLon),
    outputFormat: 'GTiff',
    API_Key: OT_API_KEY,
  });

  const url = `${OT_BASE}?${params}`;
  console.log('[elevationApi] GET', url);
  const startedAt = performance.now();
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (import.meta.env.DEV) {
      console.log(`[elevationApi] ← HTTP ${response.status} · ${(performance.now() - startedAt).toFixed(0)}ms`);
    }
    throw new ElevationApiError(
      `OpenTopography API returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      response.status,
    );
  }

  if (import.meta.env.DEV) {
    console.log(`[elevationApi] ← HTTP ${response.status} · ${(performance.now() - startedAt).toFixed(0)}ms`);
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

  // getBoundingBox() returns [minX, minY, maxX, maxY] in the file's native
  // CRS — degrees for WGS84 rasters, meters for EPSG:3035 (EU_DTM).
  const [minX, minY, maxX, maxY] = image.getBoundingBox();

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

  const crs = crsFor(DEMTYPE);
  // In EPSG:3035 the raster units are already meters. In WGS84 we convert
  // the latitude span to meters via a spherical approximation.
  const ySpanM =
    crs === 'EPSG:3035'
      ? maxY - minY
      : ((maxY - minY) * Math.PI) / 180 * 6_371_000;
  const resolutionM = Math.round(ySpanM / Math.max(rows - 1, 1));

  onProgress?.({ loaded: 1, total: 1 });

  return {
    bbox: [minX, minY, maxX, maxY],
    cols,
    rows,
    resolutionM,
    data,
    crs,
  };
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
