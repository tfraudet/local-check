/**
 * AWS Open Data "Terrain Tiles" (Terrarium) elevation backend.
 *
 * Selected via VITE_ELEVATION_SOURCE=aws-terrain. Requires no API key.
 *
 * AWS Terrain Tiles are 256×256 PNG tiles on the standard Web Mercator XYZ
 * scheme, served from a CloudFront-fronted S3 bucket
 * (`s3.amazonaws.com/elevation-tiles-prod`). Elevation is encoded per pixel
 * in the R/G/B channels as
 *     height = (R * 256 + G + B / 256) - 32768   (meters, DTM)
 *
 * Underlying sources vary by region: EU-DEM v1.1 (~25 m) over Europe,
 * 3DEP (~10 m) over the USA, SRTM (~30 m) elsewhere within ±60° latitude.
 * See https://registry.opendata.aws/terrain-tiles/
 *
 * Strategy:
 *   1. Pick a zoom level whose native pixel size is at most our target
 *      output step (~30 m), given the flight's bounding box latitude.
 *   2. Enumerate the XYZ tiles overlapping the bbox at that zoom.
 *   3. Fetch tiles in parallel from the CDN, decode PNG → RGBA via
 *      createImageBitmap + OffscreenCanvas, and blit each tile's decoded
 *      elevations into the shared output grid (EPSG:4326, uniform lat/lon).
 *
 * Immutable tile URLs mean the browser HTTP cache handles subsequent
 * flights in the same area for free — no app-level cache needed.
 */

import type { ElevationGrid } from '../domain/elevation';
import { ElevationApiError, type ProgressCallback } from './elevationApi';
import { bufferBbox } from '../domain/bbox';

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SERVICE_NAME = 'AWS Terrain Tiles';
const TILE_SIZE = 256;
const MAX_ZOOM = 15;
// Output resolution budget, same as the Planetary Computer backend so the
// downstream grid has comparable memory/compute cost.
const NATIVE_RES_DEG = 1 / 3600;
const MAX_SAMPLES = 2_000_000;
// AWS Terrain data covers ~±85° (Web Mercator's practical limit) but the
// useful global DEM coverage is ±60°. Reject bboxes entirely outside that.
const MAX_LAT_ABS = 85;

export async function fetchElevationGridFromAwsTerrain(
  bbox: [number, number, number, number],
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  const [minLon, minLat, maxLon, maxLat] = bufferBbox(bbox, 0.1);

  if (Math.abs(minLat) > MAX_LAT_ABS || Math.abs(maxLat) > MAX_LAT_ABS) {
    throw new ElevationApiError(
      'AWS Terrain Tiles do not cover latitudes beyond ±85°.',
      undefined,
      SERVICE_NAME,
    );
  }

  // Output grid: uniform lat/lon step, coarsened until the sample count
  // fits within the budget.
  let stepDeg = NATIVE_RES_DEG;
  while (
    Math.ceil((maxLat - minLat) / stepDeg + 1) *
      Math.ceil((maxLon - minLon) / stepDeg + 1) >
    MAX_SAMPLES
  ) {
    stepDeg *= 2;
  }
  const rows = Math.max(2, Math.ceil((maxLat - minLat) / stepDeg) + 1);
  const cols = Math.max(2, Math.ceil((maxLon - minLon) / stepDeg) + 1);
  const outMaxLat = minLat + (rows - 1) * stepDeg;
  const outMaxLon = minLon + (cols - 1) * stepDeg;
  const data = new Float32Array(cols * rows);

  const midLat = (minLat + maxLat) / 2;
  const zoom = pickZoom(stepDeg, midLat);

  const txMin = Math.floor(lonToTileX(minLon, zoom));
  const txMax = Math.floor(lonToTileX(maxLon, zoom));
  // Web Mercator Y grows southward: north lat → smaller tileY.
  const tyMin = Math.floor(latToTileY(maxLat, zoom));
  const tyMax = Math.floor(latToTileY(minLat, zoom));

  if (import.meta.env.DEV) {
    const tileCount = (txMax - txMin + 1) * (tyMax - tyMin + 1);
    console.log(
      `[awsTerrain] zoom=${zoom}, tiles=${tileCount} (x:${txMin}..${txMax}, y:${tyMin}..${tyMax})`,
    );
  }

  const tileCoords: Array<[number, number]> = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tileCoords.push([tx, ty]);
    }
  }

  onProgress?.({ loaded: 0, total: tileCoords.length });

  let completed = 0;
  await Promise.all(
    tileCoords.map(async ([tx, ty]) => {
      const pixels = await loadTilePixels(zoom, tx, ty);
      blitTileIntoGrid(pixels, zoom, tx, ty, {
        data,
        cols,
        rows,
        minLon,
        minLat,
        stepDeg,
      });
      completed += 1;
      onProgress?.({ loaded: completed, total: tileCoords.length });
    }),
  );

  const resolutionM = Math.round(stepDeg * (Math.PI / 180) * 6_371_000);

  return {
    bbox: [minLon, minLat, outMaxLon, outMaxLat],
    cols,
    rows,
    resolutionM,
    data,
    crs: 'EPSG:4326',
  };
}

