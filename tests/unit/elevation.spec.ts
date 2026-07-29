import { describe, expect, it } from 'vitest';
import { buildGridPoints, sampleElevation } from '../../src/domain/elevation';
import type { ElevationGrid } from '../../src/domain/elevation';

function makeGrid(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  cols: number,
  rows: number,
  fillFn: (r: number, c: number) => number = () => 100,
): ElevationGrid {
  const data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      data[r * cols + c] = fillFn(r, c);
    }
  }
  return { bbox: [minLon, minLat, maxLon, maxLat], cols, rows, resolutionM: 90, data };
}

describe('sampleElevation', () => {
  it('returns exact value at cell centers', () => {
    // 2×2 grid: NW=10, NE=20, SW=30, SE=40
    const grid = makeGrid(0, 0, 1, 1, 2, 2, (r, c) => {
      if (r === 0 && c === 0) return 30; // SW
      if (r === 0 && c === 1) return 40; // SE
      if (r === 1 && c === 0) return 10; // NW
      return 20; // NE
    });

    expect(sampleElevation(grid, 0, 0)).toBeCloseTo(30, 1); // SW corner
    expect(sampleElevation(grid, 1, 1)).toBeCloseTo(20, 1); // NE corner
    expect(sampleElevation(grid, 1, 0)).toBeCloseTo(10, 1); // NW corner
    expect(sampleElevation(grid, 0, 1)).toBeCloseTo(40, 1); // SE corner
  });

  it('returns interpolated value at grid center', () => {
    // Uniform 100 m → center should be 100
    const grid = makeGrid(0, 0, 2, 2, 3, 3, () => 100);
    expect(sampleElevation(grid, 1, 1)).toBeCloseTo(100, 3);
  });

  it('bilinearly interpolates between four corners', () => {
    // 2×2 grid corners: SW=0, SE=100, NW=0, NE=100 → mid-south = 50
    const grid = makeGrid(0, 0, 1, 1, 2, 2, (r, c) => (c === 1 ? 100 : 0));
    const midSouth = sampleElevation(grid, 0, 0.5);
    expect(midSouth).toBeCloseTo(50, 2);
  });

  it('returns NaN outside the bbox', () => {
    const grid = makeGrid(0, 0, 1, 1, 2, 2);
    expect(sampleElevation(grid, -0.1, 0.5)).toBeNaN();
    expect(sampleElevation(grid, 0.5, 1.1)).toBeNaN();
    expect(sampleElevation(grid, 2, 0.5)).toBeNaN();
  });
});

describe('buildGridPoints', () => {
  it('returns the expected number of points', () => {
    // ~50×50 km bbox at 5000 m resolution → small grid
    const { points, cols, rows } = buildGridPoints(
      [5, 43, 7, 45],
      5000,
      10000,
    );
    expect(points.length).toBe(cols * rows);
    expect(cols).toBeGreaterThanOrEqual(2);
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  it('respects the maxSamples cap', () => {
    const { points } = buildGridPoints([0, 0, 10, 10], 100, 500);
    expect(points.length).toBeLessThanOrEqual(500);
  });

  it('first point is near minLat / minLon', () => {
    const { points } = buildGridPoints([6, 43, 7, 44], 1000, 10000);
    expect(points[0].lat).toBeCloseTo(43, 2);
    expect(points[0].lon).toBeCloseTo(6, 2);
  });
});
