/**
 * Landing Zone (LZ) domain types for Phase 2 local verification.
 *
 * LZs are imported from SeeYou .cup files. This module is framework-agnostic.
 */

export type DifficultyTag =
  | 'A' // airfield
  | 'F' // easy
  | 'E' // easy (alt)
  | 'ZA' // group of fields
  | 'LA' // group of fields (alt)
  | 'M' // medium
  | 'D' // difficult
  | 'TD' // very difficult
  | 'VD'; // very difficult (alt)

/** Provenance of a landing zone entry. */
export type LandingZoneSource = 'user' | 'outlanding-alps';

export interface LandingZone {
  /** Stable ID: lowercase hex of fnv32a(name + lat.toFixed(5) + lon.toFixed(5)). */
  id: string;
  name: string;
  code: string | null;
  latitude: number; // decimal degrees
  longitude: number; // decimal degrees
  elevationM: number | null; // from .cup; null if absent
  style: number | null; // SeeYou style code (2-5 = airfield variants)
  difficulty: DifficultyTag | null;
  description: string | null;
  isAirfield: boolean; // style ∈ {2,3,4,5} OR difficulty === 'A'
  source: LandingZoneSource;
}

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
