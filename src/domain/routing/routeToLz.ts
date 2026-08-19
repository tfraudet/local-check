/**
 * Terrain-aware routing from a source (lat/lon/altitude) to a Landing Zone.
 *
 * Wraps the pure Theta* algorithm with:
 *   - A local search grid built around the source→LZ bbox (auto-resolution).
 *   - A line-of-sight predicate backed by `glideClearsTerrain`, so the glide
 *     plane must stay above terrain + groundClearanceM at every sample.
 *   - Straight-line short-circuit: if the direct segment already clears
 *     terrain, we skip the search entirely (routing can never improve on it,
 *     since routing only *lengthens* the path — which costs altitude).
 *
 * When routing succeeds, the returned path is the sequence of lat/lon
 * waypoints (start + intermediate + LZ) and `distanceM` is the sum of the
 * great-circle segment lengths. `arrivalAltitudeM` is `sourceAltM - distanceM
 * / workingLD` (LZ elevation is subtracted by the caller if needed).
 */

import type { ElevationGrid } from '../elevation';
import { glideClearsTerrain } from '../glide';
import { haversineDistanceM } from '../units';
import { thetaStar, type GridPoint } from './thetaStar';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface RouteToLzInput {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  targetLat: number;
  targetLon: number;
  workingLD: number;
  groundClearanceM: number;
  grid: ElevationGrid;
  /** Search-grid cell size in meters. Coarser = faster; finer = tighter
   * paths. Defaults to `max(2 × grid.resolutionM, 200)`. */
  cellSizeM?: number;
  /** Hard cap on total nodes in the search grid. When exceeded, we back off
   * to a coarser cell size until we fit. */
  maxNodes?: number;
}

export interface RouteToLzResult {
  path: LatLon[];
  distanceM: number;
  arrivalAltitudeM: number;
  /** True when the returned path is the straight source→LZ segment (no
   * detour needed). Callers can skip drawing overlays when this holds. */
  isStraightLine: boolean;
}

const DEFAULT_MAX_NODES = 30_000;

/**
 * Compute a terrain-aware path from source to LZ. Returns `null` when no
 * feasible path exists within the search bounds — callers typically fall
 * back to the straight-line arrival height (which will be visibly negative).
 */
