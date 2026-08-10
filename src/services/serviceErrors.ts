/**
 * Shared translation of an HTTP-ish service failure into the
 * title/message/hint triple rendered by `ServiceErrorBanner`.
 *
 * Every external service (elevation DEMs, OpenAIP) fails the same handful
 * of ways — 401/403, 429, 5xx, everything else — so the ladder lives here
 * once and each caller only supplies its display name and the
 * user-visible consequence.
 */

import type { TFunction } from 'i18next';

export interface ServiceErrorPayload {
  title: string;
  message: string;
  hint?: string;
}

export interface DescribeServiceFailureOptions {
  t: TFunction;
  /** Display name of the failing service, e.g. "OpenAIP". */
  serviceName: string;
  /** i18n key under `errors.service.impact` describing the consequence. */
  impactKey: string;
}

function statusCodeOf(err: unknown): number | undefined {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export function describeServiceFailure(
  err: unknown,
  { t, serviceName, impactKey }: DescribeServiceFailureOptions,
): ServiceErrorPayload {
  const impact = t(`errors.service.impact.${impactKey}`);
  const status = statusCodeOf(err);
  const vars = { service: serviceName, impact, status };

  const band =
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rateLimit'
        : status !== undefined && status >= 500
          ? 'unavailable'
          : null;

  if (band) {
    return {
      title: t(`errors.service.${band}.title`, vars),
      message: t(`errors.service.${band}.message`, vars),
      hint: t(`errors.service.${band}.hint`, vars),
    };
  }

  return {
    title: t('errors.service.generic.title', vars),
    message: t('errors.service.generic.message', {
      ...vars,
      message: err instanceof Error ? err.message : String(err),
    }),
  };
}
