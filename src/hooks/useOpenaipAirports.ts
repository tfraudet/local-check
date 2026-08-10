import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { fetchOpenAipAirports, OpenAipApiError } from '../services/openaipApi';
import { describeServiceFailure } from '../services/serviceErrors';
import { bboxContains, bufferBbox, type Bbox } from '../domain/bbox';

/** Debounce window applied to `moveend` bursts. Long enough that a pan
 * through several intermediate viewports only triggers one fetch. */
const DEBOUNCE_MS = 700;

/** Base cooldown after a 429; doubles on each successive 429 in a row. */
const RATE_LIMIT_BACKOFF_MS = 30_000;

/**
 * How much to pad the bbox we request beyond the actual viewport (in each
 * direction). Pre-fetching neighbouring area means small pans/zooms fall
 * inside the last fetched region and skip the API call entirely.
 */
const FETCH_PAD_DEG = 0.3;


/**
 * Fetches OpenAIP airports for the current flight, merging them into the landing-zones catalog.
 *
 * On HTTP 429 the hook stops issuing requests for an exponentially growing cooldown so we
 * don't compound the rate-limit hit.
 */
export function useOpenaipAirports() {
  const { t } = useTranslation();
  const visibleBounds = useFlightStore((s) => s.visibleBounds);

  const setException = useFlightStore((s) => s.setException);
  const addLandingZones = useFlightStore((s) => s.addLandingZones);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchedRegionsRef = useRef<Bbox[]>([]);
  const cooldownUntilRef = useRef(0);
  const rateLimitStrikesRef = useRef(0);

  useEffect(() => {
    if (!visibleBounds) return;
    
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (Date.now() < cooldownUntilRef.current) return;
 
      // Checks if at least one previously downloaded region (r) satisfies the condition inside.
      if (fetchedRegionsRef.current.some((r) => bboxContains(r, visibleBounds))) {
          if (import.meta.env.DEV) {
            console.log('Skipping OpenAIP fetch; the new region is already completely inside a previously fetched region', visibleBounds);
          }
        return;
      }
      const padded = bufferBbox(visibleBounds, FETCH_PAD_DEG);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      console.log('Fetching airports for bbox:', padded);
      fetchOpenAipAirports(padded, controller.signal)
        .then((zones) => {
          if (controller.signal.aborted) return;
          fetchedRegionsRef.current.push(padded);
          rateLimitStrikesRef.current = 0;
          if (zones.length > 0) addLandingZones(zones);
        })
        .catch((err) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          if (err instanceof OpenAipApiError && err.statusCode === 429) {
            const wait =
              RATE_LIMIT_BACKOFF_MS * 2 ** rateLimitStrikesRef.current;
            cooldownUntilRef.current = Date.now() + wait;
            rateLimitStrikesRef.current += 1;
            console.warn(`[openaip] rate limited — cooling down for ${wait}ms`);
          } else {
            console.warn('[openaip] fetch failed:', err);
          }
          const friendly = describeServiceFailure(err, {
            t,
            serviceName: 'OpenAIP',
            impactKey: 'openaip',
          });
          // pushServiceError({
          //   service: 'openaip',
          //   title: friendly.title,
          //   message: friendly.message,
          //   hint: friendly.hint,
          // });
          setException(err);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visibleBounds, addLandingZones, setException, t]);
}
