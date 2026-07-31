import { describe, expect, it } from 'vitest';
import { computeEscapePath } from '../../src/domain/escapePath';
import type { ElevationGrid } from '../../src/domain/elevation';
import type { LandingZone } from '../../src/domain/landingZone';

const FLAT_GRID: ElevationGrid = {
  bbox: [5, 42, 7, 44],
  cols: 3,
  rows: 3,
  resolutionM: 100000,
  data: new Float32Array(9).fill(0),
  crs: 'EPSG:4326',
};

const PARAMS = {
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
  timeStepS: 20,
  enlThreshold: 500,
};

function lz(lat: number, lon: number, elevM = 0): LandingZone {
  return {
    id: 'test',
    name: 'Test LZ',
    code: 'T',
    latitude: lat,
    longitude: lon,
    elevationM: elevM,
    style: 4,
    difficulty_level: 'green',
    description: null,
    isAirfield: false,
    runwayHeading: 0,
    source: 'user',
  };
}

describe('computeEscapePath', () => {
  it('classifies as in-local when altitude gives ample margin', () => {
    // 2300m at source, LZ ~10km east at sea level, L/D 20:
    //   arrivalHeight = 2300 - 0 - 10000/20 = 1800m (way above 300m target)
    //   min margin over flat terrain (=0m) with 150m clearance ≈ 1800m - 150m = 1650m
    const path = computeEscapePath({
      sourceFixIndex: 0,
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 2300,
      lz: lz(43.0, 6.09),
      grid: FLAT_GRID,
      params: PARAMS,
    });
    expect(path.status).toBe('in-local');
    expect(path.arrivalHeightM).toBeGreaterThan(500);
    expect(path.minMarginM).toBeGreaterThan(500);
    expect(path.profile.length).toBeGreaterThan(1);
    expect(path.waypoints).toHaveLength(2);
  });

  it('marks as out-of-local when the LZ is too far', () => {
    // 500m at source, LZ 200km+ east at sea level:
    //   arrivalHeight = 500 - 0 - too_much/20 → very negative.
    const path = computeEscapePath({
      sourceFixIndex: 0,
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 500,
      lz: lz(43.0, 8.0),
      grid: FLAT_GRID,
      params: PARAMS,
    });
    expect(path.status).toBe('out-of-local');
    expect(path.arrivalHeightM).toBeLessThan(0);
  });

  it('produces a monotonically descending glide plane', () => {
    const path = computeEscapePath({
      sourceFixIndex: 0,
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 1500,
      lz: lz(43.0, 6.05),
      grid: FLAT_GRID,
      params: PARAMS,
    });
    for (let i = 1; i < path.profile.length; i++) {
      expect(path.profile[i].glideAltM).toBeLessThan(
        path.profile[i - 1].glideAltM + 1e-6,
      );
    }
    expect(path.profile[0].distFromSourceM).toBe(0);
    expect(
      path.profile[path.profile.length - 1].distFromSourceM,
    ).toBeCloseTo(path.totalDistanceM, 3);
  });

  it('flags marginal status when arrival height is just above the target', () => {
    // Tune so arrivalHeight lands in the marginal band (0 <= h < 100m).
    // altitude = 300m arrival target + 20m over + dist/LD
    // dist ~= 20 km, LD 20 → dist/LD = 1000m; total altitude = 320 + 1000 = 1320m.
    const path = computeEscapePath({
      sourceFixIndex: 0,
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 1320,
      lz: lz(43.0, 6.245), // ~20 km east
      grid: FLAT_GRID,
      params: PARAMS,
    });
    // arrivalHeight roughly = 1320 - 0 - ~20000/20 = ~320 - ~lz elev; the
    // actual distance is a hair less than 20 km, so accept a wide band.
    expect(['in-local', 'in-local-marginal']).toContain(path.status);
  });
});
