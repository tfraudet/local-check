import { describe, expect, it } from 'vitest';
import type { ElevationGrid } from '../../src/domain/elevation';
import {
  polylineClearsTerrain,
  routeToLz,
} from '../../src/domain/routing/routeToLz';
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
 * Grid with a north–south ridge between the source in the west and the LZ
 * in the east. The ridge is *finite* — ~2 km wide, ~11 km tall, centred on
 * lat 45 — so a pilot with enough altitude can round its northern or
 * southern tip, and both tips sit inside the routing search bbox (which only
 * inflates the source→LZ box by half the straight-line distance). A ridge
 * spanning the whole grid would make the LZ unreachable, not detour-able.
 *
 * 201 × 201 cells over 1° × 1° → ~550 m lat / ~390 m lon steps.
 */
const RIDGE_ALT_M = 3_000;

function ridgeGrid(): ElevationGrid {
  const cols = 201;
  const rows = 201;
  const data = new Float32Array(cols * rows).fill(0);
  const stepDeg = 1 / 200;
  const colOf = (lon: number) => Math.round((lon - 5) / stepDeg);
  const rowOf = (lat: number) => Math.round((lat - 44.5) / stepDeg);
  for (let r = rowOf(44.95); r <= rowOf(45.05); r++) {
    for (let c = colOf(5.49); c <= colOf(5.51); c++) {
      data[r * cols + c] = RIDGE_ALT_M;
    }
  }
  return {
    bbox: [5, 44.5, 6, 45.5],
    cols,
    rows,
    resolutionM: 500,
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
    // Source in the west, LZ in the east, altitude chosen so the straight
    // glide clips the 3000 m ridge but rounding its northern tip fits.
    const result = routeToLz({
      sourceLat: 45,
      sourceLon: 5.3,
      sourceAltM: 3_400,
      targetLat: 45,
      targetLon: 5.7,
      workingLD: 30,
      groundClearanceM: 100,
      grid,
    });

    if (result === null) {
      throw new Error('expected a routed path around the ridge, got null');
    }
    expect(result.isStraightLine).toBe(false);
    // A routed detour should be longer than the straight line.
    const straight = haversineDistanceM(45, 5.3, 45, 5.7);
    expect(result.distanceM).toBeGreaterThan(straight);
    // Arrival altitude follows distance / L/D — verify the arithmetic.
    expect(result.arrivalAltitudeM).toBeCloseTo(
      3_400 - result.distanceM / 30,
      3,
    );
  });

  // Regression: `glideClearsTerrain` used to take zero samples on segments
  // shorter than its step, and the routing LOS predicate used to step at the
  // *search cell* size — so every grid-neighbour hop was declared clear and
  // Theta* degenerated into shortest-path-through-rock.
  it('never returns a path that cuts through terrain', () => {
    const grid = ridgeGrid();
    for (const sourceAltM of [1_500, 2_000, 2_500, 3_000, 3_300, 3_600, 4_500]) {
      const result = routeToLz({
        sourceLat: 45,
        sourceLon: 5.3,
        sourceAltM,
        targetLat: 45,
        targetLon: 5.7,
        workingLD: 30,
        groundClearanceM: 100,
        grid,
      });
      if (!result) continue;
      expect(
        polylineClearsTerrain(result.path, sourceAltM, 30, 100, grid, 100),
      ).toBe(true);
    }
  });

  it('returns null when the ridge is genuinely out of reach', () => {
    // 3300 m with L/D 30 buys 6 km of glide above the 3100 m crest
    // requirement, but the ridge is 59 km away — no route exists.
    const cols = 41;
    const rows = 41;
    const data = new Float32Array(cols * rows).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 19; c <= 21; c++) data[r * cols + c] = 3_000;
    }
    const result = routeToLz({
      sourceLat: 45,
      sourceLon: 5.2,
      sourceAltM: 3_300,
      targetLat: 45,
      targetLon: 6.8,
      workingLD: 30,
      groundClearanceM: 100,
      grid: {
        bbox: [5, 44, 7, 46],
        cols,
        rows,
        resolutionM: 5_000,
        data,
        crs: 'EPSG:4326',
      },
    });
    expect(result).toBeNull();
  });
});
