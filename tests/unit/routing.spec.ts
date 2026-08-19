import { describe, expect, it } from 'vitest';
import type { ElevationGrid } from '../../src/domain/elevation';
import { routeToLz } from '../../src/domain/routing/routeToLz';
import { thetaStar, type GridPoint } from '../../src/domain/routing/thetaStar';
import { haversineDistanceM } from '../../src/domain/units';

// A flat sea-level grid — routing should never need to detour.
const FLAT_GRID: ElevationGrid = {
  bbox: [5, 44, 7, 46],
  cols: 33,
  rows: 33,
  resolutionM: 6_000,
  data: new Float32Array(33 * 33).fill(0),
  crs: 'EPSG:4326',
};

/**
 * Grid with a north–south ridge (a full row of tall cells across the
 * middle of the grid) between the source in the west and the LZ in the
 * east. A pilot at moderate altitude must fly around it.
 */
function ridgeGrid(): ElevationGrid {
  const cols = 41;
  const rows = 41;
  const data = new Float32Array(cols * rows).fill(0);
  const ridgeCol = Math.floor(cols / 2);
  for (let r = 5; r < rows - 5; r++) {
    data[r * cols + ridgeCol] = 3_000;
    data[r * cols + ridgeCol + 1] = 3_000;
    data[r * cols + ridgeCol - 1] = 3_000;
  }
  return {
    bbox: [5, 44, 7, 46],
    cols,
    rows,
    resolutionM: 5_000,
    data,
    crs: 'EPSG:4326',
  };
}

describe('thetaStar', () => {
  it('finds a straight path on an open grid', () => {
    const start: GridPoint = { r: 0, c: 0 };
    const goal: GridPoint = { r: 5, c: 5 };
    const path = thetaStar({
      rows: 10,
      cols: 10,
      start,
      goal,
      lineOfSight: () => true,
      cost: (a, b) => Math.hypot(a.r - b.r, a.c - b.c),
      heuristic: (p) => Math.hypot(p.r - goal.r, p.c - goal.c),
    });
    expect(path).not.toBeNull();
    // Any-angle: with full LOS the smoothed path should be just start+goal.
    expect(path!.length).toBe(2);
    expect(path![0]).toEqual(start);
    expect(path![path!.length - 1]).toEqual(goal);
  });

  it('routes around a horizontal wall', () => {
    // Wall of blocked cells across row 5, with a single gap at column 0.
    const wallRow = 5;
    const gapCol = 0;
    const start: GridPoint = { r: 0, c: 9 };
    const goal: GridPoint = { r: 9, c: 9 };
    const path = thetaStar({
      rows: 10,
      cols: 10,
      start,
      goal,
      // LOS from a→b is blocked if the segment crosses the wall row and
      // does not pass through the gap column.
      lineOfSight: (a, b) => {
        const steps = Math.max(1, Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) * 4);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const rr = a.r + t * (b.r - a.r);
          const cc = a.c + t * (b.c - a.c);
          if (Math.abs(rr - wallRow) < 0.5 && Math.abs(cc - gapCol) > 0.5) {
            return false;
          }
        }
        return true;
      },
      cost: (a, b) => Math.hypot(a.r - b.r, a.c - b.c),
      heuristic: (p) => Math.hypot(p.r - goal.r, p.c - goal.c),
      maxExpanded: 5_000,
    });
    expect(path).not.toBeNull();
    // The path must pass near the gap (column 0).
    const minCol = Math.min(...path!.map((p) => p.c));
    expect(minCol).toBeLessThanOrEqual(1);
  });
});

describe('routeToLz', () => {
  it('degenerates to the straight-line segment on flat terrain', () => {
    const result = routeToLz({
      sourceLat: 44.5,
      sourceLon: 5.5,
      sourceAltM: 10_000,
      targetLat: 45.5,
      targetLon: 6.5,
      workingLD: 30,
      groundClearanceM: 100,
      grid: FLAT_GRID,
    });
    expect(result).not.toBeNull();
    expect(result!.isStraightLine).toBe(true);
    expect(result!.path.length).toBe(2);
    const straight = haversineDistanceM(44.5, 5.5, 45.5, 6.5);
    expect(Math.abs(result!.distanceM - straight)).toBeLessThan(1);
  });

  it('finds a detour around a ridge that blocks the straight glide', () => {
    const grid = ridgeGrid();
    // Source in the west, LZ in the east, altitude just enough that a
    // straight glide clips the 3000 m ridge but a north/south detour fits.
    const result = routeToLz({
      sourceLat: 45,
      sourceLon: 5.2,
      sourceAltM: 3300,
      targetLat: 45,
      targetLon: 6.8,
      workingLD: 30,
      groundClearanceM: 100,
      grid,
    });

    // Either a detour was found, or terrain is truly impassable — in this
    // test we set up altitude so a route should exist.
    if (result === null) {
      // The routing has to at least *attempt* a detour; a null result
      // means it gave up before finding one. That's a regression.
      throw new Error('expected a routed path around the ridge, got null');
    }
    expect(result.isStraightLine).toBe(false);
    // A routed detour should be longer than the straight line.
    const straight = haversineDistanceM(45, 5.2, 45, 6.8);
    expect(result.distanceM).toBeGreaterThan(straight);
    // Arrival altitude follows distance / L/D — verify the arithmetic.
    expect(result.arrivalAltitudeM).toBeCloseTo(
      3300 - result.distanceM / 30,
      3,
    );
  });
});
