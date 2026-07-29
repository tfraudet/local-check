import { useEffect, useRef, useState } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { fetchElevationGrid, ElevationApiError } from '../services/elevationApi';
import type { ElevationFetchProgress } from '../services/elevationApi';
import type { NormalizedFlight } from '../domain/flight';

function computeBbox(flight: NormalizedFlight): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const fix of flight.fixes) {
    if (fix.longitude < minLon) minLon = fix.longitude;
    if (fix.longitude > maxLon) maxLon = fix.longitude;
    if (fix.latitude < minLat) minLat = fix.latitude;
    if (fix.latitude > maxLat) maxLat = fix.latitude;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Automatically fetches terrain elevation grid whenever a new flight is loaded.
 * Writes results into the flight store (setElevationGrid / setElevationLoadError).
 */
export function useElevationLoader() {
  const flight = useFlightStore((s) => s.flight);
  const setElevationGrid = useFlightStore((s) => s.setElevationGrid);
  const setElevationLoadError = useFlightStore((s) => s.setElevationLoadError);
  const [progress, setProgress] = useState<ElevationFetchProgress | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!flight) {
      setProgress(null);
      return;
    }

    // Abort any previous in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsFetching(true);
    setProgress(null);

    const bbox = computeBbox(flight);

    fetchElevationGrid(bbox, (p) => {
      if (!controller.signal.aborted) setProgress(p);
    })
      .then((grid) => {
        if (!controller.signal.aborted) {
          setElevationGrid(grid);
          setIsFetching(false);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setIsFetching(false);
        const message =
          err instanceof ElevationApiError
            ? err.message
            : 'Terrain data unavailable.';
        setElevationLoadError(message);
      });

    return () => {
      controller.abort();
    };
  }, [flight, setElevationGrid, setElevationLoadError]);

  return { isFetching, progress };
}
