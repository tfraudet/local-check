/**
 * Reachable-zone computation (Phase 3, FR-3-2).
 *
 * Given a source (lat/lon/altitude), a working L/D, and terrain, compute
 * the set of ground points reachable in a glide. Each cell is evaluated as:
 *
 *   glideAltAtCell = sourceAltM − distM / workingLD
 *   marginM        = glideAltAtCell − terrainM − groundClearanceM
 *   reachable      = marginM ≥ 0 AND straight-line terrain clearance passes
 *
 * The result carries the raw mask plus a `MultiPolygon` built as one
 * rectangular ring per reachable cell — MapLibre's fill layer renders it
 * as a translucent overlay. This is coarser than marching squares but is
 * robust against saddle-point ambiguities and holes in the reachable set.
 *
 * Designed to run inside a Web Worker (no DOM/React imports).
 */

import type { ElevationGrid } from './elevation';
import { sampleElevation } from './elevation';
import type { LocalCheckParams } from './localCheck';
import { haversineDistanceKm } from './units';

export type ReachableZoneGridSizeM = 90 | 180 | 360 | 720;

export const REACHABLE_ZONE_GRID_SIZES: ReachableZoneGridSizeM[] = [
  90, 180, 360, 720,
];

export const REACHABLE_ZONE_CELL_CAP = 100_000;
export const REACHABLE_ZONE_MAX_EXTENT_KM = 30;
export const REACHABLE_ZONE_MIN_EXTENT_KM = 5;

export interface ReachableZoneParams {
  gridSizeM: ReachableZoneGridSizeM;
  extentKm: number;
}

export const DEFAULT_REACHABLE_ZONE_PARAMS: ReachableZoneParams = {
  gridSizeM: 360,
  extentKm: 20,
};

export interface ReachableZoneResult {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  /** Effective params after any degradation to fit the cell cap. */
  params: ReachableZoneParams;
  /** Params the caller originally requested. */
  requestedParams: ReachableZoneParams;
  /** [minLon, minLat, maxLon, maxLat]. */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  reachableMask: Uint8Array;
  marginM: Float32Array;
  /**
   * One rectangular polygon ring per reachable cell, expressed as an array
   * of [lon, lat] pairs. MapLibre renders the union with a fill layer.
   */
  cellPolygons: Array<Array<[number, number]>>;
  degraded: boolean;
  computedAt: number;
}

export interface ReachableZoneInputs {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  grid: ElevationGrid;
  params: LocalCheckParams;
  zoneParams: ReachableZoneParams;
}

/**
 * Effective grid parameters after enforcing the cell cap. If the requested
 * grid would produce more than REACHABLE_ZONE_CELL_CAP cells, bump the grid
 * size to the next step; if still over, shrink the extent by 5 km until it
 * fits. The `degraded` flag surfaces the change to the UI.
 */
export function resolveEffectiveParams(
  requested: ReachableZoneParams,
): { effective: ReachableZoneParams; degraded: boolean } {
  const sizes = REACHABLE_ZONE_GRID_SIZES;
  let sizeIdx = sizes.indexOf(requested.gridSizeM);
  if (sizeIdx < 0) sizeIdx = sizes.indexOf(DEFAULT_REACHABLE_ZONE_PARAMS.gridSizeM);
  let extentKm = Math.min(
    REACHABLE_ZONE_MAX_EXTENT_KM,
    Math.max(REACHABLE_ZONE_MIN_EXTENT_KM, requested.extentKm),
  );

  const cellsFor = (sM: number, eKm: number) => {
    const n = Math.ceil((2 * eKm * 1000) / sM) + 1;
    return n * n;
  };

  let degraded = false;
  while (cellsFor(sizes[sizeIdx], extentKm) > REACHABLE_ZONE_CELL_CAP) {
    if (sizeIdx < sizes.length - 1) {
      sizeIdx += 1;
      degraded = true;
      continue;
    }
    if (extentKm > REACHABLE_ZONE_MIN_EXTENT_KM) {
      extentKm = Math.max(REACHABLE_ZONE_MIN_EXTENT_KM, extentKm - 5);
      degraded = true;
      continue;
    }
    break;
  }

  return {
    effective: { gridSizeM: sizes[sizeIdx], extentKm },
    degraded:
      degraded ||
      sizes[sizeIdx] !== requested.gridSizeM ||
      extentKm !== requested.extentKm,
  };
}

/**
 * Main entry point. Computes the reachable-zone grid, extracts the polygon
 * of every reachable cell, and reports the effective parameters used.
 */
