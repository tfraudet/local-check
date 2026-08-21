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
import { sampleElevation } from '../elevation';
import { glideClearsTerrain, terrainStepFor } from '../glide';
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
  /** LZ elevation in meters, when the caller knows it (published field
   * elevation). Used only to bound the search range; defaults to a DEM
   * sample at the target. */
  targetElevM?: number;
  /** Called with the reason whenever the function returns `null`. */
  onFailure?: (reason: RouteFailureReason) => void;
}

/** Why `routeToLz` gave up. Surfaced so callers can tell "the direct glide
 * is safe" apart from "we found nothing safe at all" — the two used to be
 * indistinguishable, both arriving as a plain straight line. */
export type RouteFailureReason =
  /** Even the straight line exceeds the altitude budget to the field. */
  | 'out-of-range'
  /** Search grid would not fit under `maxNodes` at any cell size. */
  | 'grid-too-large'
  /** Theta* exhausted the reachable graph without reaching the LZ. */
  | 'no-path'
  /** A path was found but the final polyline failed terrain validation. */
  | 'unsafe-polyline';

export interface RouteToLzResult {
  path: LatLon[];
  distanceM: number;
  arrivalAltitudeM: number;
  /** True when the returned path is the straight source→LZ segment (no
   * detour needed). Callers can skip drawing overlays when this holds. */
  isStraightLine: boolean;
}

const DEFAULT_MAX_NODES = 30_000;

/** Slack on the LZ elevation used to bound the search range, absorbing DEM
 * error so a viable detour is never pruned on a bad elevation sample. */
const RANGE_ELEV_TOLERANCE_M = 300;

/**
 * Does the glide plane clear terrain + buffer at a single waypoint?
 *
 * `glideClearsTerrain` samples a segment's *interior* only, so a crest
 * sitting exactly on a waypoint is invisible to it. Both the search's
 * line-of-sight predicate and the final polyline gate use this, so the two
 * agree on what a legal waypoint is — otherwise the search proposes paths
 * the gate then discards wholesale, and reachability flickers between
 * neighbouring replay frames.
 */
function vertexClears(
  grid: ElevationGrid,
  lat: number,
  lon: number,
  altAtVertexM: number,
  groundClearanceM: number,
): boolean {
  const terrain = sampleElevation(grid, lat, lon);
  return isNaN(terrain) || altAtVertexM >= terrain + groundClearanceM;
}

/**
 * Verify an entire polyline against the glide plane, at terrain resolution.
 *
 * Run on the *final* geometry — after endpoint snapping and vertex
 * insertion — because that is what gets drawn and flown. Theta*'s LOS
 * predicate validates candidate segments during the search, but each
 * segment's own endpoints are excluded from sampling, and the last hop to
 * the exact LZ is only created after the search ends.
 */
