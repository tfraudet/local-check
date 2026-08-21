import { useEffect, useMemo } from 'react';
import type { ArrivalHeightFeature } from '../components/map/geojson';
import { useFlightStore } from '@/state/useFlightStore';
import { findCurrentFixIndex } from '@/domain/flight';
import { haversineDistanceM, pickAltitude } from '@/domain/units';
import { arrivalHeightAboveGroundM, classifyArrival, pickBestLandingZone } from '@/domain/arrival';
import {
  computeEscapePath,
  type EscapePath,
  type EscapeRouting,
} from '@/domain/escapePath';
import { routeToLz } from '@/domain/routing/routeToLz';
import { useThrottledValue } from './useThrottledValue';

/** Skip arrival-height labels for LZs beyond this range — far LZs are
 * never reachable and only clutter the map. */
const ARRIVAL_HEIGHT_MAX_DISTANCE_KM = 60;
const ARRIVAL_HEIGHT_MAX_DISTANCE_M = ARRIVAL_HEIGHT_MAX_DISTANCE_KM * 1000;

/** Recompute at most this often during replay — terrain-aware routing runs a
 * Theta* search per visible LZ, synchronously on the main thread, so redoing
 * it on every ~16ms animation frame causes visible jank. */
const ESCAPE_PATH_RECOMPUTE_THROTTLE_MS = 200;

export function useArrivalHeightFeatures(): ArrivalHeightFeature[] {
  const showArrivalHeights = useFlightStore((s) => s.settings.showArrivalHeights);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const settings = useFlightStore((s) => s.settings);
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  const elevationGrid = useFlightStore((s) => s.elevationGrid);

  const throttledTimeMs = useThrottledValue(currentTimeMs, ESCAPE_PATH_RECOMPUTE_THROTTLE_MS);

  const nextFeatures = useMemo<ArrivalHeightFeature[]>(() => {
    if (!showArrivalHeights || !flight) return [];
    const index = findCurrentFixIndex(flight, throttledTimeMs);
    if (index < 0) return [];
    const position = flight.fixes[index];
    const latitude = position.latitude;
    const longitude = position.longitude;
    const altM = pickAltitude(position, altitudeSource, flight.qnhOffsetM ?? 0);
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

      // Terrain-aware routing: use the routed distance when enabled and a
      // grid is available. `routeToLz` short-circuits to straight-line when
      // the direct segment already clears terrain, so the cost is only
      // paid for LZs behind ridges.
      let routedDistanceM: number | undefined;
      if (settings.terrainAwareRouting && elevationGrid) {
        const route = routeToLz({
          sourceLat: latitude,
          sourceLon: longitude,
          sourceAltM: altM,
          targetLat: lz.latitude,
          targetLon: lz.longitude,
          workingLD: settings.workingLD,
          groundClearanceM: settings.groundClearanceM,
          grid: elevationGrid,
          maxNodes: 5_000,
          targetElevM: lz.elevationM ?? undefined,
        });
        if (route) routedDistanceM = route.distanceM;
      }

      const heightM = arrivalHeightAboveGroundM(
        latitude,
        longitude,
        altM,
        lz,
        settings.workingLD,
        routedDistanceM,
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
  }, [showArrivalHeights, landingZones, visibleLandingZoneIds, settings, flight, throttledTimeMs, altitudeSource, elevationGrid]);

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
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const settings = useFlightStore((s) => s.settings);

  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const flight = useFlightStore((s) => s.flight);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  const throttledTimeMs = useThrottledValue(currentTimeMs, ESCAPE_PATH_RECOMPUTE_THROTTLE_MS);

  const nextPath = useMemo<EscapePath | null>(() => {
    // const startTime = import.meta.env.DEV ? performance.now() : 0;

    if ( !flight) return null;
    if (!elevationGrid || !localCheckResult) return null;

    const index = findCurrentFixIndex(flight, throttledTimeMs);
    if (index < 0) return null;
    const position = flight.fixes[index];
    const latitude = position.latitude;
    const longitude = position.longitude;
    const altM = pickAltitude(position, altitudeSource, flight.qnhOffsetM ?? 0);
    if (altM === null) return null;   

    // When terrain-aware routing is on, distance-based comparison uses
    // routed metres so the best-LZ pick reflects real detour costs.
    const distanceFn = settings.terrainAwareRouting
      ? (lz: typeof landingZones[number]) => {
          const route = routeToLz({
            sourceLat: latitude,
            sourceLon: longitude,
            sourceAltM: altM,
            targetLat: lz.latitude,
            targetLon: lz.longitude,
            workingLD: settings.workingLD,
            groundClearanceM: settings.groundClearanceM,
            grid: elevationGrid,
            maxNodes: 5_000,
            targetElevM: lz.elevationM ?? undefined,
          });
          return route ? route.distanceM : null;
        }
      : undefined;

    const best = pickBestLandingZone(
      latitude,
      longitude,
      altM,
      landingZones.filter((z) => visibleLandingZoneIds.has(z.id)),
      settings.workingLD,
      distanceFn,
    );
    if (!best) return null;
    const lz = best.lz;

    // For the escape polyline, compute the full route (path + distance) to
    // the chosen LZ. Cheap re-invocation: `routeToLz` short-circuits to
    // straight-line when terrain isn't in the way.
    //
    // Larger node budget than the per-LZ loops above: this is one search per
    // replay tick, not one per visible LZ, and it is the path actually drawn
    // on the map. A coarse search grid stays *safe* (every segment is still
    // clearance-checked at DEM resolution) but snaps detours to a ~800 m
    // lattice and gives up on valleys it cannot thread.
    const route = settings.terrainAwareRouting
      ? routeToLz({
          sourceLat: latitude,
          sourceLon: longitude,
          sourceAltM: altM,
          targetLat: lz.latitude,
          targetLon: lz.longitude,
          workingLD: settings.workingLD,
          groundClearanceM: settings.groundClearanceM,
          grid: elevationGrid,
          maxNodes: 30_000,
          targetElevM: lz.elevationM ?? undefined,
          onFailure: import.meta.env.DEV
            ? (reason) =>
                console.log(
                  `[useCurrentEscapePath] no route to ${lz.id}: ${reason}`,
                )
            : undefined,
        })
      : null;

    // Which of the four outcomes we are in. `isStraightLine` means the direct
    // segment was *verified* clear (short-circuit, or the search returning it
    // unchanged); a null route means nothing safe was found and the straight
    // line below is reference geometry only.
    const routing: EscapeRouting = !settings.terrainAwareRouting
      ? 'off'
      : route === null
        ? 'no-safe-path'
        : route.isStraightLine
          ? 'straight-clear'
          : 'routed';

    // Extend the profile 20% beyond the source→LZ distance so the chart
    // always shows some post-LZ context, scaled to the escape length.
    const targetDistM = route
      ? route.distanceM
      : haversineDistanceM(
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
      route: route ? route.path : undefined,
      routing,
    });

    // if (import.meta.env.DEV) {
    //   console.debug(
    //     `[useCurrentEscapePath()] ${Math.round(performance.now() - startTime)} ms`,
    //   );
    // }

    return path;
  }, [elevationGrid, localCheckResult, landingZones, visibleLandingZoneIds, settings, flight, throttledTimeMs, altitudeSource]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[useCurrentEscapePath()]', nextPath);
    }
  }, [nextPath]);

  return nextPath;

}
