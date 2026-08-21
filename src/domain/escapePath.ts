/**
 * Escape path computation (Phase 3, FR-3-1).
 *
 * From a source position (lat/lon/altitude) to a target Landing Zone,
 * compute the straight-line trajectory, the terrain profile along it,
 * the glide plane, and safety metrics (arrival height, min margin).
 *
 * The algorithm is intentionally cheap enough to run on the main thread
 * for a single (source → LZ) query — no worker required.
 */

import type { ElevationGrid } from './elevation';
import { sampleElevation } from './elevation';
import type { LandingZone } from './landingZone';
import type { LocalCheckParams } from './localCheck';
import { classifyArrival, type LocalStatus } from './arrival';
import { haversineDistanceM } from './units';

/** @deprecated Use `LocalStatus` from `domain/arrival`. Kept as an alias so
 * existing `EscapePath['status']` consumers keep compiling. */
export type EscapePathStatus = LocalStatus;

export interface EscapePathWaypoint {
  lat: number;
  lon: number;
  distFromSourceM: number;
}

/**
 * How the displayed path was obtained. Distinguishing these matters for
 * safety: a straight line drawn because the direct glide was *verified*
 * clear and one drawn because routing found nothing safe look identical on
 * screen, and the pilot must not read the second as the first.
 */
export type EscapeRouting =
  /** Terrain-aware routing disabled — plain straight line, no claim made. */
  | 'off'
  /** Direct glide verified clear of terrain + ground clearance. */
  | 'straight-clear'
  /** A detour was found and verified clear. */
  | 'routed'
  /** Routing found no terrain-safe path; the straight line is shown for
   * reference only and may well cut through terrain. */
  | 'no-safe-path';

export interface EscapePathProfilePoint {
  distFromSourceM: number;
  terrainM: number | null;
  glideAltM: number;
}

export interface EscapePath {
  sourceFixIndex: number;
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  lzId: string;
  lzLat: number;
  lzLon: number;
  lzElevM: number;
  waypoints: EscapePathWaypoint[];
  profile: EscapePathProfilePoint[];
  totalDistanceM: number;
  arrivalHeightM: number;
  minMarginM: number;
  status: LocalStatus;
  routing: EscapeRouting;
}

export interface EscapePathInputs {
  sourceFixIndex: number;
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  lz: LandingZone;
  grid: ElevationGrid;
  params: LocalCheckParams;
  /** Sampling step along the straight line, in meters. Default 100 m. */
  sampleStepM?: number;
  /**
   * Extra distance past the LZ to keep sampling terrain, for the profile
   * chart's "context past target" band. Glide-plane samples continue
   * mathematically (glider would already have landed), but the visual
   * intent is a terrain trace beyond the LZ. Default 0.
   */
  extraDistanceM?: number;
  /**
   * Optional terrain-aware route (list of lat/lon waypoints from source to
   * LZ). When supplied, the profile is sampled along the polyline and
   * `totalDistanceM` becomes the sum of segment lengths, so arrival height
   * reflects the actual routed distance. First waypoint MUST match source
   * and last MUST match LZ.
   */
  route?: Array<{ latitude: number; longitude: number }>;
  /** How `route` was obtained; defaults to `'off'`. See `EscapeRouting`. */
  routing?: EscapeRouting;
}

/**
 * Compute the straight-line escape path from source to LZ.
 *
 * The path terrain profile is sampled every `sampleStepM` metres (default
 * 100 m). Points with `NaN` terrain propagate as `null` in the profile and
 * are conservatively excluded from the min-margin computation.
 */
