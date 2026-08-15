import { useEffect } from 'react';
import { useFlightStore } from '../state/useFlightStore';

/**
 * Kick off `runLocalCheck` whenever its required inputs or algorithm
 * parameters change. Needed because the outlanding database is auto-loaded on
 * app start, so there is no user action that would otherwise trigger the
 * initial computation after an IGC upload.
 */
export function useAutoLocalCheck() {
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const runLocalCheck = useFlightStore((s) => s.runLocalCheck);
  const settings = useFlightStore((s) => s.settings);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  useEffect(() => {
    if (!flight || !elevationGrid || landingZones.length === 0) return;
    void runLocalCheck();
  }, [
    flight,
    elevationGrid,
    landingZones,
    visibleLandingZoneIds,
    settings,
    altitudeSource,
    runLocalCheck,
  ]);
}
