/**
 * QNH-based barometric-altitude recalibration.
 *
 * The IGC pressure altitude is recorded against a fixed reference (usually
 * ISA 1013.25 hPa) and does not reflect the QNH of the day. On the ground
 * before takeoff, the recorded baro altitude therefore differs from the
 * true field elevation by a roughly constant offset that also affects every
 * fix in the flight.
 *
 * We recover that offset by averaging the pre-takeoff baro altitude of the
 * first N consecutive stationary fixes and comparing it to the terrain
 * elevation sampled at the takeoff position. The resulting offset is stored
 * on `NormalizedFlight.qnhOffsetM` and added to every pressure-altitude
 * read via `pickAltitude(fix, 'pressure', offset)`.
 */

import type { Fix, DerivedPoint, NormalizedFlight } from './flight';
import type { ElevationGrid } from './elevation';
import { sampleElevation } from './elevation';
import { computeDerivedMetrics } from './derivedMetrics';
import { computeSummary } from './summary';

/** Below this ground speed the glider is considered stationary. Kept in
 * sync with the same threshold in `flightPhases.ts`. */
const ON_GROUND_MAX_GS_KMH = 10;

/** Minimum number of consecutive pre-takeoff samples required to trust
 * the QNH estimate. */
export const QNH_MIN_SAMPLES = 5;

/** Default sample count when the caller does not specify one. */
export const QNH_DEFAULT_SAMPLES = 8;

export interface QnhCorrection {
  offsetM: number;
  sampleCount: number;
  terrainElevationM: number;
  baroAltitudeM: number;
}

export type QnhCorrectionError =
  | { kind: 'insufficient-samples'; available: number }
  | { kind: 'no-pressure-altitude' }
  | { kind: 'no-terrain' };

export type QnhCorrectionOutcome =
  | { ok: true; correction: QnhCorrection }
  | { ok: false; error: QnhCorrectionError };

/**
 * Estimate the QNH offset (meters to add to pressure altitude) from the
 * first `sampleCount` consecutive stationary fixes.
 */
export function computeQnhOffset(
  fixes: Fix[],
  derived: DerivedPoint[],
  grid: ElevationGrid,
  sampleCount: number = QNH_DEFAULT_SAMPLES,
): QnhCorrectionOutcome {
  const target = Math.max(QNH_MIN_SAMPLES, sampleCount);

  let latSum = 0;
  let lonSum = 0;
  let baroSum = 0;
  let count = 0;

  for (let i = 0; i < fixes.length && count < target; i++) {
    const gs = derived[i]?.groundSpeedKmh ?? 0;
    // First fix has no ground speed (null); treat as stationary.
    if (i > 0 && gs >= ON_GROUND_MAX_GS_KMH) break;

    const baro = fixes[i].pressureAltitudeM;
    if (baro === null) {
      // A single missing sample invalidates the run — pressure altitude
      // must be present throughout the calibration window.
      return { ok: false, error: { kind: 'no-pressure-altitude' } };
    }

    latSum += fixes[i].latitude;
    lonSum += fixes[i].longitude;
    baroSum += baro;
    count++;
  }

  if (count < QNH_MIN_SAMPLES) {
    return { ok: false, error: { kind: 'insufficient-samples', available: count } };
  }

  const avgLat = latSum / count;
  const avgLon = lonSum / count;
  const avgBaro = baroSum / count;

  const terrain = sampleElevation(grid, avgLat, avgLon);
  if (isNaN(terrain)) {
    return { ok: false, error: { kind: 'no-terrain' } };
  }

  return {
    ok: true,
    correction: {
      offsetM: terrain - avgBaro,
      sampleCount: count,
      terrainElevationM: terrain,
      baroAltitudeM: avgBaro,
    },
  };
}

/**
 * Return a new `NormalizedFlight` with `qnhOffsetM` applied and the derived
 * metrics + summary recomputed against the recalibrated altitude. Raw fixes
 * are preserved as-is (source of truth); only derived/summary reflect the
 * correction.
 *
 * When `offsetM` is `null`, the flight is returned with the correction
 * cleared (derived/summary recomputed at offset = 0).
 */
export function applyQnhOffsetToFlight(
  flight: NormalizedFlight,
  offsetM: number | null,
  elevationGrid: ElevationGrid | null,
): NormalizedFlight {
  const effectiveOffset = offsetM ?? 0;
  const derived = computeDerivedMetrics(
    flight.fixes,
    flight.preferredAltitudeSource,
    elevationGrid,
    effectiveOffset,
  );
  const summary = computeSummary(
    flight.header,
    flight.fixes,
    derived,
    flight.preferredAltitudeSource,
    effectiveOffset,
  );
  return {
    ...flight,
    derived,
    summary,
    qnhOffsetM: offsetM,
  };
}

