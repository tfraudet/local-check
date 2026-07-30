/**
 * Parser for the ACPh Auvergne outlanding-fields JSON database.
 *
 * Endpoint returns an array of proprietary records with french field names.
 * Coordinates are already decimal degrees; difficulty (`Facilité`) is a
 * french color word that maps directly onto our simplified 4-level scale.
 */

import type {
  DifficultyLevel,
  LandingZone,
  LandingZoneSource,
} from './landingZone';
import { lzId } from './landingZone';

interface AuvergneRecord {
  NomInformatique?: string;
  VraiNomDuChamp?: string;
  Latitude?: number;
  Longitude?: number;
  Facilité?: string;
  Axes?: string;
  Longueur?: string;
  Altitude?: string;
  Configuration?: string;
  Description?: string;
  ChampNoir?: string;
}

export interface AuvergneParseResult {
  ok: boolean;
  zones: LandingZone[];
  errors: Array<{ index: number; message: string }>;
}

const FACILITE_TO_LEVEL: Record<string, DifficultyLevel> = {
  vert: 'green',
  orange: 'orange',
  rouge: 'red',
  noir: 'black',
};

export function parseAuvergneOutlandings(
  text: string,
  source: LandingZoneSource = 'outlanding-auvergne',
): AuvergneParseResult {
  const errors: Array<{ index: number; message: string }> = [];
  const zones: LandingZone[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      zones: [],
      errors: [{ index: -1, message: `Invalid JSON: ${(e as Error).message}` }],
    };
  }

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      zones: [],
      errors: [{ index: -1, message: 'Expected a JSON array at the root' }],
    };
  }

  raw.forEach((entry, i) => {
    const r = entry as AuvergneRecord;
    const name = (r.VraiNomDuChamp || r.NomInformatique || '').trim();
    const lat = typeof r.Latitude === 'number' ? r.Latitude : NaN;
    const lon = typeof r.Longitude === 'number' ? r.Longitude : NaN;
    if (!name || !isFinite(lat) || !isFinite(lon)) {
      errors.push({ index: i, message: `Missing name or coordinates` });
      return;
    }

    const level =
      FACILITE_TO_LEVEL[(r.Facilité ?? '').toLowerCase()] ?? 'green';

    zones.push({
      id: lzId(name, lat, lon),
      name,
      code: r.NomInformatique?.trim() || null,
      latitude: lat,
      longitude: lon,
      elevationM: parseAltitudeMeters(r.Altitude),
      // SeeYou style code for an outlanding field in the ACPh convention.
      // The source JSON does not carry a style attribute, so we default to
      // 3 whenever nothing is provided.
      style: 3,
      difficulty_level: level,
      description: buildDescription(r),
      isAirfield: false,
      runwayHeading: parseAxesHeading(r.Axes),
      source,
    });
  });

  return { ok: errors.length === 0, zones, errors };
}

/**
 * Parse the ACPh `Axes` field to a runway heading in degrees.
 * Format is like `"360° / 180°"` — the first three characters give the
 * primary heading. Returns 0 when the field is missing or unparseable.
 */
function parseAxesHeading(v: string | undefined): number {
  if (!v) return 0;
  const head = v.trim().slice(0, 3);
  const n = parseInt(head, 10);
  if (!isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/** Parse "907m" / "907 m" / "1030 m" → 907. */
function parseAltitudeMeters(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/(-?\d+(?:[.,]\d+)?)\s*m/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return isFinite(n) ? n : null;
}

function buildDescription(r: AuvergneRecord): string | null {
  const parts: string[] = [];
  if (r.Configuration) parts.push(r.Configuration.trim());
  if (r.Axes) parts.push(`Axes: ${r.Axes.trim()}`);
  if (r.Longueur) parts.push(`Longueur: ${r.Longueur.trim()}`);
  if (r.Description) parts.push(r.Description.trim());
  if (r.ChampNoir) parts.push(`⚠ ${r.ChampNoir.trim()}`);
  const joined = parts.filter(Boolean).join(' — ');
  return joined || null;
}
