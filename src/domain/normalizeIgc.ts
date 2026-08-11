import IGCParser from 'igc-parser';
import { computeDerivedMetrics } from './derivedMetrics';
import { computeSummary } from './summary';
import type {
  Fix,
  FlightHeader,
  IgcParseError,
  NormalizedFlight,
} from './flight';

/**
 * Transform a raw `igc-parser` result into our framework-agnostic
 * `NormalizedFlight` domain model.
 *
 * - Time: re-sorted ascending by timestamp; non-monotonic/duplicate fixes
 *   are dropped defensively (igc-parser already resolves UTC timestamps
 *   and midnight rollover).
 * - Altitude: pressure/GNSS kept independently as `null` when absent.
 *   `preferredAltitudeSource` defaults to 'pressure', falling back to
 *   'gnss' only if the pressure series is entirely absent.
 * - Headers: best-effort; any missing field maps to `null`.
 */
export function normalizeIgc(parsed: IGCParser.IGCFile): NormalizedFlight {
  if (!parsed.fixes || parsed.fixes.length === 0) {
    throw makeError('empty-file', 'This IGC file contains no flight fixes.');
  }

   if (import.meta.env.DEV) console.log('Igc parsed file (not normalized)', parsed);
  const rawFixes: Fix[] = parsed.fixes
    .filter((f) => f.valid !== false)
    .map((f) => ({
      timeMs: f.timestamp,
      latitude: f.latitude,
      longitude: f.longitude,
      pressureAltitudeM: f.pressureAltitude,
      gnssAltitudeM: f.gpsAltitude,
    }));

  // Sort ascending by time, then drop non-monotonic duplicates.
  rawFixes.sort((a, b) => a.timeMs - b.timeMs);
  const fixes: Fix[] = [];
  for (const fix of rawFixes) {
    const last = fixes[fixes.length - 1];
    if (!last || fix.timeMs > last.timeMs) {
      fixes.push(fix);
    }
  }

  if (fixes.length === 0) {
    throw makeError(
      'empty-file',
      'This IGC file contains no valid flight fixes.',
    );
  }

  const hasPressure = fixes.some((f) => f.pressureAltitudeM !== null);
  const preferredAltitudeSource: 'pressure' | 'gnss' = hasPressure
    ? 'pressure'
    : 'gnss';

  const header: FlightHeader = {
    date: parsed.date ?? null,
    pilotName: parsed.pilot ?? null,
    gliderType: parsed.gliderType ?? null,
    gliderRegistration: parsed.registration ?? null,
    competitionId: parsed.competitionClass ?? null,
    recorderInfo:
      [parsed.loggerManufacturer, parsed.loggerType]
        .filter(Boolean)
        .join(' ') || null,
  };

  const derived = computeDerivedMetrics(fixes, preferredAltitudeSource);
  const summary = computeSummary(
    header,
    fixes,
    derived,
    preferredAltitudeSource,
  );

  return {
    header,
    fixes,
    derived,
    summary,
    preferredAltitudeSource,
  };
}

function makeError(
  kind: IgcParseError['kind'],
  message: string,
): Error & {
  parseError: IgcParseError;
} {
  const error = new Error(message) as Error & { parseError: IgcParseError };
  error.parseError = { kind, message };
  return error;
}

/**
 * Parse raw IGC file text and normalize it, converting any parser failure
 * into a typed `IgcParseError` rather than letting exceptions leak.
 */
export function parseAndNormalizeIgc(
  igcText: string,
): { flight: NormalizedFlight } | { error: IgcParseError } {
  if (!igcText || !igcText.trim()) {
    return { error: { kind: 'empty-file', message: 'The file is empty.' } };
  }

  let parsed: IGCParser.IGCFile;
  try {
    const lines = igcText.split(/\r?\n/);
    const hasARecord = lines.some((line) => /^A/.test(line.trim()));
    const hasDateHeader = lines.some((line) => /^HFDTE/.test(line.trim()));
    const parserInput =
      !hasARecord && hasDateHeader ? `AXXX\n${igcText}` : igcText;

    parsed = IGCParser.parse(parserInput, { lenient: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unable to parse this file.';
    return {
      error: {
        kind: 'invalid-format',
        message: `This file doesn't look like a valid IGC flight log. (${message})`,
      },
    };
  }

  try {
    const flight = normalizeIgc(parsed);
    return { flight };
  } catch (err) {
    if (err instanceof Error && 'parseError' in err) {
      return { error: (err as { parseError: IgcParseError }).parseError };
    }
    return {
      error: {
        kind: 'unknown',
        message: err instanceof Error ? err.message : 'Unknown parsing error.',
      },
    };
  }
}
