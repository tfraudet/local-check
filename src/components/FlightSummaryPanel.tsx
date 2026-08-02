import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { formatDistance, formatDuration, formatSpeed } from '../domain/units';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { Separator } from './ui/separator';
import { LocalStatsPanel } from './LocalStatsPanel';

/**
 * Flight summary computed once at load time (no per-frame recomputation).
 * FR-M-19.
 */
export function FlightSummaryPanel() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);

  if (!flight) return null;

  const { summary, fileName } = flight;

  const pilotGliderValue =
    summary.pilotName || summary.gliderType
      ? [summary.pilotName, summary.gliderType].filter(Boolean).join(' · ')
      : t('summary.notInFile');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{summary.date ?? '—'}</CardTitle>
        {fileName && (
          <CardDescription className="truncate">{fileName}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <section className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('summary.title')}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row
              label={t('summary.duration')}
              value={formatDuration(summary.durationMs)}
            />
            <Row
              label={t('summary.distance')}
              value={formatDistance(summary.totalDistanceKm)}
            />
            <Row
              label={t('summary.altitude')}
              value={`${Math.round(summary.minAltitudeM)} – ${Math.round(summary.maxAltitudeM)} m`}
            />
            <Row
              label={t('summary.maxSpeed')}
              value={formatSpeed(summary.maxGroundSpeedKmh)}
            />
            <Row label={t('summary.pilotGlider')} value={pilotGliderValue} />
          </dl>
        </section>
        <Separator />
        <LocalStatsPanel />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
  );
}
