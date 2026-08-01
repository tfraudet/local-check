/**
 * Flight-phase detection: initial climb (tow/winch), motor, cruise,
 * and final glide (sustained descent + low-altitude circuit into the LZ).
 *
 * Returns a parallel array of FlightPhase labels aligned 1:1 with `fixes`.
 */

import type { Fix } from './flight';
import type { DerivedPoint } from './flight';
import { haversineDistanceM, pickAltitude } from './units';

export type FlightPhase = 'initial-climb' | 'motor' | 'cruise' | 'final-glide';

// --- Initial-climb detection ---
//
// A state machine over the launch signature (Option A of the design memo):
//   1. Skip on-ground/taxiing fixes until the glider is moving.
//   2. From takeoff, look for a sustained climb (Vz > CLIMB_VARIO_MS for
//      SUSTAINED_CLIMB_MIN_MS, or enough altitude gained). Without that
//      signature the recording is treated as starting mid-flight and no
//      initial-climb is tagged.
//   3. Once sustained, release is confirmed by any of:
//      - Vz drops below RELEASE_VARIO_MS continuously for RELEASE_CONFIRM_MS
//        (typical aerotow release signature — vario collapses from ~+3 m/s
//        to near zero as the pilot decouples).
//      - Turn rate exceeds TURN_RATE_RELEASE_DEG_S (the immediate right
//        turn most pilots fly after release).
//      - Total altitude gained exceeds MAX_INITIAL_CLIMB_GAIN_M (a safety
//        cap in case the release signature is somehow missed).

/** On the ground / taxiing / stationary — below this ground speed we
 * consider the glider not yet airborne. */
const ON_GROUND_MAX_GS_KMH = 10;

/** Vz above this = "climbing", used only to enter the climb state.
 * Release detection deliberately does NOT use vario as a primary signal —
 * 1-Hz IGC altitude noise (typically ±1 m) plus a short vario smoothing
 * window makes Vz dip below any reasonable threshold mid-tow. Peak-and-drop
 * on the altitude series itself is far more reliable. */
const CLIMB_VARIO_MS = 1.5;

/** Sustained-climb confirmation: either this many ms above CLIMB_VARIO_MS,
 * or this many meters gained since climb start (winch launches are short
 * but gain fast, aerotow the reverse — either signal confirms). */
const SUSTAINED_CLIMB_MIN_MS = 15_000;
const SUSTAINED_CLIMB_MIN_GAIN_M = 50;

/** Once sustained climb is confirmed, release fires when altitude has
 * dropped at least this many meters below the running max and stays there
 * for RELEASE_CONFIRM_MS. */
const RELEASE_DROP_THRESHOLD_M = 10;
const RELEASE_CONFIRM_MS = 5_000;

/** Turn rate above this = the sharp turn pilots fly right after release. */
const TURN_RATE_RELEASE_DEG_S = 8;

/** Fallback cap: if no other release signal fires within this altitude
 * gain, force a release here. */
const MAX_INITIAL_CLIMB_GAIN_M = 900;

// --- Final-glide ---

const FINAL_GLIDE_MAX_AGL_M = 300;
const FINAL_GLIDE_MAX_RADIUS_M = 3000;

const FINAL_GLIDE_CLIMB_TOLERANCE_M = 50;
const FINAL_GLIDE_MIN_DESCENT_M = 200;

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

  // 1. Initial climb (tow/winch). Pre-takeoff ground fixes are folded into
  //    the same tag so the stationary-at-airfield-elevation samples aren't
  //    scored as out-of-local (glider on the runway has margin = -arrival).
  if ((derived[0].groundSpeedKmh ?? 0) < ON_GROUND_MAX_GS_KMH) {
    const range = detectInitialClimb(fixes, derived, altSrc);
    if (range) {
      for (let i = 0; i <= range.releaseIdx; i++) {
        phases[i] = 'initial-climb';
      }
    }
  }

  // 2. Mark motor phases (overrides cruise, but not initial-climb).
  for (let i = 0; i < n; i++) {
    if (motorFlags[i] && phases[i] === 'cruise') {
      phases[i] = 'motor';
    }
  }

  // 3. Mark the low-altitude circuit into the LZ backwards from the last fix.
  const lastLat = fixes[n - 1].latitude;
  const lastLon = fixes[n - 1].longitude;

  for (let i = n - 1; i >= 0; i--) {
    if (phases[i] !== 'cruise') break; // stop at motor/initial-climb

    const agl = derived[i].aglM;
    const belowAgl = agl !== null && agl < FINAL_GLIDE_MAX_AGL_M;
    const distM = haversineDistanceM(
      fixes[i].latitude,
      fixes[i].longitude,
      lastLat,
      lastLon,
    );

    if (belowAgl && distM < FINAL_GLIDE_MAX_RADIUS_M) {
      phases[i] = 'final-glide';
    } else {
      break;
    }
  }

  // 4. Extend final-glide backwards to cover the sustained descent from the
  //    last thermal into the circuit.
  let anchor = -1;
  for (let i = 0; i < n; i++) {
    if (phases[i] === 'final-glide') {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) anchor = n;

  const endIdx = anchor - 1;
  if (endIdx >= 0 && phases[endIdx] === 'cruise') {
    const endAlt = pickAltitude(fixes[endIdx], altSrc);
    if (endAlt !== null) {
      let rgStart = endIdx;
      let backwardMaxAlt = endAlt;

      for (let i = endIdx - 1; i >= 0; i--) {
        if (phases[i] !== 'cruise') break;
        const alt = pickAltitude(fixes[i], altSrc);
        if (alt === null) break;
        if (backwardMaxAlt - alt > FINAL_GLIDE_CLIMB_TOLERANCE_M) break;
        if (alt > backwardMaxAlt) backwardMaxAlt = alt;
        rgStart = i;
      }

      if (backwardMaxAlt - endAlt >= FINAL_GLIDE_MIN_DESCENT_M) {
        for (let i = rgStart; i <= endIdx; i++) {
          phases[i] = 'final-glide';
        }
      }
    }
  }

  return phases;
}

