import { useEffect, useRef } from 'react';
import { useFlightStore } from '../state/useFlightStore';

/**
 * Debounced trigger for the reachable-zone worker.
 *
 * Recomputes whenever the current replay position, the reachable-zone
 * parameters, or the shared local-check parameters change — as long as
 * the overlay is enabled. A trailing 250 ms debounce keeps scrubbing
 * smooth (see Phase 3 spec NFR-3T-3).
 */
export function useAutoReachableZone() {
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const showReachableZone = useFlightStore((s) => s.showReachableZone);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const reachableZoneParams = useFlightStore((s) => s.reachableZoneParams);
  const localCheckParams = useFlightStore((s) => s.localCheckParams);
  const runReachableZone = useFlightStore((s) => s.runReachableZone);

  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showReachableZone || !flight || !elevationGrid) return;

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      void runReachableZone();
    }, 250);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    flight,
    elevationGrid,
    showReachableZone,
    currentTimeMs,
    reachableZoneParams,
    localCheckParams,
    runReachableZone,
  ]);
}
