/**
 * Shared arrival-height geometry and status classification.
 *
 * Every feature that answers "can I still reach a landing zone?" — the
 * local-check algorithm, the escape path, and the on-map arrival-height
 * labels — must agree on two things:
 *
 *   1. how the arrival height above an LZ's own ground is computed, and
 *   2. how that height maps onto the green / yellow / red bands.
 *
 * Both live here so the rule is defined exactly once.
 *
 * Status convention (pure arrival-vs-buffer geometry, no terrain gating —
 * a glide clipping the ground is visualised by the profile chart, it does
 * not change the colour):
 *
 *   in-local          ← heightAboveGroundM > params.arrivalHeightM
 *   in-local-marginal ← 0 < heightAboveGroundM ≤ params.arrivalHeightM
 *   out-of-local      ← heightAboveGroundM ≤ 0
 *
 * Framework-agnostic: safe to import from workers and domain code.
 */

import type { LandingZone } from './landingZone';
import { haversineDistanceM } from './units';

export type LocalStatus = 'in-local' | 'in-local-marginal' | 'out-of-local';

/**
 * Altitude at which a straight glide at `workingLD` arrives over
 * (`toLat`, `toLon`). Pure geometry — ignores terrain and safety margins.
 */
export function glideArrivalAltitudeM(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  toLat: number,
  toLon: number,
  workingLD: number,
): number {
  const distM = haversineDistanceM(fromLat, fromLon, toLat, toLon);
  return fromAltM - distM / workingLD;
}

/** Height above the LZ's own ground on arrival. LZs without a known
 * elevation are treated as sea level, matching the legacy behaviour.
 *
 * When `routedDistanceM` is supplied (from terrain-aware routing), it
 * replaces the straight-line distance in the glide arithmetic — a longer
 * routed path costs altitude at rate `1/workingLD`. */
export function arrivalHeightAboveGroundM(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  lz: LandingZone,
  workingLD: number,
  routedDistanceM?: number,
): number {
  const distM =
    routedDistanceM ??
    haversineDistanceM(fromLat, fromLon, lz.latitude, lz.longitude);
  const arrivalAltM = fromAltM - distM / workingLD;
  return arrivalAltM - (lz.elevationM ?? 0);
}

/** Map an arrival height above ground onto the three-band status. */
export function classifyArrival(
  heightAboveGroundM: number,
  arrivalBufferM: number,
): LocalStatus {
  if (heightAboveGroundM <= 0) return 'out-of-local';
  if (heightAboveGroundM <= arrivalBufferM) return 'in-local-marginal';
  return 'in-local';
}

export interface BestLandingZone {
  lz: LandingZone;
  /** Arrival height above the LZ's ground; may be negative when nothing is
   * reachable (then this is "the LZ closest to being reachable"). */
  heightAboveGroundM: number;
  /** Distance actually flown to reach the LZ: straight-line by default,
   * routed metres when terrain-aware routing was applied. */
  distanceM: number;
}

/**
 * Pick the LZ with the highest arrival height above its own ground.
 *
 * Used by the local-check sampler, the escape-path target picker, and the
 * profile panel so all three always point at the same LZ — the one the
 * pilot sees as the greenest (or least-red) arrival-height label.
 *
 * When `distanceFn` is supplied (terrain-aware routing) it overrides the
 * straight-line distance for a given LZ. Returning `null` from the callback
 * means "unroutable" — that LZ is still considered, but with straight-line
 * distance, so it can still be picked as the least-red option when nothing
 * is truly reachable.
 */
export function pickBestLandingZone(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  landingZones: readonly LandingZone[],
  workingLD: number,
  distanceFn?: (lz: LandingZone) => number | null,
): BestLandingZone | null {
  let best: BestLandingZone | null = null;
  for (const lz of landingZones) {
    const routedDistanceM = distanceFn ? distanceFn(lz) ?? undefined : undefined;
    const heightAboveGroundM = arrivalHeightAboveGroundM(
      fromLat,
      fromLon,
      fromAltM,
      lz,
      workingLD,
      routedDistanceM,
    );
    const distanceM =
      routedDistanceM ??
      haversineDistanceM(fromLat, fromLon, lz.latitude, lz.longitude);
    if (!best || heightAboveGroundM > best.heightAboveGroundM) {
      best = { lz, heightAboveGroundM, distanceM };
    }
  }
  return best;
}
