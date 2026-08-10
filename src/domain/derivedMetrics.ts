import { haversineDistanceKm, pickAltitude } from './units';
import type { DerivedPoint, Fix } from './flight';
import type { ElevationGrid } from './elevation';
import { sampleElevation } from './elevation';

/**
 * Compute per-fix derived metrics (ground speed, vertical speed/vario,
 * cumulative distance, terrain elevation, AGL) from an ordered list of fixes.
 *
 * All values are computed once at load time and stored alongside `fixes`
 * for O(1) lookup during replay — never recomputed per animation frame.
 *
 * `elevationGrid` is optional: when provided, terrainElevationM and aglM are
 * populated; when absent they remain null (Phase 1 behavior preserved).
 */
export function computeDerivedMetrics(
  fixes: Fix[],
  altitudeSource: 'pressure' | 'gnss',
  elevationGrid?: ElevationGrid | null,
): DerivedPoint[] {
  const derived: DerivedPoint[] = [];
  let cumulativeDistanceKm = 0;

  // Light smoothing window for vario (moving average over up to 3 fixes)
  // to avoid noisy single-sample spikes.
  const varioWindow: number[] = [];
  const VARIO_WINDOW_SIZE = 3;

  for (let i = 0; i < fixes.length; i++) {
    const current = fixes[i];
    const previous = i > 0 ? fixes[i - 1] : null;

    let groundSpeedKmh: number | null = null;
    let verticalSpeedMs: number | null = null;

    if (previous) {
      const elapsedSeconds = (current.timeMs - previous.timeMs) / 1000;
      const distanceKm = haversineDistanceKm(
        previous.latitude,
        previous.longitude,
        current.latitude,
        current.longitude,
      );
      cumulativeDistanceKm += distanceKm;

      if (elapsedSeconds > 0) {
        groundSpeedKmh = (distanceKm / elapsedSeconds) * 3600;

        const currentAlt = pickAltitude(current, altitudeSource);
        const previousAlt = pickAltitude(previous, altitudeSource);
        if (currentAlt !== null && previousAlt !== null) {
          const rawVario = (currentAlt - previousAlt) / elapsedSeconds;
          varioWindow.push(rawVario);
          if (varioWindow.length > VARIO_WINDOW_SIZE) varioWindow.shift();
          verticalSpeedMs =
            varioWindow.reduce((a, b) => a + b, 0) / varioWindow.length;
        }
      }
    }

    // Terrain elevation and AGL (populated when an elevation grid is available)
    let terrainElevationM: number | null = null;
    let aglM: number | null = null;
    if (elevationGrid) {
      const terrain = sampleElevation(
        elevationGrid,
        current.latitude,
        current.longitude,
      );
      if (!isNaN(terrain)) {
        terrainElevationM = terrain;
        const alt = pickAltitude(current, altitudeSource);
        if (alt !== null) aglM = alt - terrain;
      }
    }

    derived.push({
      groundSpeedKmh,
      verticalSpeedMs,
      cumulativeDistanceKm,
      terrainElevationM,
      aglM,
    });
  }

  return derived;
}