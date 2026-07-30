/**
 * SeeYou .cup file parser → LandingZone[].
 *
 * .cup is a CSV format with a mandatory header row. Coordinate encoding:
 *   Latitude:  DDMM.mmmN  or  DDMM.mmmS
 *   Longitude: DDDMM.mmmE  or  DDDMM.mmmW
 *
 * Style codes (relevant subset):
 *   0 = unknown, 1 = waypoint (not an LZ), 2 = airfield grass,
 *   3 = airfield concrete, 4 = outlanding, 5 = glider site, 7 = mountain,
 *   8 = sky-diving, 9 = ultralight site, 10 = hangglider site, 11 = parachute
 * Only styles ≥ 2 (minus 1) are treated as usable LZs.
 */

import type {
  AlpesDifficultyTag,
  LandingZone,
  LandingZoneSource,
} from './landingZone';
import { difficultyLevelFromTag, lzId } from './landingZone';

export interface CupParseSuccess {
  ok: true;
  zones: LandingZone[];
}

export interface CupParseError {
  ok: false;
  zones: LandingZone[]; // partial results up to the first errors
  errors: Array<{ line: number; message: string }>;
}

export type CupParseResult = CupParseSuccess | CupParseError;

const LANDABLE_STYLES = new Set([2, 3, 4, 5]);
const DIFFICULTY_REGEX = /\{(A|F|E|ZA|LA|M|D|TD|VD)\}/i;

export function parseCup(text: string, source: LandingZoneSource = 'user'): CupParseResult {
  const lines = text.split(/\r?\n/);
  const zones: LandingZone[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  let headerSkipped = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('//')) continue;

    // Skip the header row (contains column names, no numeric coordinate)
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }

    // Stop at the task section marker
    if (raw.toLowerCase().startsWith('-----related tasks-----')) break;

    const cols = parseCsvRow(raw);
    if (cols.length < 6) {
      errors.push({ line: i + 1, message: `Expected ≥6 columns, got ${cols.length}` });
      continue;
    }

    // Columns: name, code, country, lat, lon, elev, style, rwdir, rwlen, freq, desc
    const [nameRaw, codeRaw, countryRaw, latRaw, lonRaw, elevRaw, styleRaw, rwdirRaw, , , descRaw] = cols;

    const name = nameRaw?.trim() || '?';
    const code = codeRaw?.trim() || null;

    const lat = parseCupLatitude(latRaw?.trim() ?? '');
    const lon = parseCupLongitude(lonRaw?.trim() ?? '');
    if (lat === null || lon === null) {
      errors.push({ line: i + 1, message: `Invalid coordinates: "${latRaw}" / "${lonRaw}"` });
      continue;
    }

    const elevationM = parseElevation(elevRaw?.trim() ?? '');
    const style = parseStyle(styleRaw?.trim() ?? '');
    const runwayHeading = parseRunwayHeading(rwdirRaw?.trim() ?? '');
    const description = descRaw?.trim() || null;
    const tag = extractDifficulty(description);
    const isAirfield = (style !== null && [2, 3, 5].includes(style)) || tag === 'A';

    // Only import usable LZs (drop pure waypoints / unknown)
    if (style !== null && !LANDABLE_STYLES.has(style) && style !== 0) continue;

    void countryRaw; // not used, suppress lint

    zones.push({
      id: lzId(name, lat, lon),
      name,
      code,
      latitude: lat,
      longitude: lon,
      elevationM,
      style,
      difficulty_level: difficultyLevelFromTag(tag),
      description,
      isAirfield,
      runwayHeading,
      source,
    });
  }

  const deduped = deduplicateZones(zones);
  return errors.length === 0
    ? { ok: true, zones: deduped }
    : { ok: false, zones: deduped, errors };
}

// ---------------------------------------------------------------------------
// Coordinate parsing
// ---------------------------------------------------------------------------

/** Parse SeeYou latitude string "DDMM.mmmN" → decimal degrees or null. */
export function parseCupLatitude(s: string): number | null {
  const m = s.match(/^(\d{2})(\d{2}\.\d+)([NS])$/i);
  if (!m) return null;
  const deg = parseInt(m[1], 10);
  const min = parseFloat(m[2]);
  const sign = m[3].toUpperCase() === 'N' ? 1 : -1;
  const result = sign * (deg + min / 60);
  if (result < -90 || result > 90) return null;
  return result;
}

/** Parse SeeYou longitude string "DDDMM.mmmE" → decimal degrees or null. */
export function parseCupLongitude(s: string): number | null {
  const m = s.match(/^(\d{3})(\d{2}\.\d+)([EW])$/i);
  if (!m) return null;
  const deg = parseInt(m[1], 10);
  const min = parseFloat(m[2]);
  const sign = m[3].toUpperCase() === 'E' ? 1 : -1;
  const result = sign * (deg + min / 60);
  if (result < -180 || result > 180) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseElevation(s: string): number | null {
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|ft)?$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit === 'ft' ? value * 0.3048 : value;
}

/**
 * Parse a SeeYou `rwdir` field (runway direction in degrees, 0–360).
 * Returns 0 for empty or unparseable input — the icon layer treats 0 as
 * "no known heading" (bar stays north-aligned).
 */
function parseRunwayHeading(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function parseStyle(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function extractDifficulty(desc: string | null): AlpesDifficultyTag | null {
  if (!desc) return null;
  const m = desc.match(DIFFICULTY_REGEX);
  if (!m) return null;
  return m[1].toUpperCase() as AlpesDifficultyTag;
}

/**
 * Merge LZs within 250 m of each other.
 * Preference: airfields always kept; otherwise prefer the entry with an
 * explicit (non-default) difficulty level over one that defaulted to green.
 */
function deduplicateZones(zones: LandingZone[]): LandingZone[] {
  const DEDUP_THRESHOLD_KM = 0.25;
  const kept: LandingZone[] = [];

  for (const z of zones) {
    const duplicate = kept.findIndex(
      (k) => haversineKm(k.latitude, k.longitude, z.latitude, z.longitude) < DEDUP_THRESHOLD_KM,
    );
    if (duplicate === -1) {
      kept.push(z);
    } else {
      const existing = kept[duplicate];
      if (!existing.isAirfield && z.isAirfield) {
        kept[duplicate] = z;
      } else if (
        !existing.isAirfield &&
        !z.isAirfield &&
        existing.difficulty_level === 'green' &&
        z.difficulty_level !== 'green'
      ) {
        kept[duplicate] = z;
      }
    }
  }

  return kept;
}

/**
 * Parse one CSV row respecting double-quoted fields (embedded commas allowed).
 */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
