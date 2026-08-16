import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAndNormalizeIgc } from '../../src/domain/normalizeIgc';

const fixturePath = resolve(
  process.cwd(),
  'fixtures/sample-flights/simple-flight.igc',
);
const sampleIgcText = readFileSync(fixturePath, 'utf8');

describe('parseAndNormalizeIgc', () => {
  it('normalizes a valid IGC file into a NormalizedFlight', () => {
    const result = parseAndNormalizeIgc(sampleIgcText);
    expect('flight' in result).toBe(true);
    if (!('flight' in result)) throw new Error('expected flight');

    const { flight } = result;
    expect(flight.fixes.length).toBe(30);
    expect(flight.header.pilotName).toBe('Jane Doe');
    expect(flight.header.gliderType).toBe('ASK 21');
    expect(flight.preferredAltitudeSource).toBe('pressure');
    expect(flight.derived.length).toBe(flight.fixes.length);
    expect(flight.derived[0].groundSpeedKmh).toBeNull();
    expect(flight.derived[1].groundSpeedKmh).not.toBeNull();
    expect(flight.summary.fixCount).toBe(30);
    expect(flight.summary.takeoffTimeMs).toBe(flight.fixes[0].timeMs);
    expect(flight.summary.landingTimeMs).toBe(
      flight.fixes[flight.fixes.length - 1].timeMs,
    );
  });

  it('returns a typed error for an empty file', () => {
    const result = parseAndNormalizeIgc('');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.kind).toBe('empty-file');
    }
  });

  it('returns a typed error for a malformed file', () => {
    const result = parseAndNormalizeIgc('this is not an igc file\nfoo bar');
    expect('error' in result).toBe(true);
  });
});
