import { useEffect, useMemo, useState } from 'react';
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
    if (x.latitude !== y.latitude) return false;
    if (x.longitude !== y.longitude) return false;
    if (x.status !== y.status) return false;
    if (Math.round(x.arrivalHeightM) !== Math.round(y.arrivalHeightM))
      return false;
  }
  return true;
}

/** Position + altitude interpolated at the exact replay clock time. */
function useCurrentInterpolatedPosition() {
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  return useMemo(() => {
    if (!flight) return null;
    const index = findCurrentFixIndex(flight, currentTimeMs);
    if (index < 0) return null;
    const current = flight.fixes[index];
    const next = flight.fixes[index + 1];
    const currentAltM = pickAltitude(current, altitudeSource);
    if (currentAltM === null) return null;
    if (!next) {
      return {
        latitude: current.latitude,
        longitude: current.longitude,
        altM: currentAltM,
      };
    }

    const spanMs = next.timeMs - current.timeMs;
    const ratio = spanMs > 0 ? (currentTimeMs - current.timeMs) / spanMs : 0;
    const nextAltM = pickAltitude(next, altitudeSource);
    const interpolatedAltM =
      nextAltM === null
        ? currentAltM
        : currentAltM + (nextAltM - currentAltM) * ratio;

    return {
      latitude: current.latitude + (next.latitude - current.latitude) * ratio,
      longitude:
        current.longitude + (next.longitude - current.longitude) * ratio,
      altM: interpolatedAltM,
    };
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
  const position = useCurrentInterpolatedPosition();

  const nextFeatures = useMemo<ArrivalHeightFeature[]>(() => {
    if (!showArrivalHeights || !position) return [];
    const { latitude, longitude, altM } = position;

    const features: ArrivalHeightFeature[] = [];
    for (const lz of landingZones) {
      if (!visibleLandingZoneIds.has(lz.id)) continue;
      const distM = haversineDistanceM(
        latitude,
        longitude,
        lz.latitude,
        lz.longitude,
      );
      if (distM > ARRIVAL_HEIGHT_MAX_DISTANCE_M) continue;
      const heightM = arrivalHeightAboveGroundM(
        latitude,
        longitude,
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

    return features;
  }, [
    showArrivalHeights,
    position,
    landingZones,
    visibleLandingZoneIds,
    localCheckParams,
  ]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[arrivalHeights] ${nextFeatures.length} labels`);
    }
  }, [nextFeatures]);

  // Preserve the previous array identity when nothing changed at label
  // granularity, so downstream memos (`buildArrivalHeightsGeoJSON`) bail out
  // and MapLibre `setData` doesn't fire. This is where the perceived lag
  // lives — the compute above takes <1 ms; the symbol-layer re-tile is
  // orders of magnitude more expensive.
  const [stableFeatures, setStableFeatures] =
    useState<ArrivalHeightFeature[]>(nextFeatures);
  if (
    stableFeatures !== nextFeatures &&
    !arrivalHeightFeaturesEqual(stableFeatures, nextFeatures)
  ) {
    setStableFeatures(nextFeatures);
  }
  return stableFeatures;
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
  const position = useCurrentInterpolatedPosition();
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const flight = useFlightStore((s) => s.flight);
  const sourceFixIndex = useMemo(
    () => findCurrentFixIndex(flight, currentTimeMs),
    [flight, currentTimeMs],
  );

  const path = useMemo<EscapePath | null>(() => {
    if (!showEscapePath || !position) return null;
    if (!elevationGrid || !localCheckResult) return null;
    if (sourceFixIndex < 0) return null;

    const { latitude, longitude, altM } = position;
    const best = pickBestLandingZone(
      latitude,
      longitude,
      altM,
      landingZones,
      localCheckParams.workingLD,
    );
    if (!best) return null;

    return computeEscapePath({
      sourceFixIndex,
      sourceLat: latitude,
      sourceLon: longitude,
      sourceAltM: altM,
      lz: best.lz,
      grid: elevationGrid,
      params: localCheckParams,
    });
  }, [
    showEscapePath,
    position,
    sourceFixIndex,
    elevationGrid,
    localCheckResult,
    landingZones,
    localCheckParams,
  ]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(`[escapePath] ${path?.profile.length ?? 0} profile pts`);
    }
  }, [path]);

  return path;
}
