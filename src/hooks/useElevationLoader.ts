import { useEffect, useRef, useState } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { fetchElevationGrid, ElevationApiError } from '../services/elevationApi';
import type { ElevationFetchProgress } from '../services/elevationApi';
import type { NormalizedFlight } from '../domain/flight';

/**
 * Translate an ElevationApiError (or arbitrary throw) into a friendly
 * user-facing `ServiceError` payload — mostly matters for HTTP 401
 * (invalid key) and 429 (rate limit), which are the two failures a pilot
 * is most likely to hit in practice.
 */
function toServiceError(err: unknown): {
  title: string;
  message: string;
  hint?: string;
} {
  if (err instanceof ElevationApiError) {
    const svc = err.serviceName;
    if (err.statusCode === 401 || err.statusCode === 403) {
      return {
        title: 'Elevation API rejected the request',
        message: `${svc} returned an authorization error. Your API key is invalid, expired, or lacks access to the selected DEM.`,
        hint: 'Check your API key in your environment file.',
      };
    }
    if (err.statusCode === 429) {
      return {
        title: 'Elevation API rate-limited',
        message: `${svc} returned 429 Too Many Requests. Terrain data will not be available for a short while.`,
        hint: 'Wait a minute and reload the flight to retry.',
      };
    }
    if (err.statusCode && err.statusCode >= 500) {
      return {
        title: 'Elevation service is unavailable',
        message: `${svc} returned HTTP ${err.statusCode}.`,
        hint: 'The service is likely temporarily down; try again in a few minutes.',
      };
    }
    return {
      title: 'Terrain data unavailable',
      message: err.message,
    };
  }
  return {
    title: 'Terrain data unavailable',
    message: err instanceof Error ? err.message : String(err),
  };
}

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
  const pushServiceError = useFlightStore((s) => s.pushServiceError);
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
        const friendly = toServiceError(err);
        setElevationLoadError(friendly.message);
        pushServiceError({
          service: 'elevation',
          title: friendly.title,
          message: friendly.message,
          hint: friendly.hint,
        });
      });

    return () => {
      controller.abort();
    };
  }, [flight, setElevationGrid, setElevationLoadError, pushServiceError]);

  return { isFetching, progress };
}
