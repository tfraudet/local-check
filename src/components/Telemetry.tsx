import { sampleElevation } from "@/domain/elevation";
import { findCurrentFixIndex } from "@/domain/flight";
import { STATUS_COLORS } from "@/domain/phaseColors";
import { formatAltitude, formatSpeed, formatTimeUtc, formatVario, pickAltitude } from "@/domain/units";
import { useFlightStore } from "@/state/useFlightStore";
import { useTranslation } from "react-i18next";

export function Telemetry() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);

  if (!flight) return null;

  const index = findCurrentFixIndex(flight, currentTimeMs);
  if (index < 0) return null;

  const fix = flight.fixes[index];
  const derived = flight.derived[index];

  // Compute AGL on the fly: `flight.derived[i].aglM` is only populated when
  // the elevation grid was available at parse time; the grid usually loads
  // asynchronously after the flight, so read it directly here.
  let aglM: number | null = null;
  if (elevationGrid) {
    const terrain = sampleElevation(elevationGrid, fix.latitude, fix.longitude);
    if (!isNaN(terrain)) {
      const alt = pickAltitude(fix, altitudeSource);
      if (alt !== null) aglM = alt - terrain;
    }
  }

  const colorVario =
    derived?.verticalSpeedMs != null
      ? derived.verticalSpeedMs >= 0
        // ? "text-primary"
        ? STATUS_COLORS['in-local']
        // : "text-destructive"
        : STATUS_COLORS['out-of-local']
      : "text-foreground";

  return (
    <section className="border-y bg-background">
      <div className="grid grid-cols-2 gap-0 md:grid-cols-3 xl:grid-cols-6">
        <Row label={t('telemetry.time')} value={formatTimeUtc(fix.timeMs)} />
        <Row
          label={t('telemetry.pressureAltitude')}
          value={formatAltitude(fix.pressureAltitudeM)}
        />
        <Row
          label={t('telemetry.gnssAltitude')}
          value={formatAltitude(fix.gnssAltitudeM)}
        />
        <Row label={t('telemetry.agl')} value={formatAltitude(aglM)} />
        <Row
          label={t('telemetry.groundSpeed')}
          value={formatSpeed(derived?.groundSpeedKmh ?? null)}
        />
        <Row
          label={t('telemetry.vario')}
          value={formatVario(derived?.verticalSpeedMs ?? null)}
          color={colorVario}
        />
      </div>
    </section>
  );}

function Row({ label, value, color  = "text-foreground"}: { label: string; value: string; color ?: string }) {
  return (
    <div className="flex flex-col justify-center border-r px-3 py-1 last:border-r-0">
      <span className="font-mono text-xs tabular-nums font-semibold"  style={{ color: color }}>{value}</span>
      <span className="truncate text-2xs uppercase text-muted-foreground">{label}</span>
    </div>
  );
}