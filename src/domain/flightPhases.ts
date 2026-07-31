/**
 * Flight-phase detection: initial climb (tow/winch), motor, landing circuit,
 * and cruise.
 *
 * Returns a parallel array of FlightPhase labels aligned 1:1 with `fixes`.
 */

import type { Fix } from './flight';
import type { DerivedPoint } from './flight';
import { haversineDistanceM, pickAltitude } from './units';

export type FlightPhase = 'initial-climb' | 'motor' | 'cruise' | 'landing-circuit';

const INITIAL_CLIMB_VARIO_THRESHOLD_MS = 1.5; // m/s
const INITIAL_CLIMB_MAX_GAIN_M = 500;

const LANDING_CIRCUIT_MAX_AGL_M = 300;
const LANDING_CIRCUIT_MAX_RADIUS_M = 3000;

/**
 * Compute a FlightPhase tag for every fix.
 *
 * @param fixes       sorted fixes
 * @param derived     per-fix derived metrics (same order)
 * @param motorFlags  per-fix motor-running flags from enlDetection
 * @param altSrc      altitude source
 */
export function computeFlightPhases(
  fixes: Fix[],
  derived: DerivedPoint[],
  motorFlags: boolean[],
  altSrc: 'pressure' | 'gnss',
): FlightPhase[] {
  const n = fixes.length;
  const phases: FlightPhase[] = new Array(n).fill('cruise');

  if (n === 0) return phases;

  // 1. Mark initial-climb from the first fix forward.
  //
  // Strategy: include fix[0] only if fix[1] already shows positive climbing
  // vario above the threshold, then keep marking while vario stays above
  // threshold and cumulative gain < MAX_GAIN. Stop at the first fix that
  // drops below threshold (no grace period — tow/winch is continuous).
  const takeoffAlt = pickAltitude(fixes[0], altSrc) ?? 0;

  let scanIdx = 0;
  // Check whether the flight actually starts with a climb.
  if (n > 1 && (derived[1].verticalSpeedMs ?? 0) >= INITIAL_CLIMB_VARIO_THRESHOLD_MS) {
    phases[0] = 'initial-climb'; // include the seed fix
    scanIdx = 1;
  }

  while (scanIdx < n) {
    const vario = derived[scanIdx].verticalSpeedMs ?? 0;
    const gain = (pickAltitude(fixes[scanIdx], altSrc) ?? takeoffAlt) - takeoffAlt;
    if (vario >= INITIAL_CLIMB_VARIO_THRESHOLD_MS && gain < INITIAL_CLIMB_MAX_GAIN_M) {
      phases[scanIdx] = 'initial-climb';
      scanIdx++;
    } else {
      break;
    }
  }

  // 2. Mark motor phases (overrides cruise, but not initial-climb).
  for (let i = 0; i < n; i++) {
    if (motorFlags[i] && phases[i] === 'cruise') {
      phases[i] = 'motor';
    }
  }

  // 3. Mark landing-circuit backwards from the last fix.
  const lastLat = fixes[n - 1].latitude;
  const lastLon = fixes[n - 1].longitude;

  for (let i = n - 1; i >= 0; i--) {
    if (phases[i] !== 'cruise') break; // stop at motor/initial-climb

    const agl = derived[i].aglM;
    const belowAgl = agl !== null && agl < LANDING_CIRCUIT_MAX_AGL_M;
    const distM = haversineDistanceM(fixes[i].latitude, fixes[i].longitude, lastLat, lastLon);

    if (belowAgl && distM < LANDING_CIRCUIT_MAX_RADIUS_M) {
      phases[i] = 'landing-circuit';
    } else {
      break;
    }
  }

  return phases;
}
