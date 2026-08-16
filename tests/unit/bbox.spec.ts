import { describe, expect, it } from 'vitest';
import {
  bboxContains,
  boundingBoxOf,
  bufferBbox,
  bufferBboxByKm,
  type Bbox,
} from '../../src/domain/bbox';
import { haversineDistanceKm } from '../../src/domain/units';

describe('bufferBboxByKm', () => {
  it('expands a bbox so the buffered edges sit ~`km` away from the source edges', () => {
    const bbox: Bbox = [3.0, 45.0, 3.5, 45.5];
    const buffered = bufferBboxByKm(bbox, 50);

    expect(bboxContains(buffered, bbox)).toBe(true);

    // North/south edges: latitude degrees are distance-independent of longitude.
    const northDistanceKm = haversineDistanceKm(
      bbox[3],
      3.25,
      buffered[3],
      3.25,
    );
    const southDistanceKm = haversineDistanceKm(
      bbox[1],
      3.25,
      buffered[1],
      3.25,
    );
    expect(northDistanceKm).toBeCloseTo(50, 0);
    expect(southDistanceKm).toBeCloseTo(50, 0);

    // East/west edges, measured along the mid-latitude.
    const midLat = 45.25;
    const eastDistanceKm = haversineDistanceKm(
      midLat,
      bbox[2],
      midLat,
      buffered[2],
    );
    const westDistanceKm = haversineDistanceKm(
      midLat,
      bbox[0],
      midLat,
      buffered[0],
    );
    expect(eastDistanceKm).toBeCloseTo(50, 0);
    expect(westDistanceKm).toBeCloseTo(50, 0);
  });

  it('clamps to valid lon/lat ranges near the poles and antimeridian', () => {
    const bbox: Bbox = [179.5, 89.5, 179.9, 89.9];
    const buffered = bufferBboxByKm(bbox, 500);
    expect(buffered[0]).toBeGreaterThanOrEqual(-180);
    expect(buffered[1]).toBeGreaterThanOrEqual(-90);
    expect(buffered[2]).toBeLessThanOrEqual(180);
    expect(buffered[3]).toBeLessThanOrEqual(90);
  });

  it('is a no-op buffer of 0 km', () => {
    const bbox: Bbox = [1, 2, 3, 4];
    expect(bufferBboxByKm(bbox, 0)).toEqual(bbox);
  });
});

describe('bufferBbox (degrees) and boundingBoxOf', () => {
  it('still expands by raw degrees, unaffected by the km helper', () => {
    expect(bufferBbox([1, 2, 3, 4], 1)).toEqual([0, 1, 4, 5]);
  });

  it('computes the bounding box of a set of points', () => {
    const points = [
      { longitude: 3.0, latitude: 45.0 },
      { longitude: 3.5, latitude: 45.6 },
      { longitude: 2.8, latitude: 45.2 },
    ];
    expect(boundingBoxOf(points)).toEqual([2.8, 45.0, 3.5, 45.6]);
  });
});
