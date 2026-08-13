import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import {
  fetchAirportsForCountries,
  OpenAipExportApiError,
} from '../services/openaipExportApi';
import { detectCountriesFromFixes } from '../services/countryDetection';
import { describeServiceFailure } from '../services/serviceErrors';

/**
 * Fetches OpenAIP airports for every country the loaded flight crosses and
 * merges them into the landing-zones catalog. Runs in parallel with
 * `useElevationLoader`, right after IGC parse completes; per-country payloads
 * are cached in localStorage for 24 h so re-uploading the same flight (or any
 * flight in the same country) skips the network entirely.
 */
export function useAirportsLoader() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);
  const addLandingZones = useFlightStore((s) => s.addLandingZones);
  const setIsLoadingAirports = useFlightStore((s) => s.setIsLoadingAirports);
  const setAirportsLoaded = useFlightStore((s) => s.setAirportsLoaded);
  const setAirportsLoadError = useFlightStore((s) => s.setAirportsLoadError);
  const setException = useFlightStore((s) => s.setException);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!flight) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const countries = detectCountriesFromFixes(flight.fixes);
    if (import.meta.env.DEV) {
      console.log('[openaip-export] countries traversed:', countries);
    }
    if (countries.length === 0) {
      setAirportsLoaded();
      return;
    }

    setIsLoadingAirports(true);
    fetchAirportsForCountries(countries, controller.signal)
      .then((zones) => {
        if (controller.signal.aborted) return;
        if (zones.length > 0) addLandingZones(zones);
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
    flight,
    addLandingZones,
    setIsLoadingAirports,
    setAirportsLoaded,
    setAirportsLoadError,
    setException,
    t,
  ]);
}
