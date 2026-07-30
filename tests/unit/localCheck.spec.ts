import { describe, expect, it } from 'vitest';
import { runLocalCheck, DEFAULT_LOCAL_CHECK_PARAMS } from '../../src/domain/localCheck';
import type { LocalCheckInput } from '../../src/domain/localCheck';
import type { Fix } from '../../src/domain/flight';
import type { ElevationGrid } from '../../src/domain/elevation';
import type { LandingZone } from '../../src/domain/landingZone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLAT_GRID: ElevationGrid = {
  bbox: [5, 43, 8, 45],
  cols: 4,
  rows: 4,
  resolutionM: 90,
  data: new Float32Array(16).fill(0), // sea level everywhere
  crs: 'EPSG:4326',
};

function fix(timeMs: number, lat: number, lon: number, pressureAltitudeM: number): Fix {
  return {
    timeMs,
    latitude: lat,
    longitude: lon,
    pressureAltitudeM,
    gnssAltitudeM: pressureAltitudeM,
  };
}

const NEARBY_LZ: LandingZone = {
  id: 'lz-near',
  name: 'Near LZ',
  code: 'NLZ',
  latitude: 43.5,
  longitude: 6.01,
  elevationM: 0,
  style: 2,
  difficulty_level: 'green',
  description: null,
  isAirfield: true,
  source: 'user',
};

const PARAMS = { ...DEFAULT_LOCAL_CHECK_PARAMS };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runLocalCheck', () => {
  it('returns empty samples for an empty fixes array', () => {
    const input: LocalCheckInput = {
      fixes: [],
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      phases: [],
      params: PARAMS,
    };
    const result = runLocalCheck(input);
    expect(result.samples).toHaveLength(0);
    expect(result.stats.outOfLocalTimeMs).toBe(0);
  });

  it('classifies high-altitude fix near LZ as in-local', () => {
    // At 2000 m, LZ 5 km away: required = 0 + 300 + 5000/20 = 550 m → margin 1450 m → in-local
    const fixes = Array.from({ length: 5 }, (_, i) =>
      fix(i * PARAMS.timeStepS * 1000, 43.5, 6.05, 2000),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      phases: new Array(5).fill('cruise'),
      params: PARAMS,
    };
    const result = runLocalCheck(input);
    expect(result.samples.length).toBeGreaterThan(0);
    const statuses = result.samples.map((s) => s.status);
    expect(statuses.every((s) => s === 'in-local')).toBe(true);
  });

  it('classifies low-altitude fix far from LZ as out-of-local', () => {
    // LZ is at 6.01°E, glider is at 6.0°E and only 200 m altitude.
    // required = 0 + 300 + dist/20 > 200 → out-of-local
    const lzFar: LandingZone = { ...NEARBY_LZ, latitude: 45.0, longitude: 7.0, elevationM: 0 };
    const fixes = Array.from({ length: 5 }, (_, i) =>
      fix(i * PARAMS.timeStepS * 1000, 43.0, 6.0, 200),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [lzFar],
      phases: new Array(5).fill('cruise'),
      params: PARAMS,
    };
    const result = runLocalCheck(input);
    const outSamples = result.samples.filter((s) => s.status === 'out-of-local');
    expect(outSamples.length).toBeGreaterThan(0);
    expect(result.stats.outOfLocalTimeMs).toBeGreaterThan(0);
  });

  it('computes missingHeightM as positive value when out of local', () => {
    const lzFar: LandingZone = { ...NEARBY_LZ, latitude: 45.0, longitude: 7.0, elevationM: 0 };
    const fixes = [fix(0, 43.0, 6.0, 200)];
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [lzFar],
      phases: ['cruise'],
      params: PARAMS,
    };
    const result = runLocalCheck(input);
    const sample = result.samples[0];
    if (sample) {
      expect(sample.missingHeightM).toBeGreaterThan(0);
    }
  });

  it('respects timeStepS sampling interval', () => {
    // 10 fixes at 1s apart, timeStepS = 5 → should produce ~2 samples
    const fixes = Array.from({ length: 10 }, (_, i) =>
      fix(i * 1000, 43.5, 6.05, 2000),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      phases: new Array(10).fill('cruise'),
      params: { ...PARAMS, timeStepS: 5 },
    };
    const result = runLocalCheck(input);
    // 0s, 5s → 2 samples at most (0 and 5000ms)
    expect(result.samples.length).toBeLessThanOrEqual(2);
  });
});
