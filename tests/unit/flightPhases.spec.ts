import { describe, expect, it } from 'vitest';
import { computeFlightPhases } from '../../src/domain/flightPhases';
import type { Fix, DerivedPoint } from '../../src/domain/flight';

function fix(
  timeMs: number,
  pressureAltitudeM: number,
  lat = 43,
  lon = 6,
): Fix {
  return {
    timeMs,
    latitude: lat,
    longitude: lon,
    pressureAltitudeM,
    gnssAltitudeM: pressureAltitudeM,
  };
}

function derived(
  vario: number | null,
  agl: number | null = null,
  groundSpeedKmh = 80,
): DerivedPoint {
  return {
    groundSpeedKmh,
    verticalSpeedMs: vario,
    cumulativeDistanceKm: 0,
    terrainElevationM: null,
    aglM: agl,
  };
}

/** Synthetic launch: 5 stationary fixes, then takeoff, then a sustained tow
 *  climbing ~3 m/s for 40 s, then an altitude peak followed by a sustained
 *  drop (release), then a thermal. Returns the indices for readability. */
function launchScenario() {
  const fixes: Fix[] = [];
  const derivedArr: DerivedPoint[] = [];

  for (let i = 0; i < 5; i++) {
    fixes.push(fix(i * 1000, 342));
    derivedArr.push(derived(0, null, 0));
  }
  const takeoffIdx = fixes.length;
  fixes.push(fix(5000, 342));
  derivedArr.push(derived(0, null, 40));

  // 40 s tow, +3 m/s → peak 462 m at fix takeoffIdx+40
  for (let s = 1; s <= 40; s++) {
    fixes.push(fix(5000 + s * 1000, 342 + s * 3));
    derivedArr.push(derived(3.0, null, 110));
  }
  const peakIdx = fixes.length - 1;

  // Release: altitude drops steadily (~2 m/s) for 8 s → 16 m below peak
  for (let s = 1; s <= 8; s++) {
    fixes.push(fix(45_000 + s * 1000, 462 - s * 2));
    derivedArr.push(derived(-2.0, null, 90));
  }
  // Then thermal climb again
  for (let s = 1; s <= 20; s++) {
    fixes.push(fix(53_000 + s * 1000, 446 + s * 2));
    derivedArr.push(derived(2.0, null, 90));
  }

  return { fixes, derivedArr, takeoffIdx, peakIdx };
}

