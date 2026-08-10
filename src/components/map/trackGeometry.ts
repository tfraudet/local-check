/**
 * Geometry helpers for interacting with the track on the map.
 */

import type { NormalizedFlight } from '../../domain/flight';
import { findCurrentFixIndex } from '../../domain/flight';

export interface InterpolatedTrackState {
  position: [number, number];
  /** Bearing in degrees, 0=north, 90=east (clockwise). */
  headingDeg: number;
}

function segmentHeadingDeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const phi1 = (fromLat * Math.PI) / 180;
  const phi2 = (toLat * Math.PI) / 180;
  const dLambda = ((toLon - fromLon) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

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
 * Interpolated map position + heading of the glider at `timeMs`.
 * Heading follows the current segment direction.
 */
export function interpolateTrackState(
  flight: NormalizedFlight,
  timeMs: number,
): InterpolatedTrackState | null {
  const index = findCurrentFixIndex(flight, timeMs);
  if (index < 0) return null;
  const current = flight.fixes[index];
  const next = flight.fixes[index + 1];
  const prev = flight.fixes[index - 1];

  if (!next) {
    if (prev) {
      return {
        position: [current.longitude, current.latitude],
        headingDeg: segmentHeadingDeg(
          prev.latitude,
          prev.longitude,
          current.latitude,
          current.longitude,
        ),
      };
    }
    return { position: [current.longitude, current.latitude], headingDeg: 0 };
  }

  const span = next.timeMs - current.timeMs;
  const ratio = span > 0 ? (timeMs - current.timeMs) / span : 0;
  return {
    position: [
      current.longitude + (next.longitude - current.longitude) * ratio,
      current.latitude + (next.latitude - current.latitude) * ratio,
    ],
    headingDeg: segmentHeadingDeg(
      current.latitude,
      current.longitude,
      next.latitude,
      next.longitude,
    ),
  };
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
