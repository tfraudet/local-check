import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import {
  formatAltitude,
  formatDistance,
  formatDuration,
  formatSpeed,
} from '../domain/units';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

/**
 * Flight summary computed once at load time (no per-frame recomputation).
 * FR-M-19.
 */
export function FlightSummaryPanel() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);

  if (!flight) return null;

  const { summary } = flight;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('summary.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <Row label={t('summary.date')} value={summary.date ?? '—'} />
        <Row label={t('summary.pilot')} value={summary.pilotName ?? '—'} />
        <Row label={t('summary.glider')} value={summary.gliderType ?? '—'} />
        <Row
          label={t('summary.duration')}
          value={formatDuration(summary.durationMs)}
        />
        <Row
          label={t('summary.maxAltitude')}
          value={formatAltitude(summary.maxAltitudeM)}
        />
        <Row
          label={t('summary.minAltitude')}
          value={formatAltitude(summary.minAltitudeM)}
        />
        <Row
          label={t('summary.maxSpeed')}
          value={formatSpeed(summary.maxGroundSpeedKmh)}
        />
        <Row
          label={t('summary.distance')}
          value={formatDistance(summary.totalDistanceKm)}
        />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono tabular-nums">{value}</span>
    </>
  );
}
