import { useMemo } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { findCurrentFixIndex } from '../domain/flight';
import {
  arrivalHeightAboveGroundM,
  classifyArrival,
  pickBestLandingZone,
} from '../domain/arrival';
import { computeEscapePath, type EscapePath } from '../domain/escapePath';
import { pickAltitude } from '../domain/units';
import type { ArrivalHeightFeature } from '../components/map/geojson';

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

  return useMemo<ArrivalHeightFeature[]>(() => {
    if (!showArrivalHeights || !position) return [];
    const { fix, altM } = position;

    const features: ArrivalHeightFeature[] = [];
    for (const lz of landingZones) {
      if (!visibleLandingZoneIds.has(lz.id)) continue;
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
    return features;
  }, [
    showArrivalHeights,
    position,
    landingZones,
    visibleLandingZoneIds,
    localCheckParams,
  ]);
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
    const best = pickBestLandingZone(
      fix.latitude,
      fix.longitude,
      altM,
      landingZones,
      localCheckParams.workingLD,
    );
    if (!best) return null;

    return computeEscapePath({
      sourceFixIndex: index,
      sourceLat: fix.latitude,
      sourceLon: fix.longitude,
      sourceAltM: altM,
      lz: best.lz,
      grid: elevationGrid,
      params: localCheckParams,
    });
  }, [
    showEscapePath,
    position,
    elevationGrid,
    localCheckResult,
    landingZones,
    localCheckParams,
  ]);
}