export function polylineClearsTerrain(
  waypoints: LatLon[],
  sourceAltM: number,
  workingLD: number,
  groundClearanceM: number,
  grid: ElevationGrid,
  stepM: number,
): boolean {
  let cumulativeM = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    const segM = haversineDistanceM(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
    if (segM > 0) {
      if (
        !glideClearsTerrain({
          fromLat: a.latitude,
          fromLon: a.longitude,
          fromAltM: sourceAltM - cumulativeM / workingLD,
          toLat: b.latitude,
          toLon: b.longitude,
          distanceM: segM,
          workingLD,
          grid,
          groundClearanceM,
          stepM,
        })
      ) {
        return false;
      }
      cumulativeM += segM;
    }
    // Intermediate vertices are the blind spot of the per-segment check.
    // The LZ itself is excluded on purpose: clearance over the touchdown
    // point is the arrival-height criterion's job.
    if (
      i < waypoints.length - 1 &&
      !vertexClears(
        grid,
        b.latitude,
        b.longitude,
        sourceAltM - cumulativeM / workingLD,
        groundClearanceM,
      )
    ) {
      return false;
    }
  }
  return true;
}

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

  const fail = (reason: RouteFailureReason): null => {
    input.onFailure?.(reason);
    return null;
  };

  const straightDistM = haversineDistanceM(
    sourceLat,
    sourceLon,
    targetLat,
    targetLon,
  );

  // Terrain sampling step for every clearance check below. Tied to the DEM
  // resolution, deliberately NOT to the search-grid cell size: a coarse
  // search grid only makes detours suboptimal, whereas coarse terrain
  // sampling makes them unsafe — an 800 m step walks straight over a
  // 200 m-wide ridge crest without ever seeing it.
  const terrainStepM = terrainStepFor(grid);

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
      stepM: terrainStepM,
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

  // Altitude budget: the glider must reach the LZ at or above field
  // elevation, so no acceptable path can be longer than this. Bounding the
  // search with it is what keeps a hopeless query (LZ simply out of reach
  // behind the ridge) from sweeping the whole grid — the common case during
  // replay, and the one that used to be answered with a bogus route.
  const targetElevM =
    input.targetElevM ??
    (() => {
      const v = sampleElevation(grid, targetLat, targetLon);
      return isNaN(v) ? 0 : v;
    })();
  const maxRangeM =
    (sourceAltM - (targetElevM - RANGE_ELEV_TOLERANCE_M)) * workingLD;
  if (maxRangeM < straightDistM) return fail('out-of-range');

  // Build a local search grid around the source→LZ bbox, inflated to allow
  // detours up to ~2× the straight-line distance.
  const inflateM = Math.max(2_000, straightDistM * 0.5);
  const centerLat = (sourceLat + targetLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const inflateLat = inflateM / 111_000;
  const inflateLon = inflateM / (111_000 * cosLat);

  const bboxMinLat = Math.min(sourceLat, targetLat) - inflateLat;
  const bboxMaxLat = Math.max(sourceLat, targetLat) + inflateLat;
  const bboxMinLon = Math.min(sourceLon, targetLon) - inflateLon;
  const bboxMaxLon = Math.max(sourceLon, targetLon) + inflateLon;

  // Grid resolution: auto = max(2× elevation.resolutionM, 200 m). Backs off
  // to keep total node count under `maxNodes`.
  //
  // The grid is anchored so the source falls *exactly* on a node: the
  // emitted path then starts at the true position instead of a cell centre
  // up to 0.7 × cellSize away — geometry the search never validated.
  let cellSizeM = input.cellSizeM ?? Math.max(2 * grid.resolutionM, 200);
  let rows = 0;
  let cols = 0;
  let latStep = 0;
  let lonStep = 0;
  let minLat = 0;
  let minLon = 0;
  let startRow = 0;
  let startCol = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    latStep = cellSizeM / 111_000;
    lonStep = cellSizeM / (111_000 * cosLat);
    startRow = Math.ceil((sourceLat - bboxMinLat) / latStep);
    startCol = Math.ceil((sourceLon - bboxMinLon) / lonStep);
    minLat = sourceLat - startRow * latStep;
    minLon = sourceLon - startCol * lonStep;
    rows = Math.max(
      2,
      startRow + Math.ceil((bboxMaxLat - sourceLat) / latStep) + 1,
    );
    cols = Math.max(
      2,
      startCol + Math.ceil((bboxMaxLon - sourceLon) / lonStep) + 1,
    );
    if (rows * cols <= maxNodes) break;
    cellSizeM *= 1.5;
  }
  if (rows * cols > maxNodes) return fail('grid-too-large');

  const gridPointToLatLon = (p: GridPoint): LatLon => ({
    latitude: minLat + p.r * latStep,
    longitude: minLon + p.c * lonStep,
  });

  const latLonToGridPoint = (lat: number, lon: number): GridPoint => ({
    r: Math.max(0, Math.min(rows - 1, Math.round((lat - minLat) / latStep))),
    c: Math.max(0, Math.min(cols - 1, Math.round((lon - minLon) / lonStep))),
  });

  const start: GridPoint = { r: startRow, c: startCol };
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
    // Destination vertex first: cheap, and it keeps the search from adopting
    // waypoints the final gate would reject (see `vertexClears`).
    if (
      !vertexClears(
        grid,
        B.latitude,
        B.longitude,
        sourceAltM - (gAtA + segDistM) / workingLD,
        groundClearanceM,
      )
    ) {
      return false;
    }
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
      stepM: terrainStepM,
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
    maxCost: maxRangeM,
  });

  if (!path) return fail('no-path');

  // Convert the grid path back to lat/lon. The start node *is* the source
  // (the grid is anchored on it), so only the tail needs fixing up: the
  // goal node is a cell centre up to 0.7 × cellSize from the real LZ, so
  // append the exact LZ as a final vertex rather than overwriting the last
  // validated one — moving it would silently invalidate the segment Theta*
  // approved.
  const waypoints: LatLon[] = path.map(gridPointToLatLon);
  waypoints[0] = { latitude: sourceLat, longitude: sourceLon };
  const goalNode = waypoints[waypoints.length - 1];
  const goalGapM = haversineDistanceM(
    goalNode.latitude,
    goalNode.longitude,
    targetLat,
    targetLon,
  );
  if (goalGapM < 1) {
    waypoints[waypoints.length - 1] = {
      latitude: targetLat,
      longitude: targetLon,
    };
  } else {
    waypoints.push({ latitude: targetLat, longitude: targetLon });
  }

  // Final gate: the polyline that gets drawn and flown must clear terrain
  // at DEM resolution, vertices included. Returning null here lets the
  // caller fall back to the straight-line profile, where the pilot sees the
  // terrain conflict on the chart instead of a "routed" path through rock.
  if (
    !polylineClearsTerrain(
      waypoints,
      sourceAltM,
      workingLD,
      groundClearanceM,
      grid,
      terrainStepM,
    )
  ) {
    return fail('unsafe-polyline');
  }

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
