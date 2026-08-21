import { useEffect } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { useThrottledValue } from './useThrottledValue';

/** Recompute at most this often during replay — the terrain-aware Dijkstra
 * pass is too expensive to redo on every ~16ms animation frame. */
const REACHABLE_ZONE_RECOMPUTE_THROTTLE_MS = 200;

export function useAutoReachableZone() {
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const showReachableZone = useFlightStore((s) => s.settings.showReachableZone);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const reachableZoneParams = useFlightStore((s) => s.settings.reachableZoneParams);
  const settings = useFlightStore((s) => s.settings);
  const runReachableZone = useFlightStore((s) => s.runReachableZone);

  const throttledTimeMs = useThrottledValue(currentTimeMs, REACHABLE_ZONE_RECOMPUTE_THROTTLE_MS);

  useEffect(() => {
    if (!showReachableZone || !flight || !elevationGrid) return;

    void runReachableZone();
  }, [flight, elevationGrid, showReachableZone, throttledTimeMs, reachableZoneParams, settings, runReachableZone]);
}
