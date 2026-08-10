import { useEffect, useMemo } from 'react';
import type { ArrivalHeightFeature } from '../components/map/geojson';
import { useFlightStore } from '@/state/useFlightStore';
import { findCurrentFixIndex } from '@/domain/flight';
import { haversineDistanceM, pickAltitude } from '@/domain/units';
import { arrivalHeightAboveGroundM, classifyArrival } from '@/domain/arrival';

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
