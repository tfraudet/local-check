import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { formatDuration } from '../domain/units';
import { STATUS_COLORS } from '../domain/phaseColors';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Progress } from './ui/progress';

export function LocalStatsPanel() {
  const { t } = useTranslation();
  const result = useFlightStore((s) => s.localCheckResult);
  const isComputing = useFlightStore((s) => s.isComputingLocalCheck);
  const landingZones = useFlightStore((s) => s.landingZones);
  const seek = useFlightStore((s) => s.seek);
  const arrivalHeightM = useFlightStore((s) => s.localCheckParams.arrivalHeightM);

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
  const hasBreach = stats.outOfLocalTimeMs > 0;
  const hasMarginal = stats.inLocalMarginalPercent > 0;

  const badge = hasBreach
    ? {
        label: t('localCheck.stats.badgeBreach'),
        variant: 'destructive' as const,
        className: '',
      }
    : hasMarginal
      ? {
          label: t('localCheck.stats.badgeMarginal'),
          variant: 'outline' as const,
          className:
            'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        }
      : {
          label: t('localCheck.stats.badgeAlwaysInLocal'),
          variant: 'outline' as const,
          className:
            'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        };

  const headlinePercent = hasBreach
    ? stats.outOfLocalPercent
    : hasMarginal
      ? stats.inLocalMarginalPercent
      : stats.inLocalPercent;
  const headlineClass = hasBreach
    ? 'text-destructive'
    : hasMarginal
      ? 'text-amber-500'
      : 'text-green-500';
  const captionKey = hasBreach
    ? 'localCheck.stats.captionOutOfLocal'
    : hasMarginal
      ? 'localCheck.stats.captionMarginal'
      : 'localCheck.stats.captionAlwaysInLocal';
  const captionTimeMs = hasBreach ? stats.outOfLocalTimeMs : null;
  const captionExits = hasBreach
    ? stats.outOfLocalExits
    : hasMarginal
      ? stats.inLocalMarginalExits
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase">
          {t('localCheck.stats.title')}
        </p>
        <Badge variant={badge.variant} className={badge.className}>
          {badge.label}
        </Badge>
      </div>

      <div>
        <p className={`text-3xl font-semibold tabular-nums ${headlineClass}`}>
          {headlinePercent.toFixed(1)} %
        </p>
        <p className="text-xs text-muted-foreground">
          {t(captionKey)}
          {captionTimeMs !== null && ` · ${formatDuration(captionTimeMs)}`}
          {captionExits !== null &&
            ` · ${t('localCheck.stats.exits', { count: captionExits })}`}
        </p>
      </div>

      {hasBreach || hasMarginal ? (
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full"
            style={{
              width: `${stats.outOfLocalPercent}%`,
              backgroundColor: STATUS_COLORS['out-of-local'],
            }}
          />
          <div
            className="h-full"
            style={{
              width: `${stats.inLocalMarginalPercent}%`,
              backgroundColor: STATUS_COLORS['in-local-marginal'],
            }}
          />
          <div
            className="h-full"
            style={{
              width: `${stats.inLocalPercent}%`,
              backgroundColor: STATUS_COLORS['in-local'],
            }}
          />
        </div>
      ) : (
        <Progress
          value={100}
          variant="success"
          className="w-full **:data-[slot=progress-track]:h-1.5"
        />
      )}

      {(hasBreach || hasMarginal) && (
        <div className="space-y-1 text-xs">
          <LegendRow
            color={STATUS_COLORS['in-local-marginal']}
            label={t('localCheck.legend.marginal', {
              height: Math.round(arrivalHeightM),
            })}
            percent={stats.inLocalMarginalPercent}
            count={stats.inLocalMarginalExits}
          />
          <LegendRow
            color={STATUS_COLORS['in-local']}
            label={t('localCheck.legend.inLocal')}
            percent={stats.inLocalPercent}
            count={stats.inLocalExits}
          />
        </div>
      )}

      {hasBreach ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label={t('localCheck.stats.minMissingHeight')}
              value={`${Math.round(stats.minMissingHeightM)} m`}
            />
            <StatTile
              label={t('localCheck.stats.maxMissingHeight')}
              value={`${Math.round(stats.maxMissingHeightM)} m`}
            />
          </div>
          {stats.firstOutOfLocalTimeMs !== null && (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={() => seek(stats.firstOutOfLocalTimeMs!)}
            >
              {t('localCheck.stats.seekToFirstBreach')}
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('localCheck.stats.lowestMargin')}{' '}
          <span className="font-mono tabular-nums">
            {stats.lowestMarginM >= 0 ? '+' : ''}
            {Math.round(stats.lowestMarginM)} m
          </span>
        </p>
      )}
    </div>
  );
}

function LegendRow({
  color,
  label,
  percent,
  count,
}: {
  color: string;
  label: string;
  percent: number;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="font-mono tabular-nums">
        {percent.toFixed(0)}% · {count}×
      </span>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <p className="font-mono text-sm tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