// ---------------------------------------------------------------------------
// Initial-climb state machine
// ---------------------------------------------------------------------------

type ClimbState = 'rolling' | 'climbing';

interface InitialClimbRange {
  takeoffIdx: number;
  releaseIdx: number;
}

/**
 * Walk forward from the takeoff fix through the launch and detect the
 * release point. Returns null when the recording does not exhibit a launch
 * signature.
 *
 * Release is detected on the altitude series (not vario): once sustained
 * climb is confirmed, we track the running max altitude and fire release
 * at that fix whenever the current altitude has stayed at least
 * RELEASE_DROP_THRESHOLD_M below the max for RELEASE_CONFIRM_MS. A sharp
 * turn while still climbing is a secondary immediate-release signal.
 */
function detectInitialClimb(
  fixes: Fix[],
  derived: DerivedPoint[],
  altSrc: 'pressure' | 'gnss',
): InitialClimbRange | null {
  const n = fixes.length;

  let takeoffIdx = 0;
  while (
    takeoffIdx < n - 1 &&
    (derived[takeoffIdx].groundSpeedKmh ?? 0) < ON_GROUND_MAX_GS_KMH
  ) {
    takeoffIdx++;
  }
  const takeoffAlt = pickAltitude(fixes[takeoffIdx], altSrc) ?? 0;

  let state: ClimbState = 'rolling';
  let climbStartTimeMs = 0;
  let climbStartAlt = takeoffAlt;
  let maxAlt = takeoffAlt;
  let maxAltIdx = takeoffIdx;
  let dropStartIdx = -1;
  let releaseIdx = -1;
  let everSustained = false;

  for (let i = takeoffIdx; i < n; i++) {
    const alt = pickAltitude(fixes[i], altSrc) ?? takeoffAlt;

    // Hard cap — we've gained too much to still be on tow.
    if (alt - takeoffAlt > MAX_INITIAL_CLIMB_GAIN_M) {
      releaseIdx = maxAltIdx;
      break;
    }

    if (state === 'rolling') {
      const vz = derived[i].verticalSpeedMs ?? 0;
      if (vz >= CLIMB_VARIO_MS) {
        state = 'climbing';
        climbStartTimeMs = fixes[i].timeMs;
        climbStartAlt = alt;
        maxAlt = alt;
        maxAltIdx = i;
      }
      continue;
    }

    // state === 'climbing'
    if (alt > maxAlt) {
      maxAlt = alt;
      maxAltIdx = i;
      dropStartIdx = -1;
    }

    const timeSinceClimbStart = fixes[i].timeMs - climbStartTimeMs;
    const gainSinceClimbStart = alt - climbStartAlt;
    if (
      !everSustained &&
      (timeSinceClimbStart >= SUSTAINED_CLIMB_MIN_MS ||
        gainSinceClimbStart >= SUSTAINED_CLIMB_MIN_GAIN_M)
    ) {
      everSustained = true;
    }

    if (!everSustained) continue;

    // Altitude peak-and-drop: primary release signal.
    if (maxAlt - alt >= RELEASE_DROP_THRESHOLD_M) {
      if (dropStartIdx < 0) dropStartIdx = i;
      if (fixes[i].timeMs - fixes[dropStartIdx].timeMs >= RELEASE_CONFIRM_MS) {
        releaseIdx = maxAltIdx;
        break;
      }
    } else {
      dropStartIdx = -1;
    }

    // Sharp turn while still near the max: pilot's break-right after
    // release. Fires even without a clean altitude drop.
    if (turnRateDegPerSec(fixes, i) > TURN_RATE_RELEASE_DEG_S) {
      releaseIdx = maxAltIdx;
      break;
    }
  }

  // Never saw a sustained climb — not a launch.
  if (!everSustained) return null;

  // Ran off the end of the flight without a confirmed release: mark up to
  // the max-altitude fix we did see.
  if (releaseIdx < 0) releaseIdx = maxAltIdx;

  return { takeoffIdx, releaseIdx };
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle initial bearing from (lat1,lon1) to (lat2,lon2), in degrees. */
function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLambda = toRadians(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return toDegrees(Math.atan2(y, x));
}

/** Absolute turn rate at fix `i`, computed from adjacent-fix bearings.
 * Returns 0 at the boundaries or when the two segments are too short to
 * derive a meaningful heading. */
function turnRateDegPerSec(fixes: Fix[], i: number): number {
  if (i <= 0 || i >= fixes.length - 1) return 0;
  const prev = fixes[i - 1];
  const curr = fixes[i];
  const next = fixes[i + 1];
  const dtSec = (next.timeMs - prev.timeMs) / 1000;
  if (dtSec <= 0) return 0;

  const b1 = bearingDeg(
    prev.latitude,
    prev.longitude,
    curr.latitude,
    curr.longitude,
  );
  const b2 = bearingDeg(
    curr.latitude,
    curr.longitude,
    next.latitude,
    next.longitude,
  );
  let delta = b2 - b1;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return Math.abs(delta) / dtSec;
}
