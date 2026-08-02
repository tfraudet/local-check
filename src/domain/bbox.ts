/**
 * Geographic bounding-box helpers, shared by the elevation and OpenAIP
 * fetchers. Framework-agnostic.
 */

/** [minLon, minLat, maxLon, maxLat] in decimal degrees. */
export type Bbox = [number, number, number, number];

/** Expand a bbox by `deg` on every side, clamped to lat/lon limits. */
export function bufferBbox(bbox: Bbox, deg: number): Bbox {
  return [
    Math.max(-180, bbox[0] - deg),
    Math.max(-90, bbox[1] - deg),
    Math.min(180, bbox[2] + deg),
    Math.min(90, bbox[3] + deg),
  ];
}

/** Degrees of latitude per kilometre (mean Earth radius approximation). */
const KM_PER_DEGREE_LAT = 111.32;

/**
 * Expand a bbox by `km` on every side. Longitude degrees are widened by
 * `km / (KM_PER_DEGREE_LAT * cos(latitude))` so the margin stays roughly
 * `km` wide in real distance regardless of latitude.
 */
export function bufferBboxByKm(bbox: Bbox, km: number): Bbox {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const latDeg = km / KM_PER_DEGREE_LAT;
  const lonDeg =
    km / (KM_PER_DEGREE_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 1e-6));
  return [
    Math.max(-180, bbox[0] - lonDeg),
    Math.max(-90, bbox[1] - latDeg),
    Math.min(180, bbox[2] + lonDeg),
    Math.min(90, bbox[3] + latDeg),
  ];
}

/** True when `inner` lies entirely inside `outer`. */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}

/** Bounding box of a set of lon/lat points. */
export function boundingBoxOf(
  points: readonly { latitude: number; longitude: number }[],
): Bbox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
  }
  return [minLon, minLat, maxLon, maxLat];
}