export function computeEscapePath(inputs: EscapePathInputs): EscapePath {
  const startedAt = performance.now();

  const {
    sourceFixIndex,
    sourceLat,
    sourceLon,
    sourceAltM,
    lz,
    grid,
    params,
    sampleStepM = 100,
    extraDistanceM = 0,
    route,
    routing = 'off',
  } = inputs;

  const lzElevM =
    lz.elevationM ??
    (() => {
      const v = sampleElevation(grid, lz.latitude, lz.longitude);
      return isNaN(v) ? 0 : v;
    })();

  // Build the polyline the profile is sampled along. Without a route this
  // is the straight source→LZ segment (two vertices); with routing it can
  // be an arbitrary any-angle polyline emitted by Theta*.
  const rawPolyline: Array<{ lat: number; lon: number }> =
    route && route.length >= 2
      ? route.map((p) => ({ lat: p.latitude, lon: p.longitude }))
      : [
          { lat: sourceLat, lon: sourceLon },
          { lat: lz.latitude, lon: lz.longitude },
        ];

  // Precompute cumulative distance at each polyline vertex.
  const cumulativeM: number[] = [0];
  for (let i = 1; i < rawPolyline.length; i++) {
    const seg = haversineDistanceM(
      rawPolyline[i - 1].lat,
      rawPolyline[i - 1].lon,
      rawPolyline[i].lat,
      rawPolyline[i].lon,
    );
    cumulativeM.push(cumulativeM[i - 1] + seg);
  }
  const totalDistanceM = cumulativeM[cumulativeM.length - 1];

  const arrivalHeightM =
    sourceAltM - lzElevM - totalDistanceM / params.workingLD;

  const waypoints: EscapePathWaypoint[] = rawPolyline.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    distFromSourceM: cumulativeM[i],
  }));

  // Sample along the polyline at `sampleStepM` intervals. `posAt(distM)`
  // linearly interpolates within whichever segment the sample falls in;
  // beyond the last vertex we extrapolate along the last segment's bearing,
  // preserving the pre-routing behaviour of the "context past target" band.
  const lastSegStart = rawPolyline[rawPolyline.length - 2];
  const lastSegEnd = rawPolyline[rawPolyline.length - 1];
  const lastSegLenM = totalDistanceM - cumulativeM[cumulativeM.length - 2];

  const posAt = (distM: number): { lat: number; lon: number } => {
    if (distM <= 0) return { lat: rawPolyline[0].lat, lon: rawPolyline[0].lon };
    if (distM >= totalDistanceM) {
      const overshoot = distM - totalDistanceM;
      const t = lastSegLenM > 0 ? overshoot / lastSegLenM : 0;
      return {
        lat: lastSegEnd.lat + t * (lastSegEnd.lat - lastSegStart.lat),
        lon: lastSegEnd.lon + t * (lastSegEnd.lon - lastSegStart.lon),
      };
    }
    // Binary-ish linear scan for the enclosing segment. Polylines are
    // short (≤ a few dozen waypoints), so scanning is cheaper than a heap.
    for (let i = 1; i < rawPolyline.length; i++) {
      if (distM <= cumulativeM[i]) {
        const segLen = cumulativeM[i] - cumulativeM[i - 1];
        const t = segLen > 0 ? (distM - cumulativeM[i - 1]) / segLen : 0;
        return {
          lat:
            rawPolyline[i - 1].lat +
            t * (rawPolyline[i].lat - rawPolyline[i - 1].lat),
          lon:
            rawPolyline[i - 1].lon +
            t * (rawPolyline[i].lon - rawPolyline[i - 1].lon),
        };
      }
    }
    return { lat: lastSegEnd.lat, lon: lastSegEnd.lon };
  };

  const steps = Math.max(1, Math.ceil(totalDistanceM / sampleStepM));
  const extraSteps =
    extraDistanceM > 0 ? Math.ceil(extraDistanceM / sampleStepM) : 0;
  const profile: EscapePathProfilePoint[] = [];
  let minMarginM = Infinity;

  const totalSteps = steps + extraSteps;
  for (let s = 0; s <= totalSteps; s++) {
    const distFromSourceM = (s / steps) * totalDistanceM;
    const { lat, lon } = posAt(distFromSourceM);
    const terrain = sampleElevation(grid, lat, lon);
    const terrainM = isNaN(terrain) ? null : terrain;
    const glideAltM = sourceAltM - distFromSourceM / params.workingLD;

    profile.push({ distFromSourceM, terrainM, glideAltM });

    // Min glide-vs-terrain gap along the source→LZ portion only (samples
    // beyond the LZ are context and never gate the classification).
    if (distFromSourceM <= totalDistanceM && terrainM !== null) {
      const margin = glideAltM - terrainM;
      if (margin < minMarginM) minMarginM = margin;
    }
  }

  if (minMarginM === Infinity) minMarginM = 0;

  // Status uses the shared arrival bands (see `arrival.ts`): pure
  // arrival-vs-buffer geometry, no terrain gating. The terrain profile is
  // still visualised in the mini-chart, so pilots can spot a glide plane
  // that clips the ground.
  const status = classifyArrival(arrivalHeightM, params.arrivalHeightM);

  const path = {
    sourceFixIndex,
    sourceLat,
    sourceLon,
    sourceAltM,
    lzId: lz.id,
    lzLat: lz.latitude,
    lzLon: lz.longitude,
    lzElevM,
    waypoints,
    profile,
    totalDistanceM,
    arrivalHeightM,
    minMarginM,
    status,
    routing,
  };

  if (import.meta.env.DEV) {
    console.log(
      `[computeEscapePath] ${(performance.now() - startedAt).toFixed(2)} ms`, path
    );
  }

  return path;
}
