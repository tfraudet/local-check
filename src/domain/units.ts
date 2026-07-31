/**
 * Metric formatting helpers, centralizing unit conversions/display so all
 * numeric values shown in the UI stay consistent. Phase 1 ships metric only
 * (m, km, km/h, m/s); a future unit-system toggle only needs to change this
 * module.
 */

import type { Fix } from './flight';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lon points, in kilometers. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Great-circle distance between two lat/lon points, in meters. */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineDistanceKm(lat1, lon1, lat2, lon2) * 1000;
}

export function pickAltitude(fix: Fix, source: 'pressure' | 'gnss'): number | null {
  return source === 'pressure' ? fix.pressureAltitudeM : fix.gnssAltitudeM;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function formatAltitude(meters: number | null): string {
  if (meters === null) return '—';
  return `${Math.round(meters)} m`;
}

export function formatSpeed(kmh: number | null): string {
  if (kmh === null) return '—';
  return `${Math.round(kmh)} km/h`;
}

export function formatVario(ms: number | null): string {
  if (ms === null) return '—';
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${ms.toFixed(1)} m/s`;
}

export function formatDistance(km: number): string {
  return `${km.toFixed(1)} km`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatTimeUtc(timeMs: number): string {
  const date = new Date(timeMs);
  return date.toISOString().slice(11, 19) + ' UTC';
}

export function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
}
