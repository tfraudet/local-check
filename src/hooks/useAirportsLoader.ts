import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import {
  fetchAirportsForCountries,
  OpenAipExportApiError,
} from '../services/openaipExportApi';
import { detectCountriesFromFixes } from '../services/countryDetection';
import { describeServiceFailure } from '../services/serviceErrors';
import { boundingBoxOf, bufferBboxByKm } from '../domain/bbox';

const AIRPORTS_FIT_MARGIN_KM = 60;

/**
 * Fetches OpenAIP airports for every country the loaded flight crosses and
 * merges them into the landing-zones catalog. Runs in parallel with
 * `useElevationLoader`, right after IGC parse completes; per-country payloads
 * are cached in localStorage for 24 h so re-uploading the same flight (or any
 * flight in the same country) skips the network entirely.
 */
export function useAirportsLoader() {
  const { t } = useTranslation();
  // Subscribe to `fixes` (stable across in-session flight updates like QNH
  // recalibration) rather than the whole `flight` object.
  const fixes = useFlightStore((s) => s.flight?.fixes);
  const addLandingZones = useFlightStore((s) => s.addLandingZones);
  const setIsLoadingAirports = useFlightStore((s) => s.setIsLoadingAirports);
  const setAirportsLoaded = useFlightStore((s) => s.setAirportsLoaded);
  const setAirportsLoadError = useFlightStore((s) => s.setAirportsLoadError);
  const setException = useFlightStore((s) => s.setException);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fixes) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const countries = detectCountriesFromFixes(fixes);
    if (import.meta.env.DEV) {
      console.log('[openaip-export] countries traversed:', countries);
    }
    if (countries.length === 0) {
      setAirportsLoaded();
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = bufferBboxByKm(
      boundingBoxOf(fixes),
      AIRPORTS_FIT_MARGIN_KM,
    );

    setIsLoadingAirports(true);
    fetchAirportsForCountries(countries, controller.signal)
      .then((zones) => {
        if (controller.signal.aborted) return;
        const inBbox = zones.filter(
          (z) =>
            z.longitude >= minLon &&
            z.longitude <= maxLon &&
            z.latitude >= minLat &&
            z.latitude <= maxLat,
        );
        if (import.meta.env.DEV) {
          console.log(
            `[openaip-export] ${inBbox.length}/${zones.length} airports kept within ${AIRPORTS_FIT_MARGIN_KM}km of flight bbox`,
          );
        }
        if (inBbox.length > 0) addLandingZones(inBbox);
        setAirportsLoaded();
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const friendly = describeServiceFailure(err, {
          t,
          serviceName:
            err instanceof OpenAipExportApiError ? 'OpenAIP' : 'OpenAIP',
          impactKey: 'openaip',
        });
        console.warn('[openaip-export] fetch failed:', friendly.message, err);
        setAirportsLoadError(friendly.message);
        setException(err);
      });

    return () => {
      controller.abort();
    };
  }, [
    fixes,
    addLandingZones,
    setIsLoadingAirports,
    setAirportsLoaded,
    setAirportsLoadError,
    setException,
    t,
  ]);
}
