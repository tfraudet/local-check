import type { DerivedPoint, Fix, FlightHeader, FlightSummary } from './flight';
import { pickAltitude } from './units';

/**
 * Compute the flight summary from the fully normalized fix/derived arrays.
 * Takeoff/landing time is approximated for Phase 1 as the first/last fix
 * timestamp (no launch/landing detection heuristics yet).
 */
export function computeSummary(
  header: FlightHeader,
  fixes: Fix[],
  derived: DerivedPoint[],
  altitudeSource: 'pressure' | 'gnss',
): FlightSummary {
  if (fixes.length === 0) {
    return {
      date: header.date,
      pilotName: header.pilotName,
      gliderType: header.gliderType,
      takeoffTimeMs: null,
      landingTimeMs: null,
      durationMs: 0,
      maxAltitudeM: 0,
      minAltitudeM: 0,
      maxGroundSpeedKmh: 0,
      totalDistanceKm: 0,
      fixCount: 0,
    };
  }

  let maxAltitudeM = -Infinity;
  let minAltitudeM = Infinity;
  let maxGroundSpeedKmh = 0;

  for (let i = 0; i < fixes.length; i++) {
    const alt = pickAltitude(fixes[i], altitudeSource);
    if (alt !== null) {
      if (alt > maxAltitudeM) maxAltitudeM = alt;
      if (alt < minAltitudeM) minAltitudeM = alt;
    }
    const speed = derived[i]?.groundSpeedKmh;
    if (speed != null && speed > maxGroundSpeedKmh) {
      maxGroundSpeedKmh = speed;
    }
  }

  if (maxAltitudeM === -Infinity) maxAltitudeM = 0;
  if (minAltitudeM === Infinity) minAltitudeM = 0;

  const takeoffTimeMs = fixes[0].timeMs;
  const landingTimeMs = fixes[fixes.length - 1].timeMs;

  return {
    date: header.date,
    pilotName: header.pilotName,
    gliderType: header.gliderType,
    takeoffTimeMs,
    landingTimeMs,
    durationMs: landingTimeMs - takeoffTimeMs,
    maxAltitudeM,
    minAltitudeM,
    maxGroundSpeedKmh,
    totalDistanceKm: derived[derived.length - 1]?.cumulativeDistanceKm ?? 0,
    fixCount: fixes.length,
  };
}
