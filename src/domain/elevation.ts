/**
 * Terrain elevation grid model and bilinear sampling.
 *
 * The grid is a regular lon/lat mesh stored row-major (row 0 = minLat).
 * Populated by the elevation API service; consumed by glide checks and AGL
 * computation in derivedMetrics.
 */

export interface ElevationGrid {
  /** [minLon, minLat, maxLon, maxLat] in decimal degrees. */
  bbox: [number, number, number, number];
  cols: number; // number of sample columns (longitude axis)
  rows: number; // number of sample rows (latitude axis)
  resolutionM: number; // approximate cell size in meters (for display)
  data: Float32Array; // length = cols × rows; row-major
}

/**
 * Bilinear interpolation of terrain elevation at (lat, lon).
 * Returns NaN when the point lies outside the grid bbox.
 */
export function sampleElevation(
  grid: ElevationGrid,
  lat: number,
  lon: number,
): number {
  const [minLon, minLat, maxLon, maxLat] = grid.bbox;

  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
    return NaN;
  }

  const fx = ((lon - minLon) / (maxLon - minLon)) * (grid.cols - 1);
  const fy = ((lat - minLat) / (maxLat - minLat)) * (grid.rows - 1);

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