export function computeReachableZone(
  inputs: ReachableZoneInputs,
): ReachableZoneResult {
  const { sourceLat, sourceLon, sourceAltM, grid, params, zoneParams } = inputs;

  const { effective, degraded } = resolveEffectiveParams(zoneParams);
  const { gridSizeM, extentKm } = effective;

  // Convert half-width in km to degrees. cos(lat) squishes longitudes.
  const dLat = extentKm / 111;
  const dLon = extentKm / (111 * Math.cos((sourceLat * Math.PI) / 180));

  const minLat = sourceLat - dLat;
  const maxLat = sourceLat + dLat;
  const minLon = sourceLon - dLon;
  const maxLon = sourceLon + dLon;

  const cols = Math.ceil((2 * extentKm * 1000) / gridSizeM) + 1;
  const rows = cols;

  const reachableMask = new Uint8Array(cols * rows);
  const marginM = new Float32Array(cols * rows);
  marginM.fill(-Infinity);

  const latStep = (maxLat - minLat) / (rows - 1);
  const lonStep = (maxLon - minLon) / (cols - 1);

  for (let r = 0; r < rows; r++) {
    const lat = minLat + r * latStep;
    for (let c = 0; c < cols; c++) {
      const lon = minLon + c * lonStep;
      const idx = r * cols + c;

      const distM =
        haversineDistanceKm(sourceLat, sourceLon, lat, lon) * 1000;
      const glideAltAtCellM = sourceAltM - distM / params.workingLD;

      const terrain = sampleElevation(grid, lat, lon);
      if (isNaN(terrain)) continue;

      const margin = glideAltAtCellM - terrain - params.groundClearanceM;
      marginM[idx] = margin;

      if (margin < 0) continue;

      if (
        !checkTerrainClearanceAlongRay(
          sourceLat,
          sourceLon,
          sourceAltM,
          lat,
          lon,
          distM,
          params.workingLD,
          params.groundClearanceM,
          grid,
        )
      ) {
        continue;
      }

      reachableMask[idx] = 1;
    }
  }

  const cellPolygons = buildCellPolygons(
    reachableMask,
    cols,
    rows,
    minLon,
    minLat,
    lonStep,
    latStep,
  );

  return {
    sourceLat,
    sourceLon,
    sourceAltM,
    params: effective,
    requestedParams: zoneParams,
    bbox: [minLon, minLat, maxLon, maxLat],
    cols,
    rows,
    reachableMask,
    marginM,
    cellPolygons,
    degraded,
    computedAt: Date.now(),
  };
}

/**
 * Sparse straight-line terrain-clearance check between two points. Samples
 * ~10 evenly spaced points along the ray and verifies the glide plane sits
 * above `terrain + groundClearanceM` at each. Uses ~10 samples rather than
 * the 200m step used by Phase 2's checkGlideToLz because we run this per
 * grid cell — accuracy vs speed tradeoff.
 */
function checkTerrainClearanceAlongRay(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  toLat: number,
  toLon: number,
  distanceM: number,
  workingLD: number,
  groundClearanceM: number,
  grid: ElevationGrid,
): boolean {
  const STEPS = 10;
  for (let s = 1; s < STEPS; s++) {
    const t = s / STEPS;
    const lat = fromLat + t * (toLat - fromLat);
    const lon = fromLon + t * (toLon - fromLon);
    const terrain = sampleElevation(grid, lat, lon);
    if (isNaN(terrain)) continue;
    const distSoFarM = t * distanceM;
    const glidePlaneAlt = fromAltM - distSoFarM / workingLD;
    if (glidePlaneAlt < terrain + groundClearanceM) return false;
  }
  return true;
}

/**
 * Emit one rectangular ring per reachable cell. Each ring is a closed
 * quad centred on the sample point, half a cell wide.
 */
export function buildCellPolygons(
  mask: Uint8Array,
  cols: number,
  rows: number,
  minLon: number,
  minLat: number,
  lonStep: number,
  latStep: number,
): Array<Array<[number, number]>> {
  const halfLon = lonStep / 2;
  const halfLat = latStep / 2;
  const polys: Array<Array<[number, number]>> = [];
  for (let r = 0; r < rows; r++) {
    const lat = minLat + r * latStep;
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      const lon = minLon + c * lonStep;
      polys.push([
        [lon - halfLon, lat - halfLat],
        [lon + halfLon, lat - halfLat],
        [lon + halfLon, lat + halfLat],
        [lon - halfLon, lat + halfLat],
        [lon - halfLon, lat - halfLat],
      ]);
    }
  }
  return polys;
}