// --- Web Mercator XYZ helpers -----------------------------------------------

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * (1 << z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * (1 << z)
  );
}

function tileXToLon(x: number, z: number): number {
  return (x / (1 << z)) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Pick the coarsest zoom whose native pixel size at `midLat` is still at
 * most our output step. Coarser zooms are preferred because they mean
 * fewer tile downloads.
 */
function pickZoom(targetStepDeg: number, midLat: number): number {
  const targetMeters = targetStepDeg * (Math.PI / 180) * 6_371_000;
  const cosLat = Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6);
  // Ground meters per pixel at zoom z ≈ 40075016 * cos(lat) / (256 * 2^z).
  // Solve for the smallest z such that m/px ≤ targetMeters.
  const zNeeded = Math.log2(
    (40_075_016 * cosLat) / (TILE_SIZE * targetMeters),
  );
  return Math.max(0, Math.min(MAX_ZOOM, Math.ceil(zNeeded)));
}

// --- Tile decode + blit -----------------------------------------------------

// Session-scoped cache of already-decoded tile pixels, keyed by tile URL.
// Terrarium tiles are immutable content addressed by (z, x, y), so any
// repeat request within the session (React StrictMode double-effect,
// re-uploading the same flight, overlapping bboxes across flights) can
// skip both the network fetch and the PNG decode entirely.
const tilePixelCache = new Map<string, Uint8ClampedArray>();
// Deduplicate concurrent requests for the same tile: if a fetch is
// already in flight for a URL, subsequent callers await the same
// Promise instead of firing a second identical request.
const inFlightTileLoads = new Map<string, Promise<Uint8ClampedArray>>();

async function loadTilePixels(
  z: number,
  x: number,
  y: number,
): Promise<Uint8ClampedArray> {
  const url = TILE_URL(z, x, y);

  const cached = tilePixelCache.get(url);
  if (cached) return cached;

  const inFlight = inFlightTileLoads.get(url);
  if (inFlight) return inFlight;

  const promise = fetchAndDecodeTile(url, z, x, y)
    .then((pixels) => {
      tilePixelCache.set(url, pixels);
      return pixels;
    })
    .finally(() => {
      inFlightTileLoads.delete(url);
    });
  inFlightTileLoads.set(url, promise);
  return promise;
}

async function fetchAndDecodeTile(
  url: string,
  z: number,
  x: number,
  y: number,
): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ElevationApiError(
      `AWS Terrain tile ${z}/${x}/${y} returned HTTP ${res.status}`,
      res.status,
      SERVICE_NAME,
    );
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
        : Object.assign(document.createElement('canvas'), {
            width: TILE_SIZE,
            height: TILE_SIZE,
          });
    const ctx = (canvas as OffscreenCanvas | HTMLCanvasElement).getContext(
      '2d',
    ) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) {
      throw new ElevationApiError(
        'Failed to acquire 2D canvas context for tile decode.',
        undefined,
        SERVICE_NAME,
      );
    }
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  } finally {
    bitmap.close?.();
  }
}

interface GridWindow {
  data: Float32Array;
  cols: number;
  rows: number;
  minLon: number;
  minLat: number;
  stepDeg: number;
}

function blitTileIntoGrid(
  pixels: Uint8ClampedArray,
  z: number,
  tx: number,
  ty: number,
  out: GridWindow,
): void {
  const tileLon0 = tileXToLon(tx, z);
  const tileLon1 = tileXToLon(tx + 1, z);
  // Web Mercator Y increases southward.
  const tileLatNorth = tileYToLat(ty, z);
  const tileLatSouth = tileYToLat(ty + 1, z);

  const cStart = Math.max(0, Math.ceil((tileLon0 - out.minLon) / out.stepDeg));
  const cEnd = Math.min(
    out.cols - 1,
    Math.floor((tileLon1 - out.minLon) / out.stepDeg),
  );
  const rStart = Math.max(
    0,
    Math.ceil((tileLatSouth - out.minLat) / out.stepDeg),
  );
  const rEnd = Math.min(
    out.rows - 1,
    Math.floor((tileLatNorth - out.minLat) / out.stepDeg),
  );
  if (cStart > cEnd || rStart > rEnd) return;

  const twoZ = 1 << z;
  for (let r = rStart; r <= rEnd; r++) {
    const lat = out.minLat + r * out.stepDeg;
    const yFrac = latToTileY(lat, z) - ty;
    const py = clamp(Math.floor(yFrac * TILE_SIZE), 0, TILE_SIZE - 1);
    for (let c = cStart; c <= cEnd; c++) {
      const lon = out.minLon + c * out.stepDeg;
      const xFrac = ((lon + 180) / 360) * twoZ - tx;
      const px = clamp(Math.floor(xFrac * TILE_SIZE), 0, TILE_SIZE - 1);
      const idx = (py * TILE_SIZE + px) * 4;
      const R = pixels[idx];
      const G = pixels[idx + 1];
      const B = pixels[idx + 2];
      const elev = R * 256 + G + B / 256 - 32768;
      // Terrarium encodes ocean as ~0, missing data can appear at -32768.
      out.data[r * out.cols + c] = elev < -10000 ? 0 : elev;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
