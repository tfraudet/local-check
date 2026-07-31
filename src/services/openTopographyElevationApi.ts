/**
 * OpenTopography Global DEM HTTP client.
 *
 * Makes a single GeoTIFF request for the flight's bounding box and parses
 * it in-browser with geotiff.js. Selected via VITE_ELEVATION_SOURCE=opentopography
 * (the default). Requires VITE_OPENTOPOGRAPHY_API_KEY.
 *
 * Supports several global/regional DEMs via VITE_ELEVATION_DEMTYPE. EU_DTM
 * (Copernicus EU-DEM v1.1, ~25 m) is EPSG:3035; the SRTM/COP alternatives
 * are ~30 m and native WGS84.
 */

import { fromArrayBuffer } from 'geotiff';
import type { ElevationGrid, ElevationCrs } from '../domain/elevation';
import { bufferBbox, ElevationApiError, type ProgressCallback } from './elevationApi';

const OT_API_KEY = import.meta.env.VITE_OPENTOPOGRAPHY_API_KEY as string | undefined;

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

const SERVICE_NAME = 'OpenTopography';

export async function fetchElevationGridFromOpenTopography(
  bbox: [number, number, number, number],
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  if (!OT_API_KEY) {
    throw new ElevationApiError(
      'No OpenTopography API key found. Set VITE_OPENTOPOGRAPHY_API_KEY in your .env file.',
      undefined,
      SERVICE_NAME,
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
  if (import.meta.env.DEV) console.log('[elevationApi:ot] GET', url);
  const startedAt = performance.now();
  const response = await fetch(url);

  if (import.meta.env.DEV) {
    console.log(`[elevationApi:ot] ← HTTP ${response.status} · ${(performance.now() - startedAt).toFixed(0)}ms`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ElevationApiError(
      `OpenTopography API returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      response.status,
      SERVICE_NAME,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('image/tiff') && !contentType.includes('application/octet-stream')) {
    const body = await response.text().catch(() => '');
    throw new ElevationApiError(
      `Unexpected content-type "${contentType}" from OpenTopography${body ? `: ${body.slice(0, 200)}` : ''}`,
      undefined,
      SERVICE_NAME,
    );
  }

  const buffer = await response.arrayBuffer();

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const cols = image.getWidth();
  const rows = image.getHeight();

  const [minX, minY, maxX, maxY] = image.getBoundingBox();

  const rasters = await image.readRasters();
  const band = rasters[0] as Float32Array | Int16Array;

  const data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const srcRow = rows - 1 - r;
    for (let c = 0; c < cols; c++) {
      const raw = band[srcRow * cols + c];
      data[r * cols + c] = raw < -9000 ? 0 : raw;
    }
  }

  const crs = crsFor(DEMTYPE);
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
