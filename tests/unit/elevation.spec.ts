import { describe, expect, it } from 'vitest';
import {
  buildGridPoints,
  projectWgs84ToEpsg3035,
  sampleElevation,
} from '../../src/domain/elevation';
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
  return {
    bbox: [minLon, minLat, maxLon, maxLat],
    cols,
    rows,
    resolutionM: 90,
    data,
    crs: 'EPSG:4326',
  };
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

describe('projectWgs84ToEpsg3035', () => {
  it('maps the projection origin (52°N, 10°E) to (FE, FN)', () => {
    const { x, y } = projectWgs84ToEpsg3035(52, 10);
    expect(x).toBeCloseTo(4321000, 0);
    expect(y).toBeCloseTo(3210000, 0);
  });

  it('maps a Massif Central point into the expected EU_DTM tile range', () => {
    // From a real EU_DTM request centered near (45.5°N, 3.3°E), the returned
    // raster bbox was around [3782370, 2497660, 3809760, 2532100].
    const { x, y } = projectWgs84ToEpsg3035(45.5, 3.3);
    expect(x).toBeGreaterThan(3_780_000);
    expect(x).toBeLessThan(3_810_000);
    expect(y).toBeGreaterThan(2_490_000);
    expect(y).toBeLessThan(2_540_000);
  });
});

describe('sampleElevation on an EPSG:3035 grid', () => {
  it('projects WGS84 input and returns the interpolated value', () => {
    // 2×2 grid covering the EU_DTM extent around Massif Central, uniform 900 m.
    const grid: ElevationGrid = {
      bbox: [3_780_000, 2_490_000, 3_810_000, 2_540_000],
      cols: 2,
      rows: 2,
      resolutionM: 25,
      data: new Float32Array([900, 900, 900, 900]),
      crs: 'EPSG:3035',
    };
    expect(sampleElevation(grid, 45.5, 3.3)).toBeCloseTo(900, 3);
  });

  it('returns NaN for a point whose projection falls outside the bbox', () => {
    const grid: ElevationGrid = {
      bbox: [3_780_000, 2_490_000, 3_810_000, 2_540_000],
      cols: 2,
      rows: 2,
      resolutionM: 25,
      data: new Float32Array([900, 900, 900, 900]),
      crs: 'EPSG:3035',
    };
    // A point well outside Europe projects far from this tile.
    expect(sampleElevation(grid, 0, 0)).toBeNaN();
  });
});

describe('buildGridPoints', () => {
  it('returns the expected number of points', () => {
    // ~50×50 km bbox at 5000 m resolution → small grid
    const { points, cols, rows } = buildGridPoints([5, 43, 7, 45], 5000, 10000);
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