export function routeToLz(input: RouteToLzInput): RouteToLzResult | null {
  const {
    sourceLat,
    sourceLon,
    sourceAltM,
    targetLat,
    targetLon,
    workingLD,
    groundClearanceM,
    grid,
    maxNodes = DEFAULT_MAX_NODES,
  } = input;

  const straightDistM = haversineDistanceM(
    sourceLat,
    sourceLon,
    targetLat,
    targetLon,
  );

  // Short-circuit: if the direct segment already clears terrain, routing
  // can only make things worse (longer path = lower arrival). Skip the
  // search entirely.
  if (
    glideClearsTerrain({
      fromLat: sourceLat,
      fromLon: sourceLon,
      fromAltM: sourceAltM,
      toLat: targetLat,
      toLon: targetLon,
      distanceM: straightDistM,
      workingLD,
      grid,
      groundClearanceM,
      stepM: 200,
    })
  ) {
    return {
      path: [
        { latitude: sourceLat, longitude: sourceLon },
        { latitude: targetLat, longitude: targetLon },
      ],
      distanceM: straightDistM,
      arrivalAltitudeM: sourceAltM - straightDistM / workingLD,
      isStraightLine: true,
    };
  }

  // Build a local search grid around the source→LZ bbox, inflated to allow
  // detours up to ~2× the straight-line distance.
  const inflateM = Math.max(2_000, straightDistM * 0.5);
  const centerLat = (sourceLat + targetLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const inflateLat = inflateM / 111_000;
  const inflateLon = inflateM / (111_000 * cosLat);

  const minLat = Math.min(sourceLat, targetLat) - inflateLat;
  const maxLat = Math.max(sourceLat, targetLat) + inflateLat;
  const minLon = Math.min(sourceLon, targetLon) - inflateLon;
  const maxLon = Math.max(sourceLon, targetLon) + inflateLon;

  // Grid resolution: auto = max(2× elevation.resolutionM, 200 m). Backs off
  // to keep total node count under `maxNodes`.
  let cellSizeM = input.cellSizeM ?? Math.max(2 * grid.resolutionM, 200);
  let rows = 0;
  let cols = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const latStep = cellSizeM / 111_000;
    const lonStep = cellSizeM / (111_000 * cosLat);
    rows = Math.max(2, Math.ceil((maxLat - minLat) / latStep) + 1);
    cols = Math.max(2, Math.ceil((maxLon - minLon) / lonStep) + 1);
    if (rows * cols <= maxNodes) break;
    cellSizeM *= 1.5;
  }
  if (rows * cols > maxNodes) return null;

  const latStep = (maxLat - minLat) / (rows - 1);
  const lonStep = (maxLon - minLon) / (cols - 1);

  const gridPointToLatLon = (p: GridPoint): LatLon => ({
    latitude: minLat + p.r * latStep,
    longitude: minLon + p.c * lonStep,
  });

  const latLonToGridPoint = (lat: number, lon: number): GridPoint => ({
    r: Math.max(0, Math.min(rows - 1, Math.round((lat - minLat) / latStep))),
    c: Math.max(0, Math.min(cols - 1, Math.round((lon - minLon) / lonStep))),
  });

  const start = latLonToGridPoint(sourceLat, sourceLon);
  const goal = latLonToGridPoint(targetLat, targetLon);

  const cost = (a: GridPoint, b: GridPoint): number => {
    const A = gridPointToLatLon(a);
    const B = gridPointToLatLon(b);
    return haversineDistanceM(A.latitude, A.longitude, B.latitude, B.longitude);
  };

  const heuristic = (p: GridPoint): number => {
    const P = gridPointToLatLon(p);
    return haversineDistanceM(
      P.latitude,
      P.longitude,
      targetLat,
      targetLon,
    );
  };

  const lineOfSight = (a: GridPoint, b: GridPoint, gAtA: number): boolean => {
    const A = gridPointToLatLon(a);
    const B = gridPointToLatLon(b);
    const segDistM = haversineDistanceM(
      A.latitude,
      A.longitude,
      B.latitude,
      B.longitude,
    );
    if (segDistM === 0) return true;
    // At node A, the pilot has already flown `gAtA` metres — remaining
    // altitude is `sourceAltM - gAtA/workingLD`. glideClearsTerrain then
    // enforces the glide plane over the segment.
    const fromAltM = sourceAltM - gAtA / workingLD;
    return glideClearsTerrain({
      fromLat: A.latitude,
      fromLon: A.longitude,
      fromAltM,
      toLat: B.latitude,
      toLon: B.longitude,
      distanceM: segDistM,
      workingLD,
      grid,
      groundClearanceM,
      stepM: Math.max(100, cellSizeM),
    });
  };

  const path = thetaStar({
    rows,
    cols,
    start,
    goal,
    lineOfSight,
    cost,
    heuristic,
  });

  if (!path) return null;

  // Convert grid path back to lat/lon and force the exact source and target
  // endpoints (the grid rounding may land on a neighbour cell).
  const waypoints: LatLon[] = path.map(gridPointToLatLon);
  waypoints[0] = { latitude: sourceLat, longitude: sourceLon };
  waypoints[waypoints.length - 1] = {
    latitude: targetLat,
    longitude: targetLon,
  };

  // Sum segment lengths.
  let distanceM = 0;
  for (let i = 1; i < waypoints.length; i++) {
    distanceM += haversineDistanceM(
      waypoints[i - 1].latitude,
      waypoints[i - 1].longitude,
      waypoints[i].latitude,
      waypoints[i].longitude,
    );
  }

  return {
    path: waypoints,
    distanceM,
    arrivalAltitudeM: sourceAltM - distanceM / workingLD,
    isStraightLine: waypoints.length === 2,
  };
}
