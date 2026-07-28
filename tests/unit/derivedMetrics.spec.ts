import { describe, expect, it } from 'vitest';
import { computeDerivedMetrics } from '../../src/domain/derivedMetrics';
import type { Fix } from '../../src/domain/flight';

function makeFix(overrides: Partial<Fix>): Fix {
  return {
    timeMs: 0,
    latitude: 45,
    longitude: 6,
    pressureAltitudeM: 1000,
    gnssAltitudeM: 1005,
    ...overrides,
  };
}

describe('computeDerivedMetrics', () => {
  it('returns null speed/vario for the first fix', () => {
    const fixes = [makeFix({ timeMs: 0 })];
    const derived = computeDerivedMetrics(fixes, 'pressure');
    expect(derived[0].groundSpeedKmh).toBeNull();
    expect(derived[0].verticalSpeedMs).toBeNull();
    expect(derived[0].cumulativeDistanceKm).toBe(0);
  });

  it('computes positive ground speed for a moving fix', () => {
    const fixes = [
      makeFix({ timeMs: 0, latitude: 45.0, longitude: 6.0 }),
      makeFix({ timeMs: 10_000, latitude: 45.001, longitude: 6.0 }),
    ];
    const derived = computeDerivedMetrics(fixes, 'pressure');
    expect(derived[1].groundSpeedKmh).not.toBeNull();
    expect(derived[1].groundSpeedKmh as number).toBeGreaterThan(0);
    expect(derived[1].cumulativeDistanceKm).toBeGreaterThan(0);
  });

  it('computes vario from altitude deltas', () => {
    const fixes = [
      makeFix({ timeMs: 0, pressureAltitudeM: 1000 }),
      makeFix({ timeMs: 10_000, pressureAltitudeM: 1010 }),
    ];
    const derived = computeDerivedMetrics(fixes, 'pressure');
    expect(derived[1].verticalSpeedMs).toBeCloseTo(1, 5);
  });

  it('accumulates distance monotonically', () => {
    const fixes = [
      makeFix({ timeMs: 0, latitude: 45.0, longitude: 6.0 }),
      makeFix({ timeMs: 10_000, latitude: 45.001, longitude: 6.0 }),
      makeFix({ timeMs: 20_000, latitude: 45.002, longitude: 6.0 }),
    ];
    const derived = computeDerivedMetrics(fixes, 'pressure');
    expect(derived[2].cumulativeDistanceKm).toBeGreaterThan(
      derived[1].cumulativeDistanceKm,
    );
  });
});
