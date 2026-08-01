import { useEffect, useRef } from 'react';
import { useFlightStore } from '../state/useFlightStore';

/**
 * Throttled trigger for the reachable-zone worker.
 *
 * Recomputes whenever the current replay position, the reachable-zone
 * parameters, or the shared local-check parameters change — as long as
 * the overlay is enabled. Uses a leading-edge 250 ms throttle: if a
 * compute is already scheduled, let it fire with the latest store state
 * rather than cancelling and re-scheduling on every input change
 * (which would otherwise starve the timer during continuous replay,
 * so the overlay only appeared once the user pressed stop).
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
  const lastRunRef = useRef<number>(0);

  useEffect(() => {
    if (!showReachableZone || !flight || !elevationGrid) return;
    if (timeoutRef.current !== null) return;

    const THROTTLE_MS = 250;
    const delay = Math.max(
      0,
      THROTTLE_MS - (Date.now() - lastRunRef.current),
    );
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      lastRunRef.current = Date.now();
      void runReachableZone();
    }, delay);
  }, [
    flight,
    elevationGrid,
    showReachableZone,
    currentTimeMs,
    reachableZoneParams,
    localCheckParams,
    runReachableZone,
  ]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);
}
