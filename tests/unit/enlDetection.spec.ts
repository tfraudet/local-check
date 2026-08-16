import { describe, expect, it } from 'vitest';
import { detectMotorUse } from '../../src/domain/enlDetection';
import type { Fix } from '../../src/domain/flight';

function fix(timeMs: number, enl?: number): Fix {
  return {
    timeMs,
    latitude: 43,
    longitude: 6,
    pressureAltitudeM: 1000,
    gnssAltitudeM: 1000,
    // Simulate igc-parser extension field
    ...(enl !== undefined ? { extensions: { ENL: enl } } : {}),
  } as Fix;
}

describe('detectMotorUse', () => {
  it('returns all false when no ENL extension is present', () => {
    const fixes = [fix(0), fix(1000), fix(2000)];
    const flags = detectMotorUse(fixes, 500);
    expect(flags.every((f) => f === false)).toBe(true);
  });

  it('marks fixes above the threshold as motor running', () => {
    const fixes = [fix(0, 0), fix(1000, 600), fix(2000, 400)];
    const flags = detectMotorUse(fixes, 500);
    expect(flags[0]).toBe(false);
    expect(flags[1]).toBe(true); // 600 >= 500
    expect(flags[2]).toBe(false); // 400 < 500
  });

  it('all false when all ENL values are below threshold', () => {
    const fixes = [fix(0, 100), fix(1000, 200), fix(2000, 300)];
    const flags = detectMotorUse(fixes, 500);
    expect(flags.every((f) => f === false)).toBe(true);
  });
});
