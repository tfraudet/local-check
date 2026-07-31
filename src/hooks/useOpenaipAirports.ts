import { useEffect, useRef } from 'react';
import { useFlightStore } from '../state/useFlightStore';
import { fetchOpenAipAirports, OpenAipApiError } from '../services/openaipApi';

/** Translate an OpenAipApiError (or arbitrary throw) into a friendly
 * user-facing payload for the service-error banner. */
function toServiceError(err: unknown): {
  title: string;
  message: string;
  hint?: string;
} {
  if (err instanceof OpenAipApiError) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return {
        title: 'OpenAIP rejected the request',
        message:
          'OpenAIP returned an authorization error. The public airport catalog will not be available on the map.',
        hint: 'If this persists, check the OpenAIP status page or your proxy configuration.',
      };
    }
    if (err.statusCode === 429) {
      return {
        title: 'OpenAIP rate-limited',
        message:
          'OpenAIP is throttling requests. New airports will not appear on the map for a short cooldown.',
        hint: 'The app will automatically retry after the cooldown; you can also pan the map to trigger a fresh fetch later.',
      };
    }
    if (err.statusCode && err.statusCode >= 500) {
      return {
        title: 'OpenAIP is unavailable',
        message: `OpenAIP returned HTTP ${err.statusCode}. Airports may be missing from the map.`,
        hint: 'The service is likely temporarily down; try again in a few minutes.',
      };
    }
    return {
      title: 'Could not load airports from OpenAIP',
      message: err.message,
    };
  }
  return {
    title: 'Could not load airports from OpenAIP',
    message: err instanceof Error ? err.message : String(err),
  };
}

type Bbox = [number, number, number, number];

/** Debounce window applied to `moveend` bursts. Long enough that a pan
 * through several intermediate viewports only triggers one fetch. */
const DEBOUNCE_MS = 700;

/**
 * Skip fetching when the viewport is wider than this many degrees in either
 * axis — at country scale OpenAIP would return thousands of airports and
 * clutter the map. Roughly matches a zoom level of ~6.
 */
const MAX_SPAN_DEG = 8;

/**
 * How much to pad the bbox we request beyond the actual viewport (in each
 * direction). Pre-fetching neighbouring area means small pans/zooms fall
 * inside the last fetched region and skip the API call entirely.
 */
const FETCH_PAD_DEG = 0.3;

/** Base cooldown after a 429; doubles on each successive 429 in a row. */
const RATE_LIMIT_BACKOFF_MS = 30_000;

/**
 * Watches `visibleBounds` in the store and fetches OpenAIP airports for
 * the current viewport, merging them into the landing-zones catalog.
 *
 * The fetch is debounced during panning and skipped when the viewport is
 * already contained in a previously-fetched (padded) bbox. On HTTP 429 the
 * hook stops issuing requests for an exponentially growing cooldown so we
 * don't compound the rate-limit hit.
 */
export function useOpenaipAirports() {
  const visibleBounds = useFlightStore((s) => s.visibleBounds);
  const addLandingZones = useFlightStore((s) => s.addLandingZones);
  const pushServiceError = useFlightStore((s) => s.pushServiceError);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchedRegionsRef = useRef<Bbox[]>([]);
  const cooldownUntilRef = useRef(0);
  const rateLimitStrikesRef = useRef(0);

  useEffect(() => {
    if (!visibleBounds) return;
    const [minLon, minLat, maxLon, maxLat] = visibleBounds;
    if (maxLon - minLon > MAX_SPAN_DEG || maxLat - minLat > MAX_SPAN_DEG) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (Date.now() < cooldownUntilRef.current) return;
      if (isContained(visibleBounds, fetchedRegionsRef.current)) return;

      const padded = padBbox(visibleBounds, FETCH_PAD_DEG);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetchOpenAipAirports(padded, controller.signal)
        .then((zones) => {
          if (controller.signal.aborted) return;
          fetchedRegionsRef.current.push(padded);
          rateLimitStrikesRef.current = 0;
          if (zones.length > 0) addLandingZones(zones);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          if (err instanceof OpenAipApiError && err.statusCode === 429) {
            const wait = RATE_LIMIT_BACKOFF_MS * 2 ** rateLimitStrikesRef.current;
            cooldownUntilRef.current = Date.now() + wait;
            rateLimitStrikesRef.current += 1;
            console.warn(`[openaip] rate limited — cooling down for ${wait}ms`);
          } else {
            console.warn('[openaip] fetch failed:', err);
          }
          const friendly = toServiceError(err);
          pushServiceError({
            service: 'openaip',
            title: friendly.title,
            message: friendly.message,
            hint: friendly.hint,
          });
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visibleBounds, addLandingZones, pushServiceError]);
}

function isContained(view: Bbox, regions: Bbox[]): boolean {
  return regions.some(
    (r) => view[0] >= r[0] && view[1] >= r[1] && view[2] <= r[2] && view[3] <= r[3],
  );
}

function padBbox(b: Bbox, deg: number): Bbox {
  return [
    Math.max(-180, b[0] - deg),
    Math.max(-90, b[1] - deg),
    Math.min(180, b[2] + deg),
    Math.min(90, b[3] + deg),
  ];
}
