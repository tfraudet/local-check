import { useEffect } from 'react';
import { useFlightStore } from '../state/useFlightStore';

/**
 * Kick off `runLocalCheck` whenever its required inputs (flight, elevation
 * grid, landing zones) all become available or change. Needed because the
 * outlanding database is auto-loaded on app start, so there is no user
 * action (like dropping a .cup file) that would otherwise trigger the
 * initial computation after an IGC upload.
 */
export function useAutoLocalCheck() {
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const landingZones = useFlightStore((s) => s.landingZones);
  const runLocalCheck = useFlightStore((s) => s.runLocalCheck);

  useEffect(() => {
    if (!flight || !elevationGrid || landingZones.length === 0) return;
    void runLocalCheck();
  }, [flight, elevationGrid, landingZones, runLocalCheck]);
}
