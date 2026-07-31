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
 * "Reachable" means the glider would arrive **above LZ ground** AND the
 * glide plane clears terrain along the straight-line path — i.e. the LZ
 * qualifies for at least the "marginal" (yellow) band.
 *
 * The `marginM` field is a signed measure vs the safety arrival buffer:
 * `arrival_height_above_ground − arrivalHeightM param`. Positive = above
 * the safety buffer (green band); zero or negative = below the buffer
 * (yellow if reachable, red otherwise). Callers use it together with
 * `reachable` to pick a three-way status.
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
  const arrivalAltAtLzM = fromAltM - distanceM / params.workingLD;
  const arrivalHeightAboveGroundM = arrivalAltAtLzM - lzElev;
  const marginM = arrivalHeightAboveGroundM - params.arrivalHeightM;

  // Would arrive at or below LZ ground — cannot land.
  if (arrivalHeightAboveGroundM <= 0) {
    return { reachable: false, marginM, distanceM };
  }

  // Terrain-collision check along straight-line path. The
  // `groundClearanceM` safety buffer is intentionally NOT applied to the
  // status classification: only an actual crash (glide plane below
  // terrain) makes an LZ unreachable. Ground clearance stays in
  // GlideCheckParams for potential UI/informational use but has no
  // bearing on green/yellow/red.
  const terrainClear = checkTerrainClearance(
    fromLat,
    fromLon,
    fromAltM,
    lz.latitude,
    lz.longitude,
    distanceM,
    params.workingLD,
    0,
    elevationGrid,
  );

  return { reachable: terrainClear, marginM, distanceM };
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

/**
 * Altitude at which the glide plane arrives at (toLat, toLon) from
 * (fromLat, fromLon, fromAltM) at the given working L/D. Ignores terrain
 * and any arrival-height/ground-clearance safety margins — it is a pure
 * geometric projection, useful for the "arrival height over each LZ"
 * label (Phase 3, FR-3-3).
 */
export function reachableAltitudeAt(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  toLat: number,
  toLon: number,
  workingLD: number,
): number {
  const distM = haversineDistanceKm(fromLat, fromLon, toLat, toLon) * 1000;
  return fromAltM - distM / workingLD;
}
