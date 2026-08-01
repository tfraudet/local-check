/**
 * Geometry helpers for interacting with the track on the map.
 */

import type { NormalizedFlight } from '../../domain/flight';
import { findCurrentFixIndex } from '../../domain/flight';

/** Linearly interpolated [lon, lat] of the glider at `timeMs`. */
export function interpolatePosition(
  flight: NormalizedFlight,
  timeMs: number,
): [number, number] | null {
  const index = findCurrentFixIndex(flight, timeMs);
  if (index < 0) return null;
  const current = flight.fixes[index];
  const next = flight.fixes[index + 1];
  if (!next) return [current.longitude, current.latitude];

  const span = next.timeMs - current.timeMs;
  const ratio = span > 0 ? (timeMs - current.timeMs) / span : 0;
  return [
    current.longitude + (next.longitude - current.longitude) * ratio,
    current.latitude + (next.latitude - current.latitude) * ratio,
  ];
}

/**
 * Time of the fix closest to a lon/lat, compared in raw degrees — good
 * enough for a pointer hit-test over a single flight's extent.
 */
export function nearestFixTimeMs(
  flight: NormalizedFlight,
  lng: number,
  lat: number,
): number {
  let nearestIndex = 0;
  let nearestDistSq = Infinity;
  for (let i = 0; i < flight.fixes.length; i++) {
    const fix = flight.fixes[i];
    const dLon = fix.longitude - lng;
    const dLat = fix.latitude - lat;
    const distSq = dLon * dLon + dLat * dLat;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestIndex = i;
    }
  }
  return flight.fixes[nearestIndex].timeMs;
}
