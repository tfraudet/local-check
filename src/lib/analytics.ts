/**
 * Thin wrapper around Umami's tracking API.
 *
 * The Umami script is injected at runtime from `initAnalytics()` when both
 * `VITE_UMAMI_SRC` and `VITE_UMAMI_WEBSITE_ID` are set, so local `npm run
 * dev` (with those vars unset) stays completely silent. `track()` is a
 * silent no-op when the script hasn't loaded (dev, ad-blocker, offline).
 */

type AnalyticsEventData = Record<string, string | number | boolean>;

export type AnalyticsEvent =
  | 'igc_upload'
  | 'igc_parse_error'
  | 'language_toggle'
  | 'theme_toggle'
  | 'help_open'
  | 'replay_play'
  | 'replay_speed_change'
  | 'setting_change';

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: AnalyticsEventData) => void;
    };
  }
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;

  const src = import.meta.env.VITE_UMAMI_SRC as string | undefined;
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
  if (!src || !websiteId) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = src;
  script.setAttribute('data-website-id', websiteId);
  document.head.appendChild(script);
}

export function track(event: AnalyticsEvent, data?: AnalyticsEventData): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // Analytics must never break the app.
  }
}
