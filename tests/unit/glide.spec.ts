import { describe, expect, it } from 'vitest';
import { glideClearsTerrain } from '../../src/domain/glide';
import type { ElevationGrid } from '../../src/domain/elevation';

const FLAT_GRID: ElevationGrid = {
  bbox: [0, 40, 20, 50],
  cols: 3,
  rows: 3,
  resolutionM: 100000,
  data: new Float32Array(9).fill(0), // sea level everywhere
  crs: 'EPSG:4326',
};

function mountainGrid(): ElevationGrid {
  const data = new Float32Array(9).fill(0);
  data[4] = 3000; // center cell = 3000 m
  return {
    bbox: [5.9, 42.9, 6.1, 43.1],
    cols: 3,
    rows: 3,
    resolutionM: 10000,
    data,
    crs: 'EPSG:4326',
  };
}

describe('glideClearsTerrain', () => {
  it('clears flat sea-level terrain from high altitude', () => {
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 6,
        fromAltM: 2300,
        toLat: 43,
        toLon: 6.09,
        distanceM: 10000,
        workingLD: 20,
        grid: FLAT_GRID,
      }),
    ).toBe(true);
  });

  it('fails when the glide plane sinks below flat terrain', () => {
    // 200 km at LD 20 needs 10000 m of height; we only have 2300 m.
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 6,
        fromAltM: 2300,
        toLat: 43,
        toLon: 8,
        distanceM: 200000,
        workingLD: 20,
        grid: FLAT_GRID,
      }),
    ).toBe(false);
  });

  it('fails when a mountain blocks the path', () => {
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 5.92,
        fromAltM: 2000,
        toLat: 43,
        toLon: 6.08,
        distanceM: 13000,
        workingLD: 20,
        grid: mountainGrid(),
      }),
    ).toBe(false);
  });

  it('honours the ground-clearance buffer', () => {
    const data = new Float32Array(9).fill(1000);
    const plateau: ElevationGrid = { ...FLAT_GRID, data };
    const query = {
      fromLat: 43,
      fromLon: 6,
      fromAltM: 1100,
      toLat: 43,
      toLon: 6.09,
      distanceM: 10000,
      workingLD: 100,
      grid: plateau,
    };
    expect(glideClearsTerrain(query)).toBe(true);
    expect(glideClearsTerrain({ ...query, groundClearanceM: 200 })).toBe(false);
  });

  // Regression: `sampleCount` used to be `max(1, ceil(dist / stepM))` while
  // the loop samples only the segment interior (s = 1 .. sampleCount-1). Any
  // segment at or below `stepM` therefore got zero samples and was reported
  // clear — which is precisely the grid-neighbour hop the routing
  // line-of-sight predicate asks about, so terrain avoidance silently
  // stopped working and escape paths were drawn through rock.
  it('still samples a segment shorter than the step', () => {
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 5.98,
        fromAltM: 500, // far below the 3000 m centre cell
        toLat: 43,
        toLon: 6.02,
        distanceM: 3_000,
        workingLD: 20,
        grid: mountainGrid(),
        stepM: 3_000, // one step covers the whole segment
      }),
    ).toBe(false);
  });

  it('never reports clear for a zero-sample step count', () => {
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 5.98,
        fromAltM: 500,
        toLat: 43,
        toLon: 6.02,
        distanceM: 3_000,
        workingLD: 20,
        grid: mountainGrid(),
        steps: 1,
      }),
    ).toBe(false);
  });

  it('accepts an explicit sample count', () => {
    expect(
      glideClearsTerrain({
        fromLat: 43,
        fromLon: 5.92,
        fromAltM: 2000,
        toLat: 43,
        toLon: 6.08,
        distanceM: 13000,
        workingLD: 20,
        grid: mountainGrid(),
        steps: 10,
      }),
    ).toBe(false);
  });
});
