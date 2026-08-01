/**
 * Landing Zone (LZ) domain types for Phase 2 local verification.
 *
 * LZs are imported from SeeYou .cup files. This module is framework-agnostic.
 */

import { haversineDistanceM } from './units';

/**
 * Raw alpine outlanding difficulty tag as embedded in the .cup description
 * (e.g. `{F}`, `{M}`, `{TD}`). Used internally by the parser; consumers
 * work with the simplified `DifficultyLevel` instead.
 */
export type AlpesDifficultyTag =
  | 'A' // airfield
  | 'F' // easy
  | 'E' // easy (alt)
  | 'ZA' // group of fields
  | 'LA' // group of fields (alt)
  | 'M' // medium
  | 'D' // difficult
  | 'TD' // very difficult
  | 'VD'; // very difficult (alt)

/**
 * Simplified four-level difficulty scale, aligned with alpine airfield
 * outlanding tags (see the .cup convention documented in `parseCup.ts`).
 *
 *   green  ← A, F, E, ZA, LA  (airfield or easy landable field)
 *   orange ← M                (medium)
 *   red    ← D                (difficult)
 *   black  ← TD, VD           (very difficult)
 */
export type DifficultyLevel = 'green' | 'orange' | 'red' | 'black';

/** Provenance of a landing zone entry. */
export type LandingZoneSource =
  'user' | 'outlanding-alps' | 'outlanding-auvergne' | 'openaip';

export interface LandingZone {
  /** Stable ID: lowercase hex of fnv32a(name + lat.toFixed(5) + lon.toFixed(5)). */
  id: string;
  name: string;
  code: string | null;
  latitude: number; // decimal degrees
  longitude: number; // decimal degrees
  elevationM: number | null; // from .cup; null if absent
  style: number | null; // SeeYou style code (2-5 = airfield variants)
  difficulty_level: DifficultyLevel;
  description: string | null;
  isAirfield: boolean; // style ∈ {2,3,4,5} OR tag === 'A'
  /** Primary runway heading in degrees (0–359, true north). If the source
   * provides multiple runways, take the last. Sources without runway
   * information default to 0. */
  runwayHeading: number;
  source: LandingZoneSource;
}

/**
 * Map an Alpes difficulty tag (or absence thereof) onto the simplified
 * 4-level scale. Anything unknown falls back to `green`, matching the
 * legacy behavior for airfields and untagged zones.
 */
export function difficultyLevelFromTag(
  tag: AlpesDifficultyTag | null,
): DifficultyLevel {
  switch (tag) {
    case 'M':
      return 'orange';
    case 'D':
      return 'red';
    case 'TD':
    case 'VD':
      return 'black';
    // A, F, E, ZA, LA, or no explicit tag → green
    default:
      return 'green';
  }
}

/** Hex color for each difficulty level; kept in sync with the map layer. */
export const DIFFICULTY_LEVEL_COLOR: Record<DifficultyLevel, string> = {
  green: '#22c55e',
  orange: '#f97316',
  red: '#ef4444',
  black: '#0f172a',
};

/** FNV-1a 32-bit hash → lowercase hex string (8 chars). */
export function lzId(name: string, lat: number, lon: number): string {
  const str = `${name}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Two entries from different sources closer than this are the same
 * real-world site. 400 m comfortably covers airfield centre-vs-runway
 * threshold offsets between OpenAIP and .cup imports. */
export const CROSS_SOURCE_DEDUP_THRESHOLD_M = 400;

/** Merge distance applied inside a single imported file. */
export const INTRA_SOURCE_DEDUP_THRESHOLD_M = 250;

/**
 * Coarse spatial index for "is there already a zone within X metres?"
 * lookups. A plain linear scan is O(n·m) and ran on every OpenAIP fetch
 * (i.e. on every map pan) with hundreds of zones on both sides; bucketing
 * by a lat/lon grid makes it effectively O(n).
 */
export function createProximityIndex(
  zones: readonly LandingZone[],
  thresholdM: number,
) {
  // One cell must be at least as wide as the threshold so a 3×3
  // neighbourhood is guaranteed to contain every candidate.
  const cellDeg = Math.max(0.01, (thresholdM / 111_000) * 2);
  const buckets = new Map<string, LandingZone[]>();
  const keyOf = (lat: number, lon: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;

  for (const z of zones) {
    const key = keyOf(z.latitude, z.longitude);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(z);
    else buckets.set(key, [z]);
  }

  return {
    /** Nearest indexed zone within `thresholdM`, or null. */
    findNear(lat: number, lon: number): LandingZone | null {
      const row = Math.floor(lat / cellDeg);
      const col = Math.floor(lon / cellDeg);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const bucket = buckets.get(`${row + dr}:${col + dc}`);
          if (!bucket) continue;
          for (const z of bucket) {
            if (
              haversineDistanceM(lat, lon, z.latitude, z.longitude) < thresholdM
            ) {
              return z;
            }
          }
        }
      }
      return null;
    },
  };
}
