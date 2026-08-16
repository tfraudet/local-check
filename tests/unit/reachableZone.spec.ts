import { describe, expect, it } from 'vitest';
import {
  computeReachableZone,
  resolveEffectiveParams,
  REACHABLE_ZONE_CELL_CAP,
  DEFAULT_REACHABLE_ZONE_PARAMS,
  buildCellPolygons,
  type ReachableZoneGridSizeM,
} from '../../src/domain/reachableZone';
import type { ElevationGrid } from '../../src/domain/elevation';

const FLAT_GRID: ElevationGrid = {
  bbox: [5, 42, 7, 44],
  cols: 5,
  rows: 5,
  resolutionM: 40000,
  data: new Float32Array(25).fill(0),
  crs: 'EPSG:4326',
};

const PARAMS = {
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
  timeStepS: 20,
  enlThreshold: 500,
};

describe('resolveEffectiveParams', () => {
  it('leaves defaults untouched when within the cap', () => {
    const { effective, degraded } = resolveEffectiveParams(
      DEFAULT_REACHABLE_ZONE_PARAMS,
    );
    expect(effective).toEqual(DEFAULT_REACHABLE_ZONE_PARAMS);
    expect(degraded).toBe(false);
  });

  it('bumps grid size when the requested one exceeds the cap', () => {
    // 90 m grid over 60 km diameter ≈ 668 x 668 ≈ 446k cells, way over cap.
    const { effective, degraded } = resolveEffectiveParams({
      gridSizeM: 90 as ReachableZoneGridSizeM,
      diameterKm: 60,
    });
    expect(degraded).toBe(true);
    expect(effective.gridSizeM).toBeGreaterThan(90);
    // Effective cell count should be at or below the cap.
    const n =
      Math.ceil((effective.diameterKm * 1000) / effective.gridSizeM) + 1;
    expect(n * n).toBeLessThanOrEqual(REACHABLE_ZONE_CELL_CAP);
  });

  it('clamps out-of-range diameter to the allowed band', () => {
    const { effective } = resolveEffectiveParams({
      gridSizeM: 360 as ReachableZoneGridSizeM,
      diameterKm: 999,
    });
    expect(effective.diameterKm).toBeLessThanOrEqual(60);
  });
});

describe('computeReachableZone', () => {
  it('produces a roughly circular reachable set on flat terrain', () => {
    // Altitude tuned so the reachable disc lies well inside the sampled
    // circle. With arrivalHeight=300 and workingLD=20, usable altitude
    // = 500-300 = 200 m, reachable radius ≈ 200 × 20 = 4 km — well
    // inside the 40 km diameter (20 km radius) footprint.
    const result = computeReachableZone({
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 500,
      grid: FLAT_GRID,
      params: PARAMS,
      zoneParams: { gridSizeM: 720, diameterKm: 40 },
    });
    // Some cells should be reachable, some not (edges of the disc).
    let reachableCount = 0;
    for (let i = 0; i < result.reachableMask.length; i++) {
      if (result.reachableMask[i]) reachableCount += 1;
    }
    expect(reachableCount).toBeGreaterThan(0);
    expect(reachableCount).toBeLessThan(result.reachableMask.length);
    // The centre cell (approx sourceLat/sourceLon) must be reachable.
    const centreR = Math.floor(result.rows / 2);
    const centreC = Math.floor(result.cols / 2);
    expect(result.reachableMask[centreR * result.cols + centreC]).toBe(1);
  });

  it('reports no reachable cells when altitude is below ground', () => {
    const result = computeReachableZone({
      sourceLat: 43.0,
      sourceLon: 6.0,
      // Source below flat-ground level → arrival at any cell < 0.
      // Ground clearance is not applied to status anymore, so the source
      // must actually be underground for zero cells to be reachable.
      sourceAltM: -50,
      grid: FLAT_GRID,
      params: PARAMS,
      zoneParams: { gridSizeM: 720, diameterKm: 40 },
    });
    for (let i = 0; i < result.reachableMask.length; i++) {
      expect(result.reachableMask[i]).toBe(0);
    }
    expect(result.cellPolygons).toHaveLength(0);
  });

  it('degrades resolution to stay within the cell cap', () => {
    const result = computeReachableZone({
      sourceLat: 43.0,
      sourceLon: 6.0,
      sourceAltM: 2000,
      grid: FLAT_GRID,
      params: PARAMS,
      zoneParams: { gridSizeM: 90 as ReachableZoneGridSizeM, diameterKm: 60 },
    });
    expect(result.degraded).toBe(true);
    expect(result.cols * result.rows).toBeLessThanOrEqual(
      REACHABLE_ZONE_CELL_CAP,
    );
  });
});

describe('buildCellPolygons', () => {
  it('emits one closed quad per reachable cell', () => {
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const polys = buildCellPolygons(mask, 3, 3, 0, 0, 1, 1);
    expect(polys).toHaveLength(1);
    const ring = polys[0];
    // Rectangular ring: 5 vertices (first === last).
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('emits nothing when the mask is empty', () => {
    const mask = new Uint8Array(9);
    expect(buildCellPolygons(mask, 3, 3, 0, 0, 1, 1)).toHaveLength(0);
  });
});
