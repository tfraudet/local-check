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
import { haversineDistanceKm } from './units';

export type EscapePathStatus = 'in-local' | 'in-local-marginal' | 'out-of-local';

export interface EscapePathWaypoint {
  lat: number;
  lon: number;
  distFromSourceM: number;
}

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
  status: EscapePathStatus;
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
}

/**
 * Compute the straight-line escape path from source to LZ.
 *
 * The path terrain profile is sampled every `sampleStepM` metres (default
 * 100 m). Points with `NaN` terrain propagate as `null` in the profile and
 * are conservatively excluded from the min-margin computation.
 */
export function computeEscapePath(inputs: EscapePathInputs): EscapePath {
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
  } = inputs;

  const lzElevM =
    lz.elevationM ?? (() => {
      const v = sampleElevation(grid, lz.latitude, lz.longitude);
      return isNaN(v) ? 0 : v;
    })();

  const totalDistanceM =
    haversineDistanceKm(sourceLat, sourceLon, lz.latitude, lz.longitude) * 1000;

  const arrivalHeightM = sourceAltM - lzElevM - totalDistanceM / params.workingLD;

  const waypoints: EscapePathWaypoint[] = [
    { lat: sourceLat, lon: sourceLon, distFromSourceM: 0 },
    { lat: lz.latitude, lon: lz.longitude, distFromSourceM: totalDistanceM },
  ];

  const steps = Math.max(1, Math.ceil(totalDistanceM / sampleStepM));
  const extraSteps =
    extraDistanceM > 0 ? Math.ceil(extraDistanceM / sampleStepM) : 0;
  const profile: EscapePathProfilePoint[] = [];
  let minMarginM = Infinity;

  const totalSteps = steps + extraSteps;
  for (let s = 0; s <= totalSteps; s++) {
    // `t` parameter along the source→LZ segment. Values > 1 sample past
    // the LZ in the same direction; we still store the profile point so
    // the chart can render the context band, but the terrain-clearance
    // min-margin only considers the in-line source→LZ portion (t ≤ 1).
    const t = (s / steps);
    const lat = sourceLat + t * (lz.latitude - sourceLat);
    const lon = sourceLon + t * (lz.longitude - sourceLon);
    const distFromSourceM = t * totalDistanceM;
    const terrain = sampleElevation(grid, lat, lon);
    const terrainM = isNaN(terrain) ? null : terrain;
    const glideAltM = sourceAltM - distFromSourceM / params.workingLD;

    profile.push({ distFromSourceM, terrainM, glideAltM });

    if (t <= 1 && terrainM !== null) {
      const margin = glideAltM - terrainM - params.groundClearanceM;
      if (margin < minMarginM) minMarginM = margin;
    }
  }

  if (minMarginM === Infinity) minMarginM = 0;

  // Status convention (matches localCheck + arrival-height labels):
  //   red    ← arrivalHeightM ≤ 0            (arrival at/below LZ ground)
  //          OR minMarginM < 0                (glide plane clips terrain)
  //   yellow ← 0 < arrivalHeightM ≤ arrivalHeightM param
  //   green  ← arrivalHeightM > arrivalHeightM param
  let status: EscapePathStatus;
  if (arrivalHeightM <= 0 || minMarginM < 0) {
    status = 'out-of-local';
  } else if (arrivalHeightM <= params.arrivalHeightM) {
    status = 'in-local-marginal';
  } else {
    status = 'in-local';
  }

  return {
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
  };
}
