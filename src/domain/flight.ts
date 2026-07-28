/**
 * Domain data model for a normalized glider flight.
 *
 * This module is framework-agnostic (no React/MapLibre/uPlot imports) so it
 * can be unit-tested in isolation and reused if the UI layer changes later.
 */

export interface Fix {
  /** Milliseconds since Unix epoch, UTC. */
  timeMs: number;
  latitude: number; // decimal degrees
  longitude: number; // decimal degrees
  pressureAltitudeM: number | null; // meters, null if not recorded
  gnssAltitudeM: number | null; // meters, null if not recorded
}

export interface FlightHeader {
  date: string | null; // ISO date (from IGC header), null if absent
  pilotName: string | null;
  gliderType: string | null;
  gliderRegistration: string | null;
  competitionId: string | null;
  recorderInfo: string | null; // manufacturer/model, best-effort
}

/** Per-fix derived values, aligned 1:1 with `fixes`. */
export interface DerivedPoint {
  groundSpeedKmh: number | null; // null for the first fix (no prior point)
  verticalSpeedMs: number | null; // vario, null for the first fix
  cumulativeDistanceKm: number;
}

export interface FlightSummary {
  date: string | null;
  pilotName: string | null;
  gliderType: string | null;
  takeoffTimeMs: number | null;
  landingTimeMs: number | null;
  durationMs: number;
  maxAltitudeM: number;
  minAltitudeM: number;
  maxGroundSpeedKmh: number;
  totalDistanceKm: number;
  fixCount: number;
}

export interface NormalizedFlight {
  header: FlightHeader;
  fixes: Fix[]; // sorted ascending by timeMs, deduplicated
  derived: DerivedPoint[]; // same length/order as `fixes`
  summary: FlightSummary;
  /** Altitude source the UI should default to when both are available. */
  preferredAltitudeSource: 'pressure' | 'gnss';
}

export type IgcParseError =
  | { kind: 'invalid-format'; message: string }
  | { kind: 'empty-file'; message: string }
  | { kind: 'unknown'; message: string };
