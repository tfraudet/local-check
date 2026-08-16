import { describe, expect, it } from 'vitest';
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatSpeed,
  formatVario,
  haversineDistanceKm,
} from '../../src/domain/units';

describe('units formatting', () => {
  it('formats altitude with meters suffix, dash when null', () => {
    expect(formatAltitude(1234.6)).toBe('1235 m');
    expect(formatAltitude(null)).toBe('—');
  });

  it('formats speed with km/h suffix', () => {
    expect(formatSpeed(87.4)).toBe('87 km/h');
    expect(formatSpeed(null)).toBe('—');
  });

  it('formats vario with sign and one decimal', () => {
    expect(formatVario(1.234)).toBe('+1.2 m/s');
    expect(formatVario(-2.5)).toBe('-2.5 m/s');
    expect(formatVario(null)).toBe('—');
  });

  it('formats distance in km with one decimal', () => {
    expect(formatDistance(12.345)).toBe('12.3 km');
  });

  it('formats duration as HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('computes zero distance for identical points', () => {
    expect(haversineDistanceKm(45, 6, 45, 6)).toBeCloseTo(0, 6);
  });

  it('computes a plausible distance between two known points', () => {
    // Paris to London, ~344 km great-circle distance.
    const km = haversineDistanceKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(400);
  });
});
