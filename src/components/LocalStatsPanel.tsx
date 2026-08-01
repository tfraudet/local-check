import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { formatDuration, formatAltitude } from '../domain/units';

export function LocalStatsPanel() {
  const { t } = useTranslation();
  const result = useFlightStore((s) => s.localCheckResult);
  const isComputing = useFlightStore((s) => s.isComputingLocalCheck);
  const landingZones = useFlightStore((s) => s.landingZones);
  const seek = useFlightStore((s) => s.seek);

  if (landingZones.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('localCheck.stats.noResult')}
      </p>
    );
  }

  if (isComputing || !result) {
    return (
      <p className="animate-pulse text-xs text-muted-foreground">
        {t('localCheck.computing')}
      </p>
    );
  }

  const { stats } = result;

  if (stats.outOfLocalTimeMs === 0) {
    return (
      <p className="text-xs text-green-500">{t('localCheck.stats.allGood')}</p>
    );
  }

  return (
    <dl className="space-y-1 text-xs">
      <Row
        label={t('localCheck.stats.outOfLocalTime')}
        value={formatDuration(stats.outOfLocalTimeMs)}
        valueClass="text-red-500"
      />
      <Row
        label={t('localCheck.stats.outOfLocalPercent')}
        value={`${stats.outOfLocalPercent.toFixed(1)} %`}
        valueClass="text-red-500"
      />
      <Row
        label={t('localCheck.stats.meanMissingHeight')}
        value={formatAltitude(stats.meanMissingHeightM)}
      />
      <Row
        label={t('localCheck.stats.maxMissingHeight')}
        value={formatAltitude(stats.maxMissingHeightM)}
      />
      {stats.firstOutOfLocalTimeMs !== null && (
        <div className="flex items-center justify-between pt-1">
          <dt className="text-muted-foreground">
            {t('localCheck.stats.firstOutOfLocal')}
          </dt>
          <button
            onClick={() => seek(stats.firstOutOfLocalTimeMs!)}
            className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/20"
          >
            {t('localCheck.stats.seekTo')}
          </button>
        </div>
      )}
    </dl>
  );
}

function Row({
  label,
  value,
  valueClass = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-mono ${valueClass}`}>{value}</dd>
    </div>
  );
}
