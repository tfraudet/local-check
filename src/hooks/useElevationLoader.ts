import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import {
  fetchElevationGrid,
  ElevationApiError,
} from '../services/elevationApi';
import { describeServiceFailure } from '../services/serviceErrors';
import { boundingBoxOf, bufferBboxByKm } from '../domain/bbox';


const ELEVATION_FIT_MARGIN_KM = 20;

/**
 * Automatically fetches terrain elevation grid whenever a new flight is loaded.
 * Writes results into the flight store (setElevationGrid / setElevationLoadError).
 */
export function useElevationLoader() {
  const { t } = useTranslation();
  // Subscribe to `fixes` (stable across in-session updates like QNH
  // recalibration) rather than the whole `flight` object, so refreshing
  // `flight.derived` after a settings change does not re-trigger a fetch.
  const fixes = useFlightStore((s) => s.flight?.fixes);
  const setElevationGrid = useFlightStore((s) => s.setElevationGrid);
  const setElevationLoadError = useFlightStore((s) => s.setElevationLoadError);
  const setException = useFlightStore((s) => s.setException);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fixes) {
      return;
    }

    // Abort any previous in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const bbox = bufferBboxByKm(boundingBoxOf(fixes), ELEVATION_FIT_MARGIN_KM);
    if (import.meta.env.DEV) {
      console.log('Fetching elevation grid for bbox:', bbox);
    }

    fetchElevationGrid(bbox)
      .then((grid) => {
        if (!controller.signal.aborted) {
          setElevationGrid(grid);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const friendly = describeServiceFailure(err, {
          t,
          serviceName:
            err instanceof ElevationApiError
              ? err.serviceName
              : 'Elevation API',
          impactKey: 'elevation',
        });
        setElevationLoadError(friendly.message);
        setException(err);
      });

    return () => {
      controller.abort();
    };
  }, [fixes, setElevationGrid, setElevationLoadError, setException, t]);
}