describe('computeFlightPhases', () => {
  it('returns empty array for empty input', () => {
    expect(computeFlightPhases([], [], [], 'pressure')).toEqual([]);
  });

  it('tags pre-takeoff, tow, and peak altitude as initial-climb', () => {
    const { fixes, derivedArr, takeoffIdx, peakIdx } = launchScenario();
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(fixes.length).fill(false),
      'pressure',
    );

    // Pre-takeoff ground fixes fold into initial-climb so they aren't
    // scored as out-of-local by the local check.
    for (let i = 0; i < takeoffIdx; i++)
      expect(phases[i]).toBe('initial-climb');
    // Takeoff through peak → initial-climb
    expect(phases[takeoffIdx]).toBe('initial-climb');
    expect(phases[peakIdx]).toBe('initial-climb');
    // First fix after peak = post-release
    expect(phases[peakIdx + 1]).not.toBe('initial-climb');
  });

  it('does not fire a false release on brief mid-tow altitude noise', () => {
    // Realistic 1-Hz IGC noise pattern: monotonically climbing ~3 m/s but
    // with ±1 m per-fix noise. The old vario-based detector triggered here
    // because smoothed Vz dipped below the release threshold; the peak-
    // and-drop detector should keep climbing right through.
    const fixes: Fix[] = [];
    const derivedArr: DerivedPoint[] = [];

    // On ground
    fixes.push(fix(0, 342));
    derivedArr.push(derived(0, null, 0));

    // Long tow with alternating +3 / +2 / +4 pattern so smoothed Vz
    // fluctuates but max altitude never drops.
    const pattern = [3, 2, 4, 3, 1, 5];
    let altM = 342;
    for (let s = 1; s <= 120; s++) {
      const step = pattern[s % pattern.length];
      altM += step;
      fixes.push(fix(s * 1000, altM));
      derivedArr.push(derived(step, null, 110));
    }
    const peakIdx = fixes.length - 1;

    // Then release: altitude drops for 8 s at ~2 m/s → ≥ 10 m below peak
    for (let s = 1; s <= 8; s++) {
      fixes.push(fix((120 + s) * 1000, altM - s * 2));
      derivedArr.push(derived(-2.0, null, 90));
    }

    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(fixes.length).fill(false),
      'pressure',
    );

    // Every fix from 1 to peakIdx is initial-climb, no early cutoff.
    for (let i = 1; i <= peakIdx; i++) {
      expect(phases[i]).toBe('initial-climb');
    }
    // Post-peak is not initial-climb
    expect(phases[peakIdx + 1]).not.toBe('initial-climb');
  });

  it('does not tag initial-climb when the recording starts mid-flight', () => {
    const fixes = [fix(0, 1000), fix(5000, 1015), fix(10000, 1030)];
    const derivedArr = [
      derived(null, null, 80),
      derived(3.0, null, 80),
      derived(3.0, null, 80),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      [false, false, false],
      'pressure',
    );
    expect(phases.every((p) => p === 'cruise')).toBe(true);
  });

  it('does not tag initial-climb when the climb is too brief', () => {
    // On the ground, climbs for only 3 s, never reaches sustained.
    const fixes = [
      fix(0, 400),
      fix(1000, 402),
      fix(2000, 404),
      fix(3000, 406),
      fix(4000, 406),
    ];
    const derivedArr = [
      derived(null, null, 0),
      derived(2.0, null, 40),
      derived(2.0, null, 40),
      derived(2.0, null, 40),
      derived(0.0, null, 40),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(5).fill(false),
      'pressure',
    );
    expect(phases.every((p) => p === 'cruise')).toBe(true);
  });

  it('confirms release via a sharp turn while still climbing', () => {
    const fixes: Fix[] = [];
    const derivedArr: DerivedPoint[] = [];

    fixes.push(fix(0, 300));
    derivedArr.push(derived(0, null, 0));

    // Straight tow heading north for 30 s
    for (let s = 1; s <= 30; s++) {
      fixes.push(fix(s * 1000, 300 + s * 3, 43 + s * 0.0003, 6));
      derivedArr.push(derived(3.0, null, 110));
    }
    // Sharp right turn — heading swings ~90° over 2 s
    fixes.push(fix(31_000, 393, 43.009, 6.0002));
    derivedArr.push(derived(3.0, null, 110));
    fixes.push(fix(32_000, 393, 43.009, 6.0006));
    derivedArr.push(derived(3.0, null, 110));
    fixes.push(fix(33_000, 393, 43.0088, 6.001));
    derivedArr.push(derived(3.0, null, 110));

    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(fixes.length).fill(false),
      'pressure',
    );

    expect(phases[1]).toBe('initial-climb');
    expect(phases[20]).toBe('initial-climb');
    // Somewhere in the turn (fixes 31..33) release fires — by fix 33 we're
    // no longer in initial-climb.
    expect(phases[33]).not.toBe('initial-climb');
  });

  it('marks motor phases via motorFlags', () => {
    const fixes = [fix(0, 400), fix(1000, 400), fix(2000, 400)];
    const derivedArr = [
      derived(0, null, 80),
      derived(0, null, 80),
      derived(0, null, 80),
    ];
    const motorFlags = [false, true, false];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      motorFlags,
      'pressure',
    );
    expect(phases[1]).toBe('motor');
    expect(phases[0]).toBe('cruise');
    expect(phases[2]).toBe('cruise');
  });

  it('marks final glide near the end at low AGL', () => {
    const lat0 = 43;
    const lon0 = 6;
    const fixes = [
      fix(0, 2000, lat0, lon0),
      fix(60000, 1500, lat0, lon0),
      fix(120000, 500, lat0 + 0.001, lon0 + 0.001),
      fix(180000, 200, lat0 + 0.002, lon0 + 0.002),
      fix(240000, 150, lat0 + 0.002, lon0 + 0.002),
    ];
    const derivedArr = [
      derived(0, 1500, 80),
      derived(-0.5, 1000, 80),
      derived(-1, 200, 80),
      derived(-1, 100, 80),
      derived(-0.5, 50, 80),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(5).fill(false),
      'pressure',
    );
    expect(phases[4]).toBe('final-glide');
    expect(phases[3]).toBe('final-glide');
  });

  it('extends final glide back through the sustained descent from the last thermal', () => {
    const lat0 = 43;
    const lon0 = 6;
    const fixes = [
      fix(0, 2000, lat0 + 0.05, lon0 + 0.05),
      fix(60000, 2400, lat0 + 0.05, lon0 + 0.05),
      fix(120000, 2500, lat0 + 0.05, lon0 + 0.05),
      fix(180000, 2200, lat0 + 0.04, lon0 + 0.04),
      fix(240000, 1800, lat0 + 0.03, lon0 + 0.03),
      fix(300000, 1400, lat0 + 0.02, lon0 + 0.02),
      fix(360000, 1000, lat0 + 0.01, lon0 + 0.01),
      fix(420000, 700, lat0 + 0.005, lon0 + 0.005),
      fix(480000, 400, lat0 + 0.001, lon0 + 0.001),
      fix(540000, 350, lat0, lon0),
    ];
    const derivedArr = [
      derived(1.0, 1700, 80),
      derived(2.0, 2100, 80),
      derived(0.5, 2200, 80),
      derived(-2.0, 1900, 80),
      derived(-2.0, 1500, 80),
      derived(-2.0, 1100, 80),
      derived(-2.0, 700, 80),
      derived(-2.0, 400, 80),
      derived(-2.0, 250, 80),
      derived(-2.0, 200, 80),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(10).fill(false),
      'pressure',
    );
    expect(phases[0]).toBe('cruise');
    expect(phases[1]).toBe('cruise');
    expect(phases[2]).toBe('final-glide');
    expect(phases[7]).toBe('final-glide');
    expect(phases[8]).toBe('final-glide');
    expect(phases[9]).toBe('final-glide');
  });

  it('stops the final-glide walk at the last thermal', () => {
    const lat0 = 43;
    const lon0 = 6;
    const fixes = [
      fix(0, 1500, lat0 + 0.05, lon0 + 0.05),
      fix(60000, 1500, lat0 + 0.05, lon0 + 0.05),
      fix(120000, 1500, lat0 + 0.05, lon0 + 0.05),
      fix(180000, 2000, lat0 + 0.04, lon0 + 0.04),
      fix(240000, 1600, lat0 + 0.03, lon0 + 0.03),
      fix(300000, 1200, lat0 + 0.02, lon0 + 0.02),
      fix(360000, 800, lat0 + 0.01, lon0 + 0.01),
      fix(420000, 400, lat0, lon0),
    ];
    const derivedArr = [
      derived(0, 1200, 80),
      derived(0, 1200, 80),
      derived(0, 1200, 80),
      derived(3.0, 1700, 80),
      derived(-3.0, 1300, 80),
      derived(-3.0, 900, 80),
      derived(-3.0, 500, 80),
      derived(-3.0, 250, 80),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(8).fill(false),
      'pressure',
    );
    expect(phases[0]).toBe('cruise');
    expect(phases[2]).toBe('cruise');
    expect(phases[3]).toBe('final-glide');
    expect(phases[4]).toBe('final-glide');
    expect(phases[7]).toBe('final-glide');
  });

  it('does not mark final-glide when there is no significant descent', () => {
    const fixes = [
      fix(0, 1200),
      fix(60000, 1210),
      fix(120000, 1205),
      fix(180000, 1215),
    ];
    const derivedArr = [
      derived(0, 800, 80),
      derived(0, 810, 80),
      derived(0, 805, 80),
      derived(0, 815, 80),
    ];
    const phases = computeFlightPhases(
      fixes,
      derivedArr,
      new Array(4).fill(false),
      'pressure',
    );
    expect(phases.every((p) => p === 'cruise')).toBe(true);
  });
});
