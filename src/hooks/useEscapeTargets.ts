import { useEffect, useMemo } from 'react';
import type { ArrivalHeightFeature } from '../components/map/geojson';
import { useFlightStore } from '@/state/useFlightStore';
import { findCurrentFixIndex } from '@/domain/flight';
import { haversineDistanceM, pickAltitude } from '@/domain/units';
import { arrivalHeightAboveGroundM, classifyArrival, pickBestLandingZone } from '@/domain/arrival';
import { computeEscapePath, type EscapePath } from '@/domain/escapePath';

/** Skip arrival-height labels for LZs beyond this range — far LZs are
 * never reachable and only clutter the map. */
const ARRIVAL_HEIGHT_MAX_DISTANCE_KM = 60;
const ARRIVAL_HEIGHT_MAX_DISTANCE_M = ARRIVAL_HEIGHT_MAX_DISTANCE_KM * 1000;

export function useArrivalHeightFeatures(): ArrivalHeightFeature[] {
  const showArrivalHeights = useFlightStore((s) => s.showArrivalHeights);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const settings = useFlightStore((s) => s.settings);
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  const nextFeatures = useMemo<ArrivalHeightFeature[]>(() => {
    if (!showArrivalHeights || !flight) return [];
    const index = findCurrentFixIndex(flight, currentTimeMs);
    if (index < 0) return [];
    const position = flight.fixes[index];
    const latitude = position.latitude;
    const longitude = position.longitude;
    const altM = pickAltitude(position, altitudeSource);
    if (altM === null) return [];   

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
        settings.workingLD,
      );
      features.push({
        id: lz.id,
        latitude: lz.latitude,
        longitude: lz.longitude,
        arrivalHeightM: heightM,
        status: classifyArrival(heightM, settings.arrivalHeightM),
      });
    }

    return features;
  }, [showArrivalHeights, landingZones, visibleLandingZoneIds, settings, flight, currentTimeMs, altitudeSource]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[useMemo<ArrivalHeightFeature[]>()]', nextFeatures);
    }
  }, [nextFeatures]);

  return nextFeatures;
}

/**
 * Escape path from the current position to the best-arrival LZ — the same
 * LZ the greenest arrival-height label points at (Phase 3, FR-3-1).
 */
export function useCurrentEscapePath(): EscapePath | null {
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const settings = useFlightStore((s) => s.settings);

  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const flight = useFlightStore((s) => s.flight);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);


  const nextPath = useMemo<EscapePath | null>(() => {
    // const startTime = import.meta.env.DEV ? performance.now() : 0;

    if ( !flight) return null;
    if (!elevationGrid || !localCheckResult) return null;

    const index = findCurrentFixIndex(flight, currentTimeMs);
    if (index < 0) return null;
    const position = flight.fixes[index];
    const latitude = position.latitude;
    const longitude = position.longitude;
    const altM = pickAltitude(position, altitudeSource);
    if (altM === null) return null;   

    const best = pickBestLandingZone(
      latitude,
      longitude,
      altM,
      landingZones,
      settings.workingLD,
    );
    if (!best) return null;
    const lz = best.lz;

    // Extend the profile 20% beyond the source→LZ distance so the chart
    // always shows some post-LZ context, scaled to the escape length.
    const targetDistM = haversineDistanceM(
      position.latitude,
      position.longitude,
      lz.latitude,
      lz.longitude,
    );

    const path = computeEscapePath({
      sourceFixIndex: index,
      sourceLat: latitude,
      sourceLon: longitude,
      sourceAltM: altM,
      lz: best.lz,
      grid: elevationGrid,
      params: settings,
      extraDistanceM: targetDistM * 0.2,
    });

    // if (import.meta.env.DEV) {
    //   console.debug(
    //     `[useCurrentEscapePath()] ${Math.round(performance.now() - startTime)} ms`,
    //   );
    // }

    return path;
  }, [elevationGrid, localCheckResult, landingZones, settings, flight, currentTimeMs, altitudeSource]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[useCurrentEscapePath()]', nextPath);
    }
  }, [nextPath]);

  return nextPath;

}
