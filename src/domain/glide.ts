/**
 * Terrain-clearance primitive shared by the reachable-zone grid and any
 * other straight-line glide check.
 *
 * Arrival-height geometry and status classification live in `arrival.ts`;
 * this module only answers "does the glide plane stay above the terrain?".
 *
 * All functions are pure and framework-agnostic.
 */

import { sampleElevation } from './elevation';
import type { ElevationGrid } from './elevation';

/** Bounds on the terrain-sampling step used by clearance checks. Finer than
 * the DEM buys nothing; coarser than ~200 m starts stepping over ridge
 * crests, which is how a "cleared" glide ends up cutting rock. */
const MIN_TERRAIN_STEP_M = 50;
const MAX_TERRAIN_STEP_M = 200;

/**
 * Sampling step to use with `glideClearsTerrain` for a given DEM.
 *
 * Every caller should derive its step from this rather than from its own
 * working resolution (search-grid cell, reachable-zone cell, …): a coarse
 * working grid only costs precision, whereas coarse *terrain* sampling costs
 * safety — a 900 m step walks straight over a 300 m-wide ridge.
 */
export function terrainStepFor(grid: ElevationGrid): number {
  return Math.max(
    MIN_TERRAIN_STEP_M,
    Math.min(grid.resolutionM, MAX_TERRAIN_STEP_M),
  );
}

export interface GlideClearanceQuery {
  fromLat: number;
  fromLon: number;
  fromAltM: number;
  toLat: number;
  toLon: number;
  /** Great-circle distance between the two points, in meters. Passed in
   * because callers have usually computed it already. */
  distanceM: number;
  workingLD: number;
  grid: ElevationGrid;
  /** Safety buffer added to the terrain height. Defaults to 0 — the buffer
   * is a display concept and must not gate status classification. */
  groundClearanceM?: number;
  /**
   * Sampling strategy along the ray. Either a fixed number of samples
   * (cheap, used per reachable-zone cell) or a distance step in meters
   * (accurate, used for single source→LZ queries). `steps` wins when both
   * are given. Defaults to a 200 m step.
   */
  steps?: number;
  stepM?: number;
}

/**
 * Sample terrain along the straight line from source to target and verify
 * the glide plane stays above `terrain + groundClearanceM` at every
 * sample. Points without terrain data are skipped.
 */
export function glideClearsTerrain(query: GlideClearanceQuery): boolean {
  const {
    fromLat,
    fromLon,
    fromAltM,
    toLat,
    toLon,
    distanceM,
    workingLD,
    grid,
    groundClearanceM = 0,
    steps,
    stepM = 200,
  } = query;

  // At least 2 slots, always. The loop below samples the *interior* of the
  // segment (s = 1 .. sampleCount-1), so a single slot yields zero samples
  // and the function reports "clear" for a segment flying straight into a
  // wall. That happens for every segment shorter than `stepM` — which is
  // exactly the grid-neighbour hops the routing LOS predicate asks about.
  const sampleCount = Math.max(2, steps ?? Math.ceil(distanceM / stepM));

  for (let s = 1; s < sampleCount; s++) {
    const t = s / sampleCount;
    const lat = fromLat + t * (toLat - fromLat);
    const lon = fromLon + t * (toLon - fromLon);

    const terrain = sampleElevation(grid, lat, lon);
    if (isNaN(terrain)) continue; // no terrain data — skip

    const glidePlaneAltM = fromAltM - (t * distanceM) / workingLD;
    if (glidePlaneAltM < terrain + groundClearanceM) return false;
  }

  return true;
}
