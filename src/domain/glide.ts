/**
 * Glide-plane reachability primitives used by the local-check algorithm.
 *
 * All functions are pure and framework-agnostic.
 */

import { haversineDistanceKm } from './units';
import { sampleElevation } from './elevation';
import type { ElevationGrid } from './elevation';
import type { LandingZone } from './landingZone';

export interface GlideCheckParams {
  workingLD: number;
  arrivalHeightM: number;
  groundClearanceM: number;
}

export interface GlideResult {
  /** True when the LZ is reachable under the given constraints. */
  reachable: boolean;
  /** altitudeM − requiredAltitudeM. Positive = in local, negative = out. */
  marginM: number;
  /** Haversine distance to the LZ in meters. */
  distanceM: number;
}

/**
 * Check whether an LZ is reachable from a given position.
 *
 * Steps:
 * 1. Compute minimum required altitude at the current position.
 * 2. Verify the glide plane does not dip below terrain + groundClearance
 *    along the straight-line path (sampled every ~200 m).
 */
export function checkGlideToLz(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  lz: LandingZone,
  params: GlideCheckParams,
  elevationGrid: ElevationGrid,
): GlideResult {
  const lzElevM = lz.elevationM ?? sampleElevation(elevationGrid, lz.latitude, lz.longitude);
  const lzElev = isNaN(lzElevM) ? 0 : lzElevM;

  const distanceM = haversineDistanceKm(fromLat, fromLon, lz.latitude, lz.longitude) * 1000;
  const requiredAltM = lzElev + params.arrivalHeightM + distanceM / params.workingLD;
  const marginM = fromAltM - requiredAltM;

  if (marginM < 0) {
    return { reachable: false, marginM, distanceM };
  }

  // Terrain clearance check along straight-line path.
  const terrainClear = checkTerrainClearance(
    fromLat,
    fromLon,
    fromAltM,
    lz.latitude,
    lz.longitude,
    distanceM,
    params.workingLD,
    params.groundClearanceM,
    elevationGrid,
  );

  return { reachable: terrainClear, marginM: terrainClear ? marginM : -1, distanceM };
}

/** Sample terrain along the straight line every ~200 m. */
function checkTerrainClearance(
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
  const STEP_M = 200;
  const steps = Math.max(1, Math.ceil(distanceM / STEP_M));

  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const lat = fromLat + t * (toLat - fromLat);
    const lon = fromLon + t * (toLon - fromLon);

    const terrain = sampleElevation(grid, lat, lon);
    if (isNaN(terrain)) continue; // no terrain data — skip

    const distSoFarM = t * distanceM;
    const glidePlaneAlt = fromAltM - distSoFarM / workingLD;

    if (glidePlaneAlt < terrain + groundClearanceM) {
      return false;
    }
  }

  return true;
}

/**
 * Maximum horizontal distance reachable from a given altitude under LD.
 * Used to pre-filter candidate LZs.
 */
export function maxGlideDistanceM(
  altitudeM: number,
  lzElevM: number,
  arrivalHeightM: number,
  workingLD: number,
): number {
  return Math.max(0, (altitudeM - lzElevM - arrivalHeightM) * workingLD);
}
