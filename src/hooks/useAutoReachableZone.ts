import { useEffect } from 'react';
import { useFlightStore } from '../state/useFlightStore';

export function useAutoReachableZone() {
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const showReachableZone = useFlightStore((s) => s.settings.showReachableZone);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const reachableZoneParams = useFlightStore((s) => s.settings.reachableZoneParams);
  const settings = useFlightStore((s) => s.settings);
  const runReachableZone = useFlightStore((s) => s.runReachableZone);

  useEffect(() => {
    if (!showReachableZone || !flight || !elevationGrid) return;

    void runReachableZone();
  }, [flight, elevationGrid, showReachableZone, currentTimeMs, reachableZoneParams, settings, runReachableZone]);
}
