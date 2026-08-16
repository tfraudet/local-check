import { useEffect } from 'react';
import { parseCup } from '../domain/parseCup';
import { parseAuvergneOutlandings } from '../domain/parseAuvergneOutlandings';
import type { LandingZone } from '../domain/landingZone';
import { useFlightStore } from '../state/useFlightStore';

const ALPES_OUTLANDING_URL =
  'https://planeur-net.github.io/outlanding/guide_aires_securite.cup';
// 'https://planeur-net.github.io/outlanding/champs_des_alpes.cup';

// In production the app is hosted on aeroclub-issoire.fr itself, so
// this root-relative path is same-origin — no CORS, no proxy needed.
// In dev and `vite preview`, `vite.config.ts` proxies the same path
// to aeroclub-issoire.fr, so a single URL works everywhere.
const AUVERGNE_OUTLANDING_URL =
  '/wp-content/uploads/acph/outlanding-fields/outlanding-fields-db.json';

interface OutlandingSource {
  label: string;
  url: string;
  parse: (text: string) => LandingZone[];
}

const SOURCES: OutlandingSource[] = [
  {
    label: 'alpes',
    url: ALPES_OUTLANDING_URL,
    parse: (t) => parseCup(t, 'outlanding-alps').zones,
  },
  {
    label: 'auvergne',
    url: AUVERGNE_OUTLANDING_URL,
    parse: (t) => parseAuvergneOutlandings(t, 'outlanding-auvergne').zones,
  },
];

// Module-scoped so React 19 StrictMode's double-mount doesn't refire the
// fetch — and, more importantly, so the effect's cleanup does NOT abort a
// mid-flight request during the strict-mode remount cycle.
let loadedOnce = false;

/**
 * Fetches the shared outlanding-fields databases (Alpes .cup + Auvergne
 * JSON) once per page load and merges the parsed zones into the store,
 * tagged with their respective sources.
 */
export function useOutlandingDatabase() {
  const addLandingZones = useFlightStore((s) => s.addLandingZones);

  useEffect(() => {
    if (loadedOnce) return;
    loadedOnce = true;

    let failed = false;
    for (const src of SOURCES) {
      fetch(src.url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((text) => {
          const zones = src.parse(text);
          if (zones.length > 0) addLandingZones(zones);
        })
        .catch((err) => {
          failed = true;
          console.warn(`[outlanding:${src.label}] failed to load:`, err);
        })
        .finally(() => {
          if (failed) loadedOnce = false; // allow retry on next mount
        });
    }
  }, [addLandingZones]);
}
