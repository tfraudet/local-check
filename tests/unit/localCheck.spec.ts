import { describe, expect, it } from 'vitest';
import {
  runLocalCheck,
  // DEFAULT_LOCAL_CHECK_PARAMS,
} from '../../src/domain/localCheck';
import type { LocalCheckInput } from '../../src/domain/localCheck';
import type { Fix } from '../../src/domain/flight';
import type { ElevationGrid } from '../../src/domain/elevation';
import type { LandingZone } from '../../src/domain/landingZone';
import { DEFAULT_SETTINGS } from '../../src/state/useFlightStore';
import type { FlightPhase } from '../../src/domain/flightPhases';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLAT_GRID: ElevationGrid = {
  bbox: [5, 43, 8, 45],
  cols: 4,
  rows: 4,
  resolutionM: 90,
  data: new Float32Array(16).fill(0), // sea level everywhere
  crs: 'EPSG:4326',
};

function fix(
  timeMs: number,
  lat: number,
  lon: number,
  pressureAltitudeM: number,
): Fix {
  return {
    timeMs,
    latitude: lat,
    longitude: lon,
    pressureAltitudeM,
    gnssAltitudeM: pressureAltitudeM,
  };
}

const NEARBY_LZ: LandingZone = {
  id: 'lz-near',
  name: 'Near LZ',
  code: 'NLZ',
  latitude: 43.5,
  longitude: 6.01,
  elevationM: 0,
  style: 2,
  difficulty_level: 'green',
  description: null,
  isAirfield: true,
  runwayHeading: 0,
  source: 'user',
};

