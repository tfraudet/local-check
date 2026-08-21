/**
 * Reachable-zone computation (Phase 3, FR-3-2).
 *
 * Given a source (lat/lon/altitude), a working L/D, and terrain, compute
 * the set of ground points reachable in a glide, sampled on a circular
 * grid centred on the pilot with diameter `diameterKm`. Each cell is
 * evaluated as:
 *
 *   glideAltAtCell = sourceAltM − distM / workingLD
 *   marginM        = glideAltAtCell − terrainM
 *   reachable      = marginM ≥ arrivalHeightM AND the glide to the cell
 *                    clears terrain + groundClearanceM all the way
 *
 * `groundClearanceM` gates the *en-route* clearance only, not the arrival
 * margin — arriving at `arrivalHeightM` above the field is the landing
 * criterion, matching how landing zones are classified.
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
import { glideClearsTerrain, terrainStepFor } from './glide';
import { MinHeap } from './routing/minHeap';
import { haversineDistanceM } from './units';

export type ReachableZoneGridSizeM = 90 | 180 | 360 | 720;

export const REACHABLE_ZONE_GRID_SIZES: ReachableZoneGridSizeM[] = [
  90, 180, 360, 720,
];

export const REACHABLE_ZONE_CELL_CAP = 100_000;
export const REACHABLE_ZONE_MAX_DIAMETER_KM = 60;
export const REACHABLE_ZONE_MIN_DIAMETER_KM = 10;


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
  /** When true, cells whose straight-line glide clips terrain are retried
   * with terrain-aware routing (Theta*). A cell is reachable if *any*
   * feasible any-angle path exists and its routed arrival height still
   * exceeds `params.arrivalHeightM`. */
  terrainAwareRouting?: boolean;
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
  const {
    sourceLat,
    sourceLon,
    sourceAltM,
    grid,
    params,
    zoneParams,
    terrainAwareRouting = false,
  } = inputs;

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

  const terrainStepM = terrainStepFor(grid);

  // Terrain-aware routing: one Dijkstra outward from the pilot on the
  // reachable-zone grid gives us the shortest routed distance to every
  // cell in a single pass. Cells left at Infinity are unreachable via
  // any feasible glide-clearing path. Falls back to straight-line for
  // the classic behaviour when the toggle is off.
  const routedDistM = terrainAwareRouting
    ? computeRoutedDistances({
        sourceLat,
        sourceLon,
        sourceAltM,
        minLat,
        minLon,
        latStep,
        lonStep,
        cols,
        rows,
        radiusM,
        grid,
        workingLD: params.workingLD,
        groundClearanceM: params.groundClearanceM,
        terrainStepM,
      })
    : null;

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

      // Direct ray, sampled at DEM resolution and subject to the same
      // ground-clearance buffer as the routed pass below. A fixed sample
      // count (this used to take 10, whatever the range) spaces samples
      // ~900 m apart on a 9 km ray, so a whole ridge fits between two of
      // them and terrain-blocked cells were painted as reachable.
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
          groundClearanceM: params.groundClearanceM,
          stepM: terrainStepM,
        })
      ) {
        // Straight-line blocked. Legacy behaviour: skip. With terrain-aware
        // routing on, use the routed distance from the Dijkstra pass — a
        // finite value means Dijkstra found a feasible detour to this cell.
        if (!routedDistM) continue;
        const d = routedDistM[idx];
        if (!Number.isFinite(d)) continue;
        const routedArrivalM = sourceAltM - d / params.workingLD - terrain;
        if (routedArrivalM < params.arrivalHeightM) continue;
        marginM[idx] = routedArrivalM;
        reachableMask[idx] = 1;
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
 * Single-source Dijkstra outward from the pilot on the reachable-zone
 * grid. Returns a `Float32Array` of routed distances (metres) from the
 * source to every grid cell, filled with `Infinity` for unreachable
 * cells. Cells reachable only after a glide clip are excluded because
 * the LOS check between adjacent cells uses `glideClearsTerrain` with
 * the accumulated altitude at the current node.
 *
 * This replaces the naive "one Theta* per cell" approach: reachability
 * is a single-source many-targets problem, and Dijkstra solves it in
 * one pass at O(N log N).
 */
interface RoutedDistancesInput {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  minLat: number;
  minLon: number;
  latStep: number;
  lonStep: number;
  cols: number;
  rows: number;
  radiusM: number;
  grid: ElevationGrid;
  workingLD: number;
  groundClearanceM: number;
  terrainStepM: number;
}

const DIJKSTRA_NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

function computeRoutedDistances(input: RoutedDistancesInput): Float32Array {
  const {
    sourceLat,
    sourceLon,
    sourceAltM,
    minLat,
    minLon,
    latStep,
    lonStep,
    cols,
    rows,
    radiusM,
    grid,
    workingLD,
    groundClearanceM,
    terrainStepM,
  } = input;

  const size = cols * rows;
  const gCost = new Float32Array(size).fill(Infinity);
  const settled = new Uint8Array(size);

  const srcR = Math.max(
    0,
    Math.min(rows - 1, Math.round((sourceLat - minLat) / latStep)),
  );
  const srcC = Math.max(
    0,
    Math.min(cols - 1, Math.round((sourceLon - minLon) / lonStep)),
  );
  const srcIdx = srcR * cols + srcC;
  // Seed with the distance from the true position to the snapped cell centre
  // (up to ~0.7 cell). Starting at 0 would hand the routed branch a free
  // head start the straight-line branch — measured from the real source —
  // never gets, so a detour could report a *better* arrival than the direct
  // glide, which is physically impossible.
  const srcOffsetM = haversineDistanceM(
    sourceLat,
    sourceLon,
    minLat + srcR * latStep,
    minLon + srcC * lonStep,
  );
  gCost[srcIdx] = srcOffsetM;

  const open = new MinHeap();
  open.push(srcIdx, srcOffsetM);

  while (open.size() > 0) {
    const cur = open.pop()!;
    if (settled[cur]) continue;
    settled[cur] = 1;

    const r = (cur / cols) | 0;
    const c = cur - r * cols;
    const lat = minLat + r * latStep;
    const lon = minLon + c * lonStep;
    const gAtCur = gCost[cur];
    const altAtCur = sourceAltM - gAtCur / workingLD;

    for (const [dr, dc] of DIJKSTRA_NEIGHBOR_OFFSETS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (settled[nIdx]) continue;

      const nLat = minLat + nr * latStep;
      const nLon = minLon + nc * lonStep;

      // Circle footprint: don't expand into cells outside the disc; the
      // whole overlay is clipped there anyway.
      if (haversineDistanceM(sourceLat, sourceLon, nLat, nLon) > radiusM)
        continue;

      const segDistM = haversineDistanceM(lat, lon, nLat, nLon);
      const newG = gAtCur + segDistM;
      if (newG >= gCost[nIdx]) continue;

      // Glide plane from `altAtCur` at (lat, lon) must clear terrain
      // (+ ground clearance) along the segment to the neighbour, sampled at
      // DEM resolution.
      if (
        !glideClearsTerrain({
          fromLat: lat,
          fromLon: lon,
          fromAltM: altAtCur,
          toLat: nLat,
          toLon: nLon,
          distanceM: segDistM,
          workingLD,
          grid,
          groundClearanceM,
          stepM: terrainStepM,
        })
      ) {
        continue;
      }

      gCost[nIdx] = newG;
      open.push(nIdx, newG);
    }
  }

  return gCost;
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
