/**
 * Reachable-zone computation (Phase 3, FR-3-2).
 *
 * Given a source (lat/lon/altitude), a working L/D, and terrain, compute
 * the set of ground points reachable in a glide, sampled on a circular
 * grid centred on the pilot with diameter `diameterKm`. Each cell is
 * evaluated as:
 *
 *   glideAltAtCell = sourceAltM − distM / workingLD
 *   marginM        = glideAltAtCell − terrainM − groundClearanceM
 *   reachable      = marginM ≥ arrivalHeightM AND straight-line terrain
 *                    clearance passes
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
import { glideClearsTerrain } from './glide';
import { haversineDistanceM } from './units';

export type ReachableZoneGridSizeM = 90 | 180 | 360 | 720;

export const REACHABLE_ZONE_GRID_SIZES: ReachableZoneGridSizeM[] = [
  90, 180, 360, 720,
];

export const REACHABLE_ZONE_CELL_CAP = 100_000;
export const REACHABLE_ZONE_MAX_DIAMETER_KM = 60;
export const REACHABLE_ZONE_MIN_DIAMETER_KM = 10;

/** Samples taken along each source→cell ray for the terrain-clearance
 * check. Deliberately sparse: it runs once per grid cell. */
const RAY_CLEARANCE_SAMPLES = 10;

export interface ReachableZoneParams {
  gridSizeM: ReachableZoneGridSizeM;
  /** Diameter of the circular sampling grid, in km. */
  diameterKm: number;
}

export const DEFAULT_REACHABLE_ZONE_PARAMS: ReachableZoneParams = {
  gridSizeM: 360,
  diameterKm: 40,
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
 * size to the next step; if still over, shrink the diameter by 5 km until
 * it fits. The `degraded` flag surfaces the change to the UI.
 */
export function resolveEffectiveParams(requested: ReachableZoneParams): {
  effective: ReachableZoneParams;
  degraded: boolean;
} {
  const sizes = REACHABLE_ZONE_GRID_SIZES;
  let sizeIdx = sizes.indexOf(requested.gridSizeM);
  if (sizeIdx < 0)
    sizeIdx = sizes.indexOf(DEFAULT_REACHABLE_ZONE_PARAMS.gridSizeM);
  let diameterKm = Math.min(
    REACHABLE_ZONE_MAX_DIAMETER_KM,
    Math.max(REACHABLE_ZONE_MIN_DIAMETER_KM, requested.diameterKm),
  );

  const cellsFor = (sM: number, dKm: number) => {
    // dKm is the circle's diameter → bounding square has side dKm.
    const n = Math.ceil((dKm * 1000) / sM) + 1;
    return n * n;
  };

  let degraded = false;
  while (cellsFor(sizes[sizeIdx], diameterKm) > REACHABLE_ZONE_CELL_CAP) {
    if (sizeIdx < sizes.length - 1) {
      sizeIdx += 1;
      degraded = true;
      continue;
    }
    if (diameterKm > REACHABLE_ZONE_MIN_DIAMETER_KM) {
      diameterKm = Math.max(REACHABLE_ZONE_MIN_DIAMETER_KM, diameterKm - 5);
      degraded = true;
      continue;
    }
    break;
  }

  return {
    effective: { gridSizeM: sizes[sizeIdx], diameterKm },
    degraded:
      degraded ||
      sizes[sizeIdx] !== requested.gridSizeM ||
      diameterKm !== requested.diameterKm,
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
  const { gridSizeM, diameterKm } = effective;

  // The grid is still a square bounding box (for regular indexing); cells
  // outside the inscribed disc are skipped in the loop below.
  const radiusKm = diameterKm / 2;
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((sourceLat * Math.PI) / 180));

  const minLat = sourceLat - dLat;
  const maxLat = sourceLat + dLat;
  const minLon = sourceLon - dLon;
  const maxLon = sourceLon + dLon;

  const cols = Math.ceil((diameterKm * 1000) / gridSizeM) + 1;
  const rows = cols;
  const radiusM = radiusKm * 1000;

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

      const distM = haversineDistanceM(sourceLat, sourceLon, lat, lon);

      // Circular footprint: skip cells outside the disc of radius
      // `radiusM` centred on the pilot.
      if (distM > radiusM) continue;

      const glideAltAtCellM = sourceAltM - distM / params.workingLD;

      const terrain = sampleElevation(grid, lat, lon);
      if (isNaN(terrain)) continue;

      // A cell is reachable only if the glider arrives at least
      // `arrivalHeightM` above the terrain, matching the arrival-height
      // requirement used for landing zones.
      const margin = glideAltAtCellM - terrain;
      marginM[idx] = margin;

      if (margin < params.arrivalHeightM) continue;

      // Sparse ray check: ~10 samples rather than the accurate 200 m step,
      // because this runs once per grid cell (accuracy vs speed tradeoff).
      if (
        !glideClearsTerrain({
          fromLat: sourceLat,
          fromLon: sourceLon,
          fromAltM: sourceAltM,
          toLat: lat,
          toLon: lon,
          distanceM: distM,
          workingLD: params.workingLD,
          grid,
          steps: RAY_CLEARANCE_SAMPLES,
        })
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
