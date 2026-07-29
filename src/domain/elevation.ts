/**
 * Terrain elevation grid model and bilinear sampling.
 *
 * The grid is a regular mesh stored row-major (row 0 = minY / south).
 * Populated by the elevation API service; consumed by glide checks and AGL
 * computation in derivedMetrics.
 *
 * The grid may live in one of two coordinate reference systems:
 *   - `EPSG:4326` (WGS84 lat/lon) — used by SRTM, COP30, COP90, etc.
 *   - `EPSG:3035` (ETRS89-LAEA Europe, meters) — used by EU_DTM.
 * `sampleElevation` accepts lat/lon inputs and internally projects into
 * the grid's CRS when needed, so callers never need to think about it.
 */

export type ElevationCrs = 'EPSG:4326' | 'EPSG:3035';

export interface ElevationGrid {
  /** Grid bounds in the grid's native CRS: [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  cols: number; // number of sample columns (X axis)
  rows: number; // number of sample rows (Y axis)
  resolutionM: number; // approximate cell size in meters (for display)
  data: Float32Array; // length = cols × rows; row-major
  crs: ElevationCrs;
}

/**
 * Bilinear interpolation of terrain elevation at WGS84 (lat, lon).
 * Returns NaN when the point lies outside the grid bbox.
 */
export function sampleElevation(
  grid: ElevationGrid,
  lat: number,
  lon: number,
): number {
  let x: number;
  let y: number;
  if (grid.crs === 'EPSG:3035') {
    const p = projectWgs84ToEpsg3035(lat, lon);
    x = p.x;
    y = p.y;
  } else {
    x = lon;
    y = lat;
  }

  const [minX, minY, maxX, maxY] = grid.bbox;

  if (x < minX || x > maxX || y < minY || y > maxY) {
    return NaN;
  }

  const fx = ((x - minX) / (maxX - minX)) * (grid.cols - 1);
  const fy = ((y - minY) / (maxY - minY)) * (grid.rows - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, grid.cols - 1);
  const y1 = Math.min(y0 + 1, grid.rows - 1);

  const tx = fx - x0;
  const ty = fy - y0;

  const v00 = grid.data[y0 * grid.cols + x0];
  const v10 = grid.data[y0 * grid.cols + x1];
  const v01 = grid.data[y1 * grid.cols + x0];
  const v11 = grid.data[y1 * grid.cols + x1];

  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  );
}

// ---------------------------------------------------------------------------
// WGS84 → EPSG:3035 forward projection
// ---------------------------------------------------------------------------

// EPSG:3035 = ETRS89 / LAEA Europe on the GRS80 ellipsoid.
// Formulas follow Snyder, "Map Projections – A Working Manual" (USGS
// Prof. Paper 1395, 1987), pp. 187–190, ellipsoidal Lambert Azimuthal
// Equal-Area case.
const LAEA_A = 6378137.0; // GRS80 semi-major axis (m)
const LAEA_E2 = 0.00669438002290; // GRS80 first eccentricity squared
const LAEA_E = Math.sqrt(LAEA_E2);
const LAEA_LAT0 = (52 * Math.PI) / 180; // latitude of natural origin
const LAEA_LON0 = (10 * Math.PI) / 180; // longitude of natural origin
const LAEA_FE = 4321000; // false easting (m)
const LAEA_FN = 3210000; // false northing (m)

function laeaQ(sinPhi: number): number {
  return (
    (1 - LAEA_E2) *
    (sinPhi / (1 - LAEA_E2 * sinPhi * sinPhi) -
      (1 / (2 * LAEA_E)) *
        Math.log((1 - LAEA_E * sinPhi) / (1 + LAEA_E * sinPhi)))
  );
}

const LAEA_Q_P = laeaQ(1); // q at the pole (sin 90° = 1)
const LAEA_Q_0 = laeaQ(Math.sin(LAEA_LAT0));
const LAEA_R_Q = LAEA_A * Math.sqrt(LAEA_Q_P / 2); // authalic sphere radius
const LAEA_BETA_0 = Math.asin(LAEA_Q_0 / LAEA_Q_P); // authalic latitude of origin
const LAEA_SIN_BETA_0 = Math.sin(LAEA_BETA_0);
const LAEA_COS_BETA_0 = Math.cos(LAEA_BETA_0);
const LAEA_D =
  (LAEA_A * Math.cos(LAEA_LAT0)) /
  (Math.sqrt(1 - LAEA_E2 * Math.sin(LAEA_LAT0) ** 2) *
    LAEA_R_Q *
    LAEA_COS_BETA_0);

export function projectWgs84ToEpsg3035(
  lat: number,
  lon: number,
): { x: number; y: number } {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const q = laeaQ(sinPhi);
  const beta = Math.asin(q / LAEA_Q_P);
  const sinBeta = Math.sin(beta);
  const cosBeta = Math.cos(beta);
  const dLon = lam - LAEA_LON0;
  const cosDLon = Math.cos(dLon);
  const B =
    LAEA_R_Q *
    Math.sqrt(
      2 /
        (1 +
          LAEA_SIN_BETA_0 * sinBeta +
          LAEA_COS_BETA_0 * cosBeta * cosDLon),
    );
  const x = LAEA_FE + B * LAEA_D * cosBeta * Math.sin(dLon);
  const y =
    LAEA_FN +
    (B / LAEA_D) *
      (LAEA_COS_BETA_0 * sinBeta - LAEA_SIN_BETA_0 * cosBeta * cosDLon);
  return { x, y };
}

/**
 * Build the regular grid sample points (lat/lon pairs) for the given bbox
 * at a target spacing, clamped to maxSamples total.
 *
 * Returns an array of { lat, lon } in row-major order (row 0 = minLat)
 * alongside the resolved cols/rows dimensions.
 */
export function buildGridPoints(
  bbox: [number, number, number, number],
  targetResolutionM: number,
  maxSamples: number,
): { points: { lat: number; lon: number }[]; cols: number; rows: number; resolutionM: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const latSpanKm = haversineKm(minLat, minLon, maxLat, minLon);
  const lonSpanKm = haversineKm(minLat, minLon, minLat, maxLon);

  let rows = Math.max(2, Math.ceil((latSpanKm * 1000) / targetResolutionM) + 1);
  let cols = Math.max(2, Math.ceil((lonSpanKm * 1000) / targetResolutionM) + 1);

  // Downgrade resolution if over budget.
  if (rows * cols > maxSamples) {
    const scale = Math.sqrt(maxSamples / (rows * cols));
    rows = Math.max(2, Math.floor(rows * scale));
    cols = Math.max(2, Math.floor(cols * scale));
  }

  const actualLatStep = (maxLat - minLat) / (rows - 1);
  const actualLonStep = (maxLon - minLon) / (cols - 1);
  const actualResM = Math.max(
    (latSpanKm * 1000) / (rows - 1),
    (lonSpanKm * 1000) / (cols - 1),
  );

  const points: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        lat: minLat + r * actualLatStep,
        lon: minLon + c * actualLonStep,
      });
    }
  }

  return { points, cols, rows, resolutionM: Math.round(actualResM) };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
