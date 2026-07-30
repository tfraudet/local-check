import { useEffect } from 'react';
import { parseCup } from '../domain/parseCup';
import { useFlightStore } from '../state/useFlightStore';

const OUTLANDING_URL =
  'https://planeur-net.github.io/outlanding/champs_des_alpes.cup';

// Module-scoped so React 19 StrictMode's double-mount doesn't refire the
// fetch — and, more importantly, so the effect's cleanup does NOT abort a
// mid-flight request during the strict-mode remount cycle.
let loadedOnce = false;

/**
 * Fetches the shared outlanding fields database (SeeYou .cup) once per
 * page load and merges the parsed zones into the store, tagged
 * `outlanding-alps`.
 */
export function useOutlandingDatabase() {
  const addLandingZones = useFlightStore((s) => s.addLandingZones);

  useEffect(() => {
    if (loadedOnce) return;
    loadedOnce = true;

    fetch(OUTLANDING_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const result = parseCup(text, 'outlanding-alps');
        if (result.zones.length > 0) addLandingZones(result.zones);
      })
      .catch((err) => {
        loadedOnce = false; // allow a retry on next mount
        console.warn('[outlanding] failed to load:', err);
      });
  }, [addLandingZones]);
}
