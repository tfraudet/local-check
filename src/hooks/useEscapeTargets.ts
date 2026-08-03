import { useMemo, useRef } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { findCurrentFixIndex } from '../domain/flight';
import {
  arrivalHeightAboveGroundM,
  classifyArrival,
  pickBestLandingZone,
} from '../domain/arrival';
import { computeEscapePath, type EscapePath } from '../domain/escapePath';
import { haversineDistanceM, pickAltitude } from '../domain/units';
import type { ArrivalHeightFeature } from '../components/map/geojson';

/** Skip arrival-height labels for LZs beyond this range — far LZs are
 * never reachable and only clutter the map. */
const ARRIVAL_HEIGHT_MAX_DISTANCE_KM = 60;
const ARRIVAL_HEIGHT_MAX_DISTANCE_M = ARRIVAL_HEIGHT_MAX_DISTANCE_KM * 1000;

/**
 * Compare two feature arrays at the granularity of what actually renders:
 * id, status, and arrival height rounded to whole metres (the label is
 * `Math.round(arrivalHeightM)`, so sub-metre wobble is invisible). Equal
 * arrays let the caller reuse the previous reference and skip a MapLibre
 * `setData` — the expensive part of the update.
 */
function arrivalHeightFeaturesEqual(
  a: ArrivalHeightFeature[],
  b: ArrivalHeightFeature[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.status !== y.status) return false;
    if (Math.round(x.arrivalHeightM) !== Math.round(y.arrivalHeightM))
      return false;
  }
  return true;
}

/** Position + altitude of the fix under the replay cursor. */
function useCurrentPosition() {
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  return useMemo(() => {
    if (!flight) return null;
    const index = findCurrentFixIndex(flight, currentTimeMs);
    if (index < 0) return null;
    const fix = flight.fixes[index];
    const altM = pickAltitude(fix, altitudeSource);
    if (altM === null) return null;
    return { index, fix, altM };
  }, [flight, currentTimeMs, altitudeSource]);
}

/**
 * Arrival-height label features for every visible LZ at the current replay
 * position (Phase 3, FR-3-3).
 */
export function useArrivalHeightFeatures(): ArrivalHeightFeature[] {
  const showArrivalHeights = useFlightStore((s) => s.showArrivalHeights);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const localCheckParams = useFlightStore((s) => s.localCheckParams);
  const position = useCurrentPosition();

  const nextFeatures = useMemo<ArrivalHeightFeature[]>(() => {
    if (!showArrivalHeights || !position) return [];
    const { fix, altM } = position;
    const startedAt = import.meta.env.DEV ? performance.now() : 0;

    const features: ArrivalHeightFeature[] = [];
    for (const lz of landingZones) {
      if (!visibleLandingZoneIds.has(lz.id)) continue;
      const distM = haversineDistanceM(
        fix.latitude,
        fix.longitude,
        lz.latitude,
        lz.longitude,
      );
      if (distM > ARRIVAL_HEIGHT_MAX_DISTANCE_M) continue;
      const heightM = arrivalHeightAboveGroundM(
        fix.latitude,
        fix.longitude,
        altM,
        lz,
        localCheckParams.workingLD,
      );
      features.push({
        id: lz.id,
        latitude: lz.latitude,
        longitude: lz.longitude,
        arrivalHeightM: heightM,
        status: classifyArrival(heightM, localCheckParams.arrivalHeightM),
      });
    }

    if (import.meta.env.DEV) {
      console.log(
        `[arrivalHeights] ${features.length} labels in ${(performance.now() - startedAt).toFixed(2)} ms`,
      );
    }
    return features;
  }, [
    showArrivalHeights,
    position,
    landingZones,
    visibleLandingZoneIds,
    localCheckParams,
  ]);

  // Preserve the previous array identity when nothing changed at label
  // granularity, so downstream memos (`buildArrivalHeightsGeoJSON`) bail out
  // and MapLibre `setData` doesn't fire. This is where the perceived lag
  // lives — the compute above takes <1 ms; the symbol-layer re-tile is
  // orders of magnitude more expensive.
  const stableFeaturesRef = useRef(nextFeatures);
  if (!arrivalHeightFeaturesEqual(stableFeaturesRef.current, nextFeatures)) {
    stableFeaturesRef.current = nextFeatures;
  }
  return stableFeaturesRef.current;
}

/**
 * Escape path from the current position to the best-arrival LZ — the same
 * LZ the greenest arrival-height label points at (Phase 3, FR-3-1).
 */
export function useCurrentEscapePath(): EscapePath | null {
  const showEscapePath = useFlightStore((s) => s.showEscapePath);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const localCheckParams = useFlightStore((s) => s.localCheckParams);
  const position = useCurrentPosition();

  return useMemo<EscapePath | null>(() => {
    if (!showEscapePath || !position) return null;
    if (!elevationGrid || !localCheckResult) return null;

    const { index, fix, altM } = position;
    const startedAt = import.meta.env.DEV ? performance.now() : 0;
    const best = pickBestLandingZone(
      fix.latitude,
      fix.longitude,
      altM,
      landingZones,
      localCheckParams.workingLD,
    );
    if (!best) return null;

    const path = computeEscapePath({
      sourceFixIndex: index,
      sourceLat: fix.latitude,
      sourceLon: fix.longitude,
      sourceAltM: altM,
      lz: best.lz,
      grid: elevationGrid,
      params: localCheckParams,
    });

    if (import.meta.env.DEV) {
      console.log(
        `[escapePath] ${path?.profile.length ?? 0} profile pts in ${(performance.now() - startedAt).toFixed(2)} ms`,
      );
    }
    return path;
  }, [
    showEscapePath,
    position,
    elevationGrid,
    localCheckResult,
    landingZones,
    localCheckParams,
  ]);
}
