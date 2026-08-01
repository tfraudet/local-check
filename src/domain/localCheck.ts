/**
 * Local-check classification algorithm.
 *
 * Samples the flight every timeStepS seconds and classifies each sample as
 * in-local, in-local-marginal, or out-of-local given the provided LZs,
 * terrain grid, and computation parameters.
 *
 * Designed to run inside a Web Worker (no DOM/React imports).
 */

import type { Fix } from './flight';
import type { ElevationGrid } from './elevation';
import { sampleElevation } from './elevation';
import type { LandingZone } from './landingZone';
import type { FlightPhase } from './flightPhases';
import {
  classifyArrival,
  pickBestLandingZone,
  type LocalStatus,
} from './arrival';
import { pickAltitude } from './units';

export interface LocalCheckParams {
  workingLD: number; // default 20
  arrivalHeightM: number; // default 300
  groundClearanceM: number; // default 150
  timeStepS: number; // default 20, min 10
  enlThreshold: number; // default 500
}

export const DEFAULT_LOCAL_CHECK_PARAMS: LocalCheckParams = {
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
  timeStepS: 20,
  enlThreshold: 500,
};

export type { LocalStatus };

export interface SampledPoint {
  timeMs: number;
  fixIndex: number;
  latitude: number;
  longitude: number;
  altitudeM: number;
  terrainElevationM: number | null;
  aglM: number | null;
  phase: FlightPhase;
  status: LocalStatus;
  bestLzId: string | null;
  /** Height missing to reach the best LZ: 0 when reachable, positive when
   * out-of-local, `null` when there is no LZ at all. */
  missingHeightM: number | null;
  marginAboveGlidePlaneM: number; // positive = in-local; negative = out
}

export interface LocalCheckResult {
  params: LocalCheckParams;
  samples: SampledPoint[];
  stats: LocalCheckStats;
  computedAt: number;
}

export interface LocalCheckStats {
  outOfLocalTimeMs: number;
  outOfLocalPercent: number;
  meanMissingHeightM: number;
  maxMissingHeightM: number;
  firstOutOfLocalTimeMs: number | null;
}

export interface LocalCheckInput {
  fixes: Fix[];
  altitudeSource: 'pressure' | 'gnss';
  elevationGrid: ElevationGrid;
  landingZones: LandingZone[];
  phases: FlightPhase[];
  params: LocalCheckParams;
}

/** Entry point: run the full local-check algorithm. */
export function runLocalCheck(input: LocalCheckInput): LocalCheckResult {
  const { fixes, altitudeSource, elevationGrid, landingZones, phases, params } =
    input;
  const stepMs = Math.max(10, params.timeStepS) * 1000;

  const samples: SampledPoint[] = [];
  let lastSampleMs = -Infinity;

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    if (fix.timeMs - lastSampleMs < stepMs) continue;
    lastSampleMs = fix.timeMs;

    const altM = pickAltitude(fix, altitudeSource);
    if (altM === null) continue;

    const terrain = sampleElevation(elevationGrid, fix.latitude, fix.longitude);
    const terrainElevM = isNaN(terrain) ? null : terrain;
    const aglM = terrainElevM !== null ? altM - terrainElevM : null;

    const { status, bestLzId, missingHeightM, marginM } = classifyPosition(
      fix,
      altM,
      landingZones,
      params,
    );

    samples.push({
      timeMs: fix.timeMs,
      fixIndex: i,
      latitude: fix.latitude,
      longitude: fix.longitude,
      altitudeM: altM,
      terrainElevationM: terrainElevM,
      aglM,
      phase: phases[i] ?? 'cruise',
      status,
      bestLzId,
      missingHeightM,
      marginAboveGlidePlaneM: marginM,
    });
  }

  const stats = computeStats(samples, stepMs, fixes);

  return {
    params,
    samples,
    stats,
    computedAt: Date.now(),
  };
}

interface Classification {
  status: LocalStatus;
  bestLzId: string | null;
  missingHeightM: number | null;
  marginM: number;
}

/**
 * Classify one position against the LZ catalog.
 *
 * Terrain collision does NOT gate the status: the profile chart is the
 * place to visualise a glide clipping the ground. See `arrival.ts` for the
 * shared band definitions.
 */
function classifyPosition(
  fix: Fix,
  altM: number,
  landingZones: LandingZone[],
  params: LocalCheckParams,
): Classification {
  const best = pickBestLandingZone(
    fix.latitude,
    fix.longitude,
    altM,
    landingZones,
    params.workingLD,
  );

  if (!best) {
    return {
      status: 'out-of-local',
      bestLzId: null,
      missingHeightM: null,
      marginM: -Infinity,
    };
  }

  const status = classifyArrival(
    best.heightAboveGroundM,
    params.arrivalHeightM,
  );

  return {
    status,
    bestLzId: best.lz.id,
    missingHeightM: status === 'out-of-local' ? -best.heightAboveGroundM : 0,
    // Signed distance to the safety buffer, kept for consumers that show it.
    marginM: best.heightAboveGroundM - params.arrivalHeightM,
  };
}

function computeStats(
  samples: SampledPoint[],
  stepMs: number,
  fixes: Fix[],
): LocalCheckStats {
  const flightDurationMs =
    fixes.length > 1 ? fixes[fixes.length - 1].timeMs - fixes[0].timeMs : 0;

  const cruiseOutSamples = samples.filter(
    (s) => s.status === 'out-of-local' && s.phase === 'cruise',
  );

  const outOfLocalTimeMs = cruiseOutSamples.length * stepMs;
  const outOfLocalPercent =
    flightDurationMs > 0 ? (outOfLocalTimeMs / flightDurationMs) * 100 : 0;

  const missingHeights = cruiseOutSamples
    .map((s) => s.missingHeightM)
    .filter((h): h is number => h !== null);
  const meanMissingHeightM =
    missingHeights.length > 0
      ? missingHeights.reduce((a, b) => a + b, 0) / missingHeights.length
      : 0;
  const maxMissingHeightM =
    missingHeights.length > 0 ? Math.max(...missingHeights) : 0;

  const firstOutOfLocalTimeMs = cruiseOutSamples[0]?.timeMs ?? null;

  return {
    outOfLocalTimeMs,
    outOfLocalPercent: Math.min(100, outOfLocalPercent),
    meanMissingHeightM: Math.round(meanMissingHeightM),
    maxMissingHeightM: Math.round(maxMissingHeightM),
    firstOutOfLocalTimeMs,
  };
}
