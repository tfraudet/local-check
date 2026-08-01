import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parseAndNormalizeIgc } from '../../src/domain/normalizeIgc';
import { computeFlightPhases } from '../../src/domain/flightPhases';
import { detectMotorUse } from '../../src/domain/enlDetection';

describe('initial-climb detection on real IGC', () => {
  it('detects tow release at 12:30:17 UTC / 860 m on the 2026-07-19 flight', () => {
    const raw = readFileSync(
      'fixtures/sample-flights/2026-07-19-XNA-200296-01.igc',
      'utf8',
    );
    const result = parseAndNormalizeIgc(raw);
    if ('error' in result)
      throw new Error('parse failed: ' + result.error.message);
    const { flight } = result;

    const motorFlags = detectMotorUse(flight.fixes, 500);
    const phases = computeFlightPhases(
      flight.fixes,
      flight.derived,
      motorFlags,
      'pressure',
    );

    let lastIc = -1;
    for (let i = 0; i < phases.length; i++) {
      if (phases[i] === 'initial-climb') lastIc = i;
    }

    expect(lastIc).toBeGreaterThan(0);
    const lastFix = flight.fixes[lastIc];
    const releaseTimeIso = new Date(lastFix.timeMs).toISOString().slice(11, 19);

    // Ground-truth from manual inspection: release at 12:30:17 UTC / 860 m.
    // Allow a small tolerance in case the algorithm converges on an
    // adjacent fix.
    expect(releaseTimeIso >= '12:30:14' && releaseTimeIso <= '12:30:20').toBe(
      true,
    );
    expect(lastFix.pressureAltitudeM).toBeGreaterThanOrEqual(850);
    expect(lastFix.pressureAltitudeM).toBeLessThanOrEqual(870);
  });
});
