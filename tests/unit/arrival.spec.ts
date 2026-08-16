import { describe, expect, it } from 'vitest';
import {
  arrivalHeightAboveGroundM,
  classifyArrival,
  glideArrivalAltitudeM,
  pickBestLandingZone,
} from '../../src/domain/arrival';
import type { LandingZone } from '../../src/domain/landingZone';

function lz(
  id: string,
  lat: number,
  lon: number,
  elevationM: number | null = 0,
): LandingZone {
  return {
    id,
    name: id,
    code: id,
    latitude: lat,
    longitude: lon,
    elevationM,
    style: 4,
    difficulty_level: 'green',
    description: null,
    isAirfield: false,
    runwayHeading: 0,
    source: 'user',
  };
}

describe('glideArrivalAltitudeM', () => {
  it('subtracts distance / LD from the starting altitude', () => {
    // ~10 km east of 6.0 at latitude 43.
    const alt = glideArrivalAltitudeM(43, 6, 2300, 43, 6.09, 20);
    expect(alt).toBeGreaterThan(1900);
    expect(alt).toBeLessThan(2000);
  });

  it('scales inversely with the glide ratio', () => {
    const ld10 = glideArrivalAltitudeM(43, 6, 2300, 43, 6.09, 10);
    const ld20 = glideArrivalAltitudeM(43, 6, 2300, 43, 6.09, 20);
    expect(2300 - ld10).toBeCloseTo(2 * (2300 - ld20), 6);
  });
});

describe('arrivalHeightAboveGroundM', () => {
  it('subtracts the landing-zone elevation', () => {
    const high = arrivalHeightAboveGroundM(
      43,
      6,
      2300,
      lz('a', 43, 6.09, 500),
      20,
    );
    const low = arrivalHeightAboveGroundM(
      43,
      6,
      2300,
      lz('b', 43, 6.09, 0),
      20,
    );
    expect(low - high).toBeCloseTo(500, 6);
  });

  it('treats an unknown elevation as sea level', () => {
    const unknown = arrivalHeightAboveGroundM(
      43,
      6,
      2300,
      lz('a', 43, 6.09, null),
      20,
    );
    const sea = arrivalHeightAboveGroundM(
      43,
      6,
      2300,
      lz('b', 43, 6.09, 0),
      20,
    );
    expect(unknown).toBeCloseTo(sea, 6);
  });
});

describe('classifyArrival', () => {
  it('is out-of-local at or below the ground', () => {
    expect(classifyArrival(0, 300)).toBe('out-of-local');
    expect(classifyArrival(-1, 300)).toBe('out-of-local');
  });

  it('is marginal inside the arrival buffer, boundary included', () => {
    expect(classifyArrival(1, 300)).toBe('in-local-marginal');
    expect(classifyArrival(300, 300)).toBe('in-local-marginal');
  });

  it('is in-local above the arrival buffer', () => {
    expect(classifyArrival(301, 300)).toBe('in-local');
  });
});

describe('pickBestLandingZone', () => {
  it('returns null when there are no landing zones', () => {
    expect(pickBestLandingZone(43, 6, 2300, [], 20)).toBeNull();
  });

  it('picks the highest arrival height, not the nearest zone', () => {
    const near = lz('near', 43, 6.02, 2200); // close but very high ground
    const far = lz('far', 43, 6.15, 0); // further but at sea level
    const best = pickBestLandingZone(43, 6, 2300, [near, far], 20);
    expect(best?.lz.id).toBe('far');
    expect(best?.heightAboveGroundM).toBeGreaterThan(0);
  });

  it('still returns the least-bad zone when nothing is reachable', () => {
    const a = lz('a', 43, 7, 0);
    const b = lz('b', 43, 8, 0);
    const best = pickBestLandingZone(43, 6, 500, [a, b], 20);
    expect(best?.lz.id).toBe('a');
    expect(best?.heightAboveGroundM).toBeLessThan(0);
  });
});