// const PARAMS = { ...DEFAULT_LOCAL_CHECK_PARAMS };
const PARAMS = { ...DEFAULT_SETTINGS };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runLocalCheck', () => {
  it('returns empty samples for an empty fixes array', () => {
    const input: LocalCheckInput = {
      fixes: [],
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      params: PARAMS,
    };
    const phases: FlightPhase[] = [];
    const result = runLocalCheck(input, phases);
    expect(result.samples).toHaveLength(0);
    expect(result.stats.outOfLocalTimeMs).toBe(0);
  });

  it('classifies high-altitude fix near LZ as in-local', () => {
    // At 2000 m, LZ 5 km away: required = 0 + 300 + 5000/20 = 550 m → margin 1450 m → in-local
    const fixes = Array.from({ length: 5 }, (_, i) =>
      fix(i * PARAMS.timeStepS * 1000, 43.5, 6.05, 2000),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      params: PARAMS,
    };
    const phases: FlightPhase[] = new Array(5).fill('cruise');

    const result = runLocalCheck(input, phases);
    expect(result.samples.length).toBeGreaterThan(0);
    const statuses = result.samples.map((s) => s.status);
    expect(statuses.every((s) => s === 'in-local')).toBe(true);
  });

  it('classifies low-altitude fix far from LZ as out-of-local', () => {
    // LZ is at 6.01°E, glider is at 6.0°E and only 200 m altitude.
    // required = 0 + 300 + dist/20 > 200 → out-of-local
    const lzFar: LandingZone = {
      ...NEARBY_LZ,
      latitude: 45.0,
      longitude: 7.0,
      elevationM: 0,
    };
    const fixes = Array.from({ length: 5 }, (_, i) =>
      fix(i * PARAMS.timeStepS * 1000, 43.0, 6.0, 200),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [lzFar],
      params: PARAMS,
    };
    const phases: FlightPhase[] = new Array(5).fill('cruise');

    const result = runLocalCheck(input, phases);
    const outSamples = result.samples.filter(
      (s) => s.status === 'out-of-local',
    );
    expect(outSamples.length).toBeGreaterThan(0);
    expect(result.stats.outOfLocalTimeMs).toBeGreaterThan(0);
  });

  it('computes missingHeightM as positive value when out of local', () => {
    const lzFar: LandingZone = {
      ...NEARBY_LZ,
      latitude: 45.0,
      longitude: 7.0,
      elevationM: 0,
    };
    const fixes = [fix(0, 43.0, 6.0, 200)];
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [lzFar],
      params: PARAMS,
    };
    const phases: FlightPhase[] = new Array(1).fill('cruise');

    const result = runLocalCheck(input, phases);
    const sample = result.samples[0];
    if (sample) {
      expect(sample.missingHeightM).toBeGreaterThan(0);
    }
  });

  describe('stats time accounting', () => {
    // 1 Hz for an hour, high above a nearby LZ: every sample is in-local.
    const HOUR_OF_FIXES = Array.from({ length: 3601 }, (_, i) =>
      fix(i * 1000, 43.5, 6.05, 2000),
    );

    const statsFor = (fixes: Fix[], phases: FlightPhase[]) =>
      runLocalCheck(
        {
          fixes,
          altitudeSource: 'pressure',
          elevationGrid: FLAT_GRID,
          landingZones: [NEARBY_LZ],
          params: PARAMS,
        },
        phases,
      ).stats;

    it('reports a flight spent entirely in local as 100 %', () => {
      const stats = statsFor(
        HOUR_OF_FIXES,
        new Array(HOUR_OF_FIXES.length).fill('cruise'),
      );
      expect(stats.inLocalPercent).toBeCloseTo(100, 6);
      expect(stats.outOfLocalPercent).toBe(0);
      expect(stats.inLocalMarginalPercent).toBe(0);
    });

    it('still reports 100 % when logger gaps stretch the sample spacing', () => {
      // Drop 3 minutes of fixes mid-flight: the sample straddling the gap now
      // stands for far more than one timeStepS slice.
      const gapped = HOUR_OF_FIXES.filter(
        (f) => f.timeMs < 1_800_000 || f.timeMs > 1_980_000,
      );
      const stats = statsFor(gapped, new Array(gapped.length).fill('cruise'));
      expect(stats.inLocalPercent).toBeCloseTo(100, 6);
    });

    it('credits non-cruise phases as in-local so the bands total 100 %', () => {
      // Tow at the start, final glide at the end, engine run in between —
      // none of them scored on arrival geometry, none of them lost either.
      const phases: FlightPhase[] = new Array(HOUR_OF_FIXES.length).fill(
        'cruise',
      );
      for (let i = 0; i < 200; i++) phases[i] = 'initial-climb';
      for (let i = 900; i < 1200; i++) phases[i] = 'motor';
      for (let i = 3400; i < phases.length; i++) phases[i] = 'final-glide';

      const stats = statsFor(HOUR_OF_FIXES, phases);
      expect(
        stats.inLocalPercent +
          stats.inLocalMarginalPercent +
          stats.outOfLocalPercent,
      ).toBeCloseTo(100, 6);
      expect(stats.inLocalPercent).toBeCloseTo(100, 6);
    });

    it('splits the bands by real elapsed time, not by sample count', () => {
      // Same track, but the only LZ sits ~20 km west: reachable from 2000 m
      // (arrival ≈ +995 m), hopeless once the glider drops to 200 m.
      const lzFar: LandingZone = { ...NEARBY_LZ, longitude: 5.8 };
      const fixes = HOUR_OF_FIXES.map((f) =>
        f.timeMs < 1_800_000 ? f : { ...f, pressureAltitudeM: 200 },
      );
      const stats = runLocalCheck(
        {
          fixes,
          altitudeSource: 'pressure',
          elevationGrid: FLAT_GRID,
          landingZones: [lzFar],
          params: PARAMS,
        },
        new Array(fixes.length).fill('cruise'),
      ).stats;

      expect(stats.outOfLocalPercent).toBeCloseTo(50, 0);
      expect(stats.outOfLocalTimeMs).toBeGreaterThan(1_750_000);
      expect(
        stats.inLocalPercent +
          stats.inLocalMarginalPercent +
          stats.outOfLocalPercent,
      ).toBeCloseTo(100, 6);
    });

    it('does not lose a sample slot to a fix with no usable altitude', () => {
      // Every fix that would land exactly on a 20 s boundary has no pressure
      // altitude: the sampler must fall through to the next usable fix
      // instead of skipping a whole step.
      const fixes = HOUR_OF_FIXES.map((f) =>
        f.timeMs % (PARAMS.timeStepS * 1000) === 0
          ? { ...f, pressureAltitudeM: null }
          : f,
      );
      const stats = statsFor(fixes, new Array(fixes.length).fill('cruise'));
      expect(stats.inLocalPercent).toBeCloseTo(100, 6);
    });
  });

  it('respects timeStepS sampling interval', () => {
    // 10 fixes at 1s apart, timeStepS = 5 → should produce ~2 samples
    const fixes = Array.from({ length: 10 }, (_, i) =>
      fix(i * 1000, 43.5, 6.05, 2000),
    );
    const input: LocalCheckInput = {
      fixes,
      altitudeSource: 'pressure',
      elevationGrid: FLAT_GRID,
      landingZones: [NEARBY_LZ],
      params: { ...PARAMS, timeStepS: 5 },
    };
    const phases: FlightPhase[] = new Array(10).fill('cruise');

    
    const result = runLocalCheck(input, phases);
    // 0s, 5s → 2 samples at most (0 and 5000ms)
    expect(result.samples.length).toBeLessThanOrEqual(2);
  });
});
