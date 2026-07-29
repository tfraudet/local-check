import { describe, expect, it } from 'vitest';
import { computeFlightPhases } from '../../src/domain/flightPhases';
import type { Fix, DerivedPoint } from '../../src/domain/flight';

function fix(timeMs: number, pressureAltitudeM: number, lat = 43, lon = 6): Fix {
  return { timeMs, latitude: lat, longitude: lon, pressureAltitudeM, gnssAltitudeM: pressureAltitudeM };
}

function derived(vario: number | null, agl: number | null = null): DerivedPoint {
  return { groundSpeedKmh: 80, verticalSpeedMs: vario, cumulativeDistanceKm: 0, terrainElevationM: null, aglM: agl };
}

describe('computeFlightPhases', () => {
  it('returns empty array for empty input', () => {
    expect(computeFlightPhases([], [], [], 'pressure')).toEqual([]);
  });

  it('marks initial strong climb as initial-climb', () => {
    const fixes = [
      fix(0, 400),
      fix(1000, 402),
      fix(2000, 404),
      fix(3000, 406),
    ];
    const derivedArr = [
      derived(null),
      derived(2.0),
      derived(2.0),
      derived(2.0),
    ];
    const phases = computeFlightPhases(fixes, derivedArr, [false, false, false, false], 'pressure');
    expect(phases[1]).toBe('initial-climb');
    expect(phases[2]).toBe('initial-climb');
  });

  it('marks cruise after level-off', () => {
    const fixes = [
      fix(0, 400),
      fix(1000, 402),
      fix(2000, 402), // level
      fix(3000, 402), // 10s level → stops initial climb
      fix(4000, 402),
    ];
    const derivedArr = [
      derived(null),
      derived(2.0),
      derived(0.0),
      derived(0.0),
      derived(0.0),
    ];
    const phases = computeFlightPhases(fixes, derivedArr, new Array(5).fill(false), 'pressure');
    // Later fixes should eventually be cruise
    expect(phases[4]).toBe('cruise');
  });

  it('marks motor phases via motorFlags (not during initial-climb)', () => {
    const fixes = [fix(0, 400), fix(1000, 400), fix(2000, 400)];
    const derivedArr = [derived(0), derived(0), derived(0)];
    const motorFlags = [false, true, false];
    const phases = computeFlightPhases(fixes, derivedArr, motorFlags, 'pressure');
    expect(phases[1]).toBe('motor');
    expect(phases[0]).toBe('cruise');
    expect(phases[2]).toBe('cruise');
  });

  it('marks landing circuit near the end at low AGL', () => {
    const lat0 = 43;
    const lon0 = 6;
    // Last few fixes are close to the landing spot at low AGL
    const fixes = [
      fix(0, 2000, lat0, lon0),
      fix(60000, 1500, lat0, lon0),
      fix(120000, 500, lat0 + 0.001, lon0 + 0.001),
      fix(180000, 200, lat0 + 0.002, lon0 + 0.002), // ~220 m AGL
      fix(240000, 150, lat0 + 0.002, lon0 + 0.002), // ~150 m AGL
    ];
    const derivedArr = [
      derived(0, 1500),
      derived(-0.5, 1000),
      derived(-1, 200),
      derived(-1, 100),
      derived(-0.5, 50),
    ];
    const phases = computeFlightPhases(fixes, derivedArr, new Array(5).fill(false), 'pressure');
    // Last two should be landing-circuit (low AGL near end)
    expect(phases[4]).toBe('landing-circuit');
  });
});
