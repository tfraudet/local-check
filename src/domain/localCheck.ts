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
import { computeFlightPhases, type FlightPhase } from './flightPhases';
import {
  classifyArrival,
  pickBestLandingZone,
  type LocalStatus,
} from './arrival';
import { pickAltitude, haversineDistanceM } from './units';
import { detectMotorUse } from './enlDetection';
import { computeDerivedMetrics } from './derivedMetrics';
import { routeToLz } from './routing/routeToLz';

export interface LocalCheckParams {
  workingLD: number;
  arrivalHeightM: number;
  groundClearanceM: number;
  timeStepS: number;
  enlThreshold: number;
  detectFinalGlide: boolean;
  /** When true, LZs whose straight-line glide clips terrain are re-evaluated
   * via terrain-aware routing (Theta*). The arrival-height picker uses the
   * routed distance so the "best LZ" pick reflects real detour costs. */
  terrainAwareRouting?: boolean;
}

// export const DEFAULT_LOCAL_CHECK_PARAMS: LocalCheckParams = {
//   workingLD: 20,
//   arrivalHeightM: 300,
//   groundClearanceM: 150,
//   timeStepS: 20,
//   enlThreshold: 500,
// };

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

/**
 * Time-based summary of one local check. The three percentages partition the
 * flight duration (first to last fix) and therefore always total 100 % — see
 * `bandOf` for which phase/status combination feeds which band.
 */
export interface LocalCheckStats {
  outOfLocalTimeMs: number;
  outOfLocalPercent: number;
  /** Number of distinct out-of-local excursions during cruise. */
  outOfLocalExits: number;
  inLocalMarginalPercent: number;
  /** Number of distinct in-local-marginal episodes during cruise. */
  inLocalMarginalExits: number;
  inLocalPercent: number;
  /** Number of distinct in-local episodes during cruise. */
  inLocalExits: number;
  /** Smallest height deficit among out-of-local cruise samples (0 when none). */
  minMissingHeightM: number;
  maxMissingHeightM: number;
  /** Lowest (worst) margin above the safety buffer observed during cruise,
   * across all statuses — how close the flight came to breaching local even
   * when it never actually did. */
  lowestMarginM: number;
  firstOutOfLocalTimeMs: number | null;
}

export interface LocalCheckInput {
  fixes: Fix[];
  altitudeSource: 'pressure' | 'gnss';
  elevationGrid: ElevationGrid;
  landingZones: LandingZone[];
  // phases: FlightPhase[];
  params: LocalCheckParams;
  /** Optional QNH-based offset added to every pressure altitude read. */
  qnhOffsetM?: number;
}

export function runLocalCheckFull(input: LocalCheckInput): LocalCheckResult {
  const motorFlags = detectMotorUse(
    input.fixes,
    input.params.enlThreshold,
  );
  
  // Derived metrics stored on `flight` may lack AGL when the elevation
  // grid loaded after IGC parsing. Re-derive with the grid so
  // `computeFlightPhases` sees populated `aglM` for initial-climb /
  // final-glide detection. Kept local so `flight` identity stays
  // stable (mutating it here would loop the auto-effect hooks).
  const qnhOffsetM = input.qnhOffsetM ?? 0;
  const derivedWithAgl = computeDerivedMetrics(
    input.fixes,
    input.altitudeSource,
    input.elevationGrid,
    qnhOffsetM,
  );
  const phases = computeFlightPhases(
    input.fixes,
    derivedWithAgl,
    motorFlags,
    input.altitudeSource,
    input.params.detectFinalGlide,
    qnhOffsetM,
  );
  
  return runLocalCheck(input, phases);
}

