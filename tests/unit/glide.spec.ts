import { describe, expect, it } from 'vitest';
import { checkGlideToLz, maxGlideDistanceM } from '../../src/domain/glide';
import type { ElevationGrid } from '../../src/domain/elevation';
import type { LandingZone } from '../../src/domain/landingZone';

const FLAT_GRID: ElevationGrid = {
  bbox: [0, 40, 20, 50],
  cols: 3,
  rows: 3,
  resolutionM: 100000,
  data: new Float32Array(9).fill(0), // sea level everywhere
  crs: 'EPSG:4326',
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
    source: 'user',
  };
}

const PARAMS = {
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
};

describe('maxGlideDistanceM', () => {
  it('returns 0 when not enough altitude', () => {
    expect(maxGlideDistanceM(300, 0, 300, 20)).toBe(0);
  });

  it('scales with LD', () => {
    const d10 = maxGlideDistanceM(2300, 0, 300, 10);
    const d20 = maxGlideDistanceM(2300, 0, 300, 20);
    expect(d20).toBeCloseTo(d10 * 2, 0);
  });

  it('produces 40 km for 2300m alt, 0m LZ, 300m arrival, LD20', () => {
    expect(maxGlideDistanceM(2300, 0, 300, 20)).toBeCloseTo(40000, 0);
  });
});

describe('checkGlideToLz', () => {
  it('marks a nearby low LZ as reachable from high altitude', () => {
    // 2300 m alt, LZ at sea level 10 km away ≈ 10000/20 = 500 m needed.
    // Required = 0 + 300 + 10000/20 = 800 m. Margin = 2300-800 = 1500 m → reachable.
    const testLz = lz(43.0, 6.09); // ~10 km east of 6.0
    const result = checkGlideToLz(43.0, 6.0, 2300, testLz, PARAMS, FLAT_GRID);
    expect(result.reachable).toBe(true);
    expect(result.marginM).toBeGreaterThan(0);
  });

  it('marks a very distant LZ as not reachable', () => {
    // LZ 200 km away: required = 0 + 300 + 200000/20 = 10300 m > 2300 m
    const farLz = lz(43.0, 8.0); // ~170+ km east
    const result = checkGlideToLz(43.0, 6.0, 2300, farLz, PARAMS, FLAT_GRID);
    expect(result.reachable).toBe(false);
  });

  it('fails terrain check when mountain blocks path', () => {
    // Grid with a high central cell simulating a mountain
    const data = new Float32Array(9).fill(0);
    data[4] = 3000; // center cell = 3000 m
    const mountainGrid: ElevationGrid = {
      bbox: [5.9, 42.9, 6.1, 43.1],
      cols: 3,
      rows: 3,
      resolutionM: 10000,
      data,
      crs: 'EPSG:4326',
    };

    const nearLz = lz(43.0, 6.08, 0);
    // Glider at 2000 m to the west, LZ to the east — mountain in the middle
    const result = checkGlideToLz(43.0, 5.92, 2000, nearLz, PARAMS, mountainGrid);
    expect(result.reachable).toBe(false);
  });
});
