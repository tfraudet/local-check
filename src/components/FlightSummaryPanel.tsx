import { useFlightStore } from "../state/useFlightStore";
import { useTranslation } from "react-i18next";
import { Separator } from "./ui/separator";
import { formatDistance, formatDuration, formatSpeed } from "../domain/units";

export function FlightSummaryPanel() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);

  if (!flight) return null;

  const { summary, fileName } = flight;

  return (
    <div className="w-full space-y-3">
      <div>
        <p className="text-base font-medium">{summary.date ?? '—'}</p>
        {fileName && (
          <p className="truncate text-xs text-muted-foreground">{fileName}</p>
        )}
      </div>
      <Separator />
      <section className="space-y-2">
        <p className=" text-xs font-medium text-muted-foreground uppercase">
         
          {t('summary.title')}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 text-sm">
          <Row label={t('summary.pilot')} value={summary.pilotName ?? t('summary.notInFile')} />
          <Row label={t('summary.glider')} value={summary.gliderType ?? t('summary.notInFile')} />
          <Row label={t('summary.date')} value={summary.date ?? t('summary.notInFile')} />
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
        </dl>
      </section>

    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xs text-right font-mono whitespace-nowrap truncate">{value}</dd>
    </>
  );
}