/** Entry point: run the full local-check algorithm. */
export function runLocalCheck(input: LocalCheckInput, phases : FlightPhase[]): LocalCheckResult {
  // const { fixes, altitudeSource, elevationGrid, landingZones, phases, params } =
  const { fixes, altitudeSource, elevationGrid, landingZones, params } =
    input;
  const qnhOffsetM = input.qnhOffsetM ?? 0;
  const stepMs = Math.max(1, params.timeStepS) * 1000;

  const samples: SampledPoint[] = [];
  let lastSampleMs = -Infinity;

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    if (fix.timeMs - lastSampleMs < stepMs) continue;

    const altM = pickAltitude(fix, altitudeSource, qnhOffsetM);
    // Advance the cursor only on an emitted sample: a fix without a usable
    // altitude must not consume the slot, otherwise the sampler skips
    // forward a full step and leaves an unclassified hole behind it.
    if (altM === null) continue;
    lastSampleMs = fix.timeMs;

    const terrain = sampleElevation(elevationGrid, fix.latitude, fix.longitude);
    const terrainElevM = isNaN(terrain) ? null : terrain;
    const aglM = terrainElevM !== null ? altM - terrainElevM : null;

    const { status, bestLzId, missingHeightM, marginM } = classifyPosition(
      fix,
      altM,
      landingZones,
      params,
      elevationGrid,
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

  const stats = computeStats(samples, fixes);

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
  elevationGrid: ElevationGrid,
): Classification {
  // Terrain-aware routing: for each LZ where the straight-line glide would
  // clip terrain, ask Theta* for a routed distance. Cheap LZs (straight
  // glide clears, or LZ hopelessly far) stay on the straight-line path.
  const distanceFn = params.terrainAwareRouting
    ? (lz: LandingZone) => {
        const straightM = haversineDistanceM(
          fix.latitude,
          fix.longitude,
          lz.latitude,
          lz.longitude,
        );
        // Skip routing for LZs beyond the theoretical L/D max reach — no
        // detour can help. `params.workingLD` is meters per meter, so max
        // reachable distance is altM × workingLD.
        if (straightM > altM * params.workingLD * 1.2) return null;
        const route = routeToLz({
          sourceLat: fix.latitude,
          sourceLon: fix.longitude,
          sourceAltM: altM,
          targetLat: lz.latitude,
          targetLon: lz.longitude,
          workingLD: params.workingLD,
          groundClearanceM: params.groundClearanceM,
          grid: elevationGrid,
          maxNodes: 5_000,
        });
        return route ? route.distanceM : null;
      }
    : undefined;

  const best = pickBestLandingZone(
    fix.latitude,
    fix.longitude,
    altM,
    landingZones,
    params.workingLD,
    distanceFn,
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

/**
 * Which of the three reported bands a sample contributes its time to.
 *
 * Only cruise is scored on arrival geometry. Every other phase is credited
 * as in-local whatever its geometry says:
 *   - initial-climb: on tow / on the winch (and the pre-takeoff ground fixes
 *     folded into that phase) — the glider is not yet responsible for its
 *     own glide, and a stationary glider on the runway would otherwise score
 *     out-of-local.
 *   - final-glide: the committed descent and circuit into the landing field —
 *     being below the arrival buffer there is the intent, not a breach.
 *   - motor: the engine, not a glide, is keeping the aircraft up.
 *
 * The mapping is total, so the three bands always add up to the flight
 * duration; nothing is silently dropped.
 */
function bandOf(sample: SampledPoint): 'out' | 'marginal' | 'in' {
  if (sample.phase !== 'cruise') return 'in';
  if (sample.status === 'out-of-local') return 'out';
  if (sample.status === 'in-local-marginal') return 'marginal';
  return 'in';
}

function computeStats(
  samples: SampledPoint[],
  fixes: Fix[],
): LocalCheckStats {
  const flightDurationMs =
    fixes.length > 1 ? fixes[fixes.length - 1].timeMs - fixes[0].timeMs : 0;

  const toPercent = (timeMs: number) =>
    flightDurationMs > 0 ? Math.min(100, (timeMs / flightDurationMs) * 100) : 0;

  const cruiseOutSamples = samples.filter(
    (s) => s.status === 'out-of-local' && s.phase === 'cruise',
  );
  // Each sample stands for the wall-clock interval running up to the next
  // sample — NOT for a fixed `timeStepS` slice. Sampling lands on the first
  // fix past the step, samples whose altitude is unusable are dropped, and
  // logger gaps stretch the spacing, so counting slices under-reports against
  // the real elapsed time (a clean flight came out at 99.1 % instead of 100).
  // Anchoring the first interval at the first fix makes the weights sum to
  // `flightDurationMs` exactly.
  const weightsMs = new Array<number>(samples.length);
  let boundaryMs = fixes[0]?.timeMs ?? 0;
  for (let i = 0; i < samples.length; i++) {
    const nextBoundaryMs =
      i + 1 < samples.length
        ? samples[i + 1].timeMs
        : (fixes[fixes.length - 1]?.timeMs ?? boundaryMs);
    weightsMs[i] = Math.max(0, nextBoundaryMs - boundaryMs);
    boundaryMs = nextBoundaryMs;
  }

  let outOfLocalTimeMs = 0;
  let inLocalMarginalTimeMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const band = bandOf(samples[i]);
    if (band === 'out') outOfLocalTimeMs += weightsMs[i];
    else if (band === 'marginal') inLocalMarginalTimeMs += weightsMs[i];
  }
  // Complement rather than a third sum, so the bands can never fail to total
  // 100 % because of an unmapped sample.
  const inLocalTimeMs =
    samples.length === 0
      ? 0
      : Math.max(
          0,
          flightDurationMs - outOfLocalTimeMs - inLocalMarginalTimeMs,
        );

  const missingHeights = cruiseOutSamples
    .map((s) => s.missingHeightM)
    .filter((h): h is number => h !== null);
  const minMissingHeightM =
    missingHeights.length > 0 ? Math.min(...missingHeights) : 0;
  const maxMissingHeightM =
    missingHeights.length > 0 ? Math.max(...missingHeights) : 0;

  const cruiseMargins = samples
    .filter((s) => s.phase === 'cruise')
    .map((s) => s.marginAboveGlidePlaneM)
    .filter((m) => Number.isFinite(m));
  const lowestMarginM =
    cruiseMargins.length > 0 ? Math.min(...cruiseMargins) : 0;

  const firstOutOfLocalTimeMs = cruiseOutSamples[0]?.timeMs ?? null;

  return {
    outOfLocalTimeMs,
    outOfLocalPercent: toPercent(outOfLocalTimeMs),
    outOfLocalExits: countStatusEpisodes(samples, 'out-of-local'),
    inLocalMarginalPercent: toPercent(inLocalMarginalTimeMs),
    inLocalMarginalExits: countStatusEpisodes(samples, 'in-local-marginal'),
    inLocalPercent: toPercent(inLocalTimeMs),
    inLocalExits: countStatusEpisodes(samples, 'in-local'),
    minMissingHeightM: Math.round(minMissingHeightM),
    maxMissingHeightM: Math.round(maxMissingHeightM),
    lowestMarginM: Math.round(lowestMarginM),
    firstOutOfLocalTimeMs,
  };
}

/**
 * Count the number of distinct chronological episodes where a cruise sample
 * matches `status` (a "run" of consecutive matching samples counts once).
 * Any non-cruise sample or non-matching status breaks the current run, so
 * this reflects how many separate times the flight entered that band.
 */
function countStatusEpisodes(
  samples: SampledPoint[],
  status: LocalStatus,
): number {
  let count = 0;
  let inRun = false;
  for (const s of samples) {
    const matches = s.phase === 'cruise' && s.status === status;
    if (matches && !inRun) {
      count += 1;
      inRun = true;
    } else if (!matches) {
      inRun = false;
    }
  }
  return count;
}
