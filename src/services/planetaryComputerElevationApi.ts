/**
 * Microsoft Planetary Computer STAC client for Copernicus DEM GLO-30.
 *
 * Selected via VITE_ELEVATION_SOURCE=planetary-computer. Requires no API key —
 * PC exposes the DEM tiles as public COGs in Azure Blob storage; each asset
 * href is signed on demand via /api/sas/v1/sign.
 *
 * Strategy:
 *   1. STAC-search the collection by bbox to enumerate the 1°×1° tiles
 *      overlapping the flight envelope.
 *   2. Sign each asset href to get a short-lived read URL.
 *   3. Open each COG via geotiff.js `fromUrl` (byte-range requests, so we
 *      only fetch the pixels inside our bbox) and blit its window into a
 *      single output grid at ~30 m resolution.
 */

import { fromUrl } from 'geotiff';
import type { ElevationGrid } from '../domain/elevation';
import { ElevationApiError, type ProgressCallback } from './elevationApi';
import { bufferBbox } from '../domain/bbox';

const PC_BASE = 'https://planetarycomputer.microsoft.com/api';
const COLLECTION_ID = 'cop-dem-glo-30';
const SERVICE_NAME = 'Microsoft Planetary Computer';

// COP DEM GLO-30 native pixel size in longitude at low/mid latitudes (equator = 30 m).
const NATIVE_RES_DEG = 1 / 3600;
// Hard cap on total output samples to keep memory + sampling costs bounded.
const MAX_SAMPLES = 2_000_000;

interface PcStacFeature {
  bbox?: [number, number, number, number];
  assets?: { data?: { href?: string } };
}

interface PcSignedHref {
  href: string;
  'msft:expiry'?: string;
}

export async function fetchElevationGridFromPlanetaryComputer(
  bbox: [number, number, number, number],
  onProgress?: ProgressCallback,
): Promise<ElevationGrid> {
  const [minLon, minLat, maxLon, maxLat] = bufferBbox(bbox, 0.1);

  const features = await stacSearch(minLon, minLat, maxLon, maxLat);
  if (features.length === 0) {
    throw new ElevationApiError(
      'No Copernicus DEM tiles cover this flight area.',
      404,
      SERVICE_NAME,
    );
  }

  // Choose an output resolution: start at native ~30 m and coarsen (×2 per step)
  // until the total sample count fits in the budget.
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

  onProgress?.({ loaded: 0, total: features.length });

  for (let idx = 0; idx < features.length; idx++) {
    const href = features[idx].assets?.data?.href;
    if (!href) {
      onProgress?.({ loaded: idx + 1, total: features.length });
      continue;
    }
    const signedHref = await signHref(href);
    await blitTileIntoGrid(signedHref, {
      data,
      cols,
      rows,
      minLon,
      minLat,
      stepDeg,
    });
    onProgress?.({ loaded: idx + 1, total: features.length });
  }

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

async function stacSearch(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
): Promise<PcStacFeature[]> {
  const url =
    `${PC_BASE}/stac/v1/search?bbox=${minLon},${minLat},${maxLon},${maxLat}` +
    `&collections=${COLLECTION_ID}&limit=100`;
  if (import.meta.env.DEV) console.log('[elevationApi:pc] GET', url);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ElevationApiError(
      `Planetary Computer STAC search returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      res.status,
      SERVICE_NAME,
    );
  }
  const json = (await res.json()) as { features?: PcStacFeature[] };
  return json.features ?? [];
}

async function signHref(href: string): Promise<string> {
  const url = `${PC_BASE}/sas/v1/sign?href=${encodeURIComponent(href)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new ElevationApiError(
      `Planetary Computer sign request returned HTTP ${res.status}`,
      res.status,
      SERVICE_NAME,
    );
  }
  const json = (await res.json()) as PcSignedHref;
  if (!json.href) {
    throw new ElevationApiError(
      'Planetary Computer sign response did not include a signed href.',
      undefined,
      SERVICE_NAME,
    );
  }
  return json.href;
}

interface GridWindow {
  data: Float32Array;
  cols: number;
  rows: number;
  minLon: number;
  minLat: number;
  stepDeg: number;
}

async function blitTileIntoGrid(url: string, out: GridWindow): Promise<void> {
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const iWidth = image.getWidth();
  const iHeight = image.getHeight();
  const [iMinX, iMinY, iMaxX, iMaxY] = image.getBoundingBox();
  const pxLon = (iMaxX - iMinX) / iWidth;
  const pxLat = (iMaxY - iMinY) / iHeight;

  // Range of output columns/rows that fall inside this tile's geo bounds.
  const cStart = Math.max(0, Math.ceil((iMinX - out.minLon) / out.stepDeg));
  const cEnd = Math.min(
    out.cols - 1,
    Math.floor((iMaxX - out.minLon) / out.stepDeg),
  );
  const rStart = Math.max(0, Math.ceil((iMinY - out.minLat) / out.stepDeg));
  const rEnd = Math.min(
    out.rows - 1,
    Math.floor((iMaxY - out.minLat) / out.stepDeg),
  );
  if (cStart > cEnd || rStart > rEnd) return;

  // COG pixel window that just covers those output cells (inclusive on both sides).
  const outLon0 = out.minLon + cStart * out.stepDeg;
  const outLon1 = out.minLon + cEnd * out.stepDeg;
  const outLat0 = out.minLat + rStart * out.stepDeg;
  const outLat1 = out.minLat + rEnd * out.stepDeg;

  const cogX0 = clamp(Math.floor((outLon0 - iMinX) / pxLon), 0, iWidth);
  const cogX1 = clamp(Math.ceil((outLon1 - iMinX) / pxLon) + 1, 0, iWidth);
  const cogY0 = clamp(Math.floor((iMaxY - outLat1) / pxLat), 0, iHeight);
  const cogY1 = clamp(Math.ceil((iMaxY - outLat0) / pxLat) + 1, 0, iHeight);
  const winW = cogX1 - cogX0;
  const winH = cogY1 - cogY0;
  if (winW <= 0 || winH <= 0) return;

  const rasters = await image.readRasters({
    window: [cogX0, cogY0, cogX1, cogY1],
  });
  const band = rasters[0] as Float32Array | Int16Array;

  for (let r = rStart; r <= rEnd; r++) {
    const outLat = out.minLat + r * out.stepDeg;
    // COGs are stored north-first; convert lat → row-from-top.
    const cogRow = Math.round((iMaxY - outLat) / pxLat) - cogY0;
    if (cogRow < 0 || cogRow >= winH) continue;
    for (let c = cStart; c <= cEnd; c++) {
      const outLon = out.minLon + c * out.stepDeg;
      const cogCol = Math.round((outLon - iMinX) / pxLon) - cogX0;
      if (cogCol < 0 || cogCol >= winW) continue;
      const raw = band[cogRow * winW + cogCol];
      out.data[r * out.cols + c] = raw < -9000 ? 0 : raw;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
