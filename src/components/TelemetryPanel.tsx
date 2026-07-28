import { useTranslation } from 'react-i18next';
import { useFlightStore, findCurrentFixIndex } from '../state/useFlightStore';
import {
  formatAltitude,
  formatLatLon,
  formatSpeed,
  formatTimeUtc,
  formatVario,
} from '../domain/units';

/**
 * Live readout of the fix at the current replay time: UTC time, position,
 * altitude (both sources), ground speed, vario (FR-M-18, FR-M-20).
 */
export function TelemetryPanel() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);

  if (!flight) return null;

  const index = findCurrentFixIndex(flight, currentTimeMs);
  if (index < 0) return null;

  const fix = flight.fixes[index];
  const derived = flight.derived[index];

  return (
    <section className="border-t bg-background">
      <div className="grid grid-cols-2 gap-0 md:grid-cols-3 xl:grid-cols-6">
        <Row label={t('telemetry.time')} value={formatTimeUtc(fix.timeMs)} />
        <Row
          label={t('telemetry.position')}
          value={formatLatLon(fix.latitude, fix.longitude)}
        />
        <Row
          label={t('telemetry.pressureAltitude')}
          value={formatAltitude(fix.pressureAltitudeM)}
        />
        <Row
          label={t('telemetry.gnssAltitude')}
          value={formatAltitude(fix.gnssAltitudeM)}
        />
        <Row
          label={t('telemetry.groundSpeed')}
          value={formatSpeed(derived?.groundSpeedKmh ?? null)}
        />
        <Row
          label={t('telemetry.vario')}
          value={formatVario(derived?.verticalSpeedMs ?? null)}
        />
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-14 flex-col justify-center border-r px-3 py-1 last:border-r-0">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}
