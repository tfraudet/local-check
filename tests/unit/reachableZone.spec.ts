import { describe, expect, it } from 'vitest';
import {
  computeReachableZone,
  resolveEffectiveParams,
  finestUsefulGridSizeM,
  maxDiameterKmForGridSize,
  recommendedReachableZoneParams,
  REACHABLE_ZONE_CELL_CAP,
  REACHABLE_ZONE_GRID_SIZES,
  REACHABLE_ZONE_MIN_DIAMETER_KM,
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

describe('finestUsefulGridSizeM', () => {
  // The resolutions the elevation backends actually produce: they start at
  // 1 arcsec (~31 m) and double the step until the grid fits their sample
  // budget, so only powers of two of 31 m ever appear.
  it.each([
    [62, 90], // local flight
    [124, 180], // ~100 km XC
    [247, 360], // most XC
    [494, 720], // very long XC
  ])('maps a %i m DEM to a %i m grid', (demResolutionM, expected) => {
    expect(finestUsefulGridSizeM(demResolutionM)).toBe(expected);
  });

  it('never returns a size below the DEM resolution', () => {
    for (const dem of [31, 62, 100, 124, 200, 247, 359, 494]) {
      expect(finestUsefulGridSizeM(dem)).toBeGreaterThanOrEqual(
        Math.min(dem, REACHABLE_ZONE_GRID_SIZES[0]),
      );
    }
  });

  it('falls back to the coarsest size for a DEM coarser than every option', () => {
    expect(finestUsefulGridSizeM(5000)).toBe(720);
  });

  it('falls back to the default for a missing or absurd resolution', () => {
    expect(finestUsefulGridSizeM(NaN)).toBe(
      DEFAULT_REACHABLE_ZONE_PARAMS.gridSizeM,
    );
    expect(finestUsefulGridSizeM(0)).toBe(
      DEFAULT_REACHABLE_ZONE_PARAMS.gridSizeM,
    );
  });
});

describe('maxDiameterKmForGridSize', () => {
  it('produces a diameter that resolveEffectiveParams never degrades', () => {
    for (const gridSizeM of REACHABLE_ZONE_GRID_SIZES) {
      const diameterKm = maxDiameterKmForGridSize(gridSizeM);
      const { effective, degraded } = resolveEffectiveParams({
        gridSizeM,
        diameterKm,
      });
      expect(effective).toEqual({ gridSizeM, diameterKm });
      expect(degraded).toBe(false);
    }
  });

  it('is the largest step-aligned diameter that fits the cap', () => {
    for (const gridSizeM of REACHABLE_ZONE_GRID_SIZES) {
      const diameterKm = maxDiameterKmForGridSize(gridSizeM);
      const cellsFor = (dKm: number) => {
        const n = Math.ceil((dKm * 1000) / gridSizeM) + 1;
        return n * n;
      };
      expect(cellsFor(diameterKm)).toBeLessThanOrEqual(REACHABLE_ZONE_CELL_CAP);
      // One step further is either over the cap or past the offered maximum.
      const next = diameterKm + 5;
      expect(next > 60 || cellsFor(next) > REACHABLE_ZONE_CELL_CAP).toBe(true);
    }
  });

  it('never drops below the minimum diameter', () => {
    expect(maxDiameterKmForGridSize(1)).toBe(REACHABLE_ZONE_MIN_DIAMETER_KM);
  });
});

describe('recommendedReachableZoneParams', () => {
  it('gives a local flight the finest grid its DEM supports', () => {
    expect(recommendedReachableZoneParams(62, 40)).toEqual({
      gridSizeM: 90,
      diameterKm: 25, // clamped: 90 m over 40 km would blow the cell cap
    });
  });

  it('keeps the default grid for a typical XC DEM', () => {
    expect(recommendedReachableZoneParams(247, 40)).toEqual({
      gridSizeM: 360,
      diameterKm: 40,
    });
  });

  it('preserves a diameter that already fits', () => {
    expect(recommendedReachableZoneParams(247, 20).diameterKm).toBe(20);
  });

  it('is a fixed point of resolveEffectiveParams for every DEM resolution', () => {
    for (const dem of [31, 62, 124, 247, 494, 1000]) {
      for (const requested of [10, 20, 40, 60]) {
        const params = recommendedReachableZoneParams(dem, requested);
        expect(resolveEffectiveParams(params).degraded).toBe(false);
      }
    }
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

/**
 * ~110 m DEM, flat at sea level except one north–south ridge of height
 * `crestM` and width `widthDeg` at lon 6.05 — about 4 km east of a source
 * placed at (43, 6).
 */
function ridgeDem(crestM: number, widthDeg: number): ElevationGrid {
  const stepDeg = 1 / 1000;
  const minLon = 5.8;
  const minLat = 42.8;
  const cols = 401;
  const rows = 401;
  const data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lon = minLon + c * stepDeg;
      data[r * cols + c] = Math.abs(lon - 6.05) <= widthDeg / 2 ? crestM : 0;
    }
  }
  return {
    bbox: [
      minLon,
      minLat,
      minLon + (cols - 1) * stepDeg,
      minLat + (rows - 1) * stepDeg,
    ],
    cols,
    rows,
    resolutionM: 110,
    data,
    crs: 'EPSG:4326',
  };
}

function isReachableAt(
  zone: ReturnType<typeof computeReachableZone>,
  lat: number,
  lon: number,
): boolean {
  const [minLon, minLat, maxLon, maxLat] = zone.bbox;
  const r = Math.round(
    (lat - minLat) / ((maxLat - minLat) / (zone.rows - 1)),
  );
  const c = Math.round(
    (lon - minLon) / ((maxLon - minLon) / (zone.cols - 1)),
  );
  return zone.reachableMask[r * zone.cols + c] === 1;
}

describe('computeReachableZone terrain clearance', () => {
  // Regression: the per-cell ray used to omit `groundClearanceM` entirely,
  // while the terrain-aware Dijkstra pass applied it — so cells in direct
  // view were held to a laxer standard than cells behind a ridge.
  it('applies the ground-clearance buffer to the direct ray', () => {
    // Crest 2000 m, 4 km east. At 2250 m and L/D 20 the ray passes the crest
    // at 2050 m — 50 m of clearance, against a 150 m setting.
    for (const terrainAwareRouting of [false, true]) {
      const zone = computeReachableZone({
        sourceLat: 43,
        sourceLon: 6,
        sourceAltM: 2250,
        grid: ridgeDem(2000, 0.01),
        params: { ...PARAMS, arrivalHeightM: 0 },
        zoneParams: { gridSizeM: 180, diameterKm: 20 },
        terrainAwareRouting,
      });
      expect(isReachableAt(zone, 43, 6.09)).toBe(false);
    }
  });

  // Regression: the ray took a fixed 10 samples whatever the range, so on a
  // 9 km ray they sat ~900 m apart and a whole ridge could fall between two.
  it('does not step over a narrow ridge', () => {
    for (const widthDeg of [0.04, 0.004]) {
      const zone = computeReachableZone({
        sourceLat: 43,
        sourceLon: 6,
        sourceAltM: 1500,
        grid: ridgeDem(3000, widthDeg),
        params: { ...PARAMS, arrivalHeightM: 0 },
        zoneParams: { gridSizeM: 180, diameterKm: 20 },
        terrainAwareRouting: true,
      });
      // The glider is 1500 m below the crest: nothing beyond it is reachable,
      // by any path, at any ridge width.
      expect(isReachableAt(zone, 43, 6.09)).toBe(false);
    }
  });

  it('never reports a routed arrival better than the direct glide', () => {
    // Source deliberately off-lattice, flat terrain: the routed pass must not
    // gain distance from snapping its origin to the nearest cell centre.
    const zone = computeReachableZone({
      sourceLat: 43.0007,
      sourceLon: 6.0007,
      sourceAltM: 3000,
      grid: ridgeDem(0, 0),
      params: PARAMS,
      zoneParams: { gridSizeM: 180, diameterKm: 20 },
      terrainAwareRouting: true,
    });
    const straight = computeReachableZone({
      sourceLat: 43.0007,
      sourceLon: 6.0007,
      sourceAltM: 3000,
      grid: ridgeDem(0, 0),
      params: PARAMS,
      zoneParams: { gridSizeM: 180, diameterKm: 20 },
      terrainAwareRouting: false,
    });
    const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
    expect(count(zone.reachableMask)).toBe(count(straight.reachableMask));
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
