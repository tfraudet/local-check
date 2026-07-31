import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useFlightStore, findCurrentFixIndex } from '../state/useFlightStore';
import { useTheme } from '../hooks/useTheme';
import { computeEscapePath, type EscapePath } from '../domain/escapePath';
import { pickAltitude } from '../domain/units';
import { STATUS_COLORS } from '../domain/phaseColors';
import type { SampledPoint } from '../domain/localCheck';

/** Locate the sampled point closest in time to `timeMs`. */
function findNearestSample(
  samples: SampledPoint[],
  timeMs: number,
): SampledPoint | null {
  if (samples.length === 0) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  const a = samples[lo];
  const b = lo > 0 ? samples[lo - 1] : a;
  return Math.abs(a.timeMs - timeMs) < Math.abs(b.timeMs - timeMs) ? a : b;
}

const STATUS_COLOR_FOR_PATH: Record<EscapePath['status'], string> = {
  'in-local': STATUS_COLORS['in-local'],
  'in-local-marginal': STATUS_COLORS['in-local-marginal'],
  'out-of-local': STATUS_COLORS['out-of-local'],
};

function getChartColors(isDark: boolean) {
  return {
    axisStroke: isDark ? '#a1a1aa' : '#52525b',
    gridStroke: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
  };
}

/**
 * Compact altitude-profile mini-chart showing the terrain and glide plane
 * along the current escape path (source fix → best reachable LZ).
 * Rendered as the left pane (30 % width) of the barogram row.
 */
export function EscapePathProfilePanel() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const { theme } = useTheme();

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const landingZones = useFlightStore((s) => s.landingZones);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const localCheckParams = useFlightStore((s) => s.localCheckParams);

  // Locate the target LZ from the nearest sampled point; fall back to the
  // one with the smallest missing height when out-of-local.
  const escapePath = useMemo<EscapePath | null>(() => {
    if (!flight || !elevationGrid || !localCheckResult) return null;
    if (landingZones.length === 0) return null;

    const idx = findCurrentFixIndex(flight, currentTimeMs);
    if (idx < 0) return null;
    const fix = flight.fixes[idx];
    const altM = pickAltitude(fix, altitudeSource);
    if (altM === null) return null;

    const sample = findNearestSample(localCheckResult.samples, currentTimeMs);
    let targetId: string | null = sample?.bestLzId ?? null;
    if (!targetId) {
      // Fallback: closest LZ (haversine) — used when the current point is
      // out-of-local, so we can still visualise the "least bad" escape.
      let best: { id: string; d: number } | null = null;
      for (const lz of landingZones) {
        const dLat = lz.latitude - fix.latitude;
        const dLon = lz.longitude - fix.longitude;
        const d = dLat * dLat + dLon * dLon;
        if (!best || d < best.d) best = { id: lz.id, d };
      }
      targetId = best?.id ?? null;
    }
    if (!targetId) return null;

    const lz = landingZones.find((z) => z.id === targetId);
    if (!lz) return null;

    return computeEscapePath({
      sourceFixIndex: idx,
      sourceLat: fix.latitude,
      sourceLon: fix.longitude,
      sourceAltM: altM,
      lz,
      grid: elevationGrid,
      params: localCheckParams,
    });
  }, [
    flight,
    currentTimeMs,
    altitudeSource,
    elevationGrid,
    landingZones,
    localCheckResult,
    localCheckParams,
  ]);

  // (Re)build the uPlot chart when the escape path changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }
    if (!escapePath) return;

    const distanceKm = escapePath.profile.map((p) => p.distFromSourceM / 1000);
    const terrain = escapePath.profile.map((p) => p.terrainM);
    const glide = escapePath.profile.map((p) => p.glideAltM);
    const data: uPlot.AlignedData = [distanceKm, terrain, glide];

    const { axisStroke, gridStroke } = getChartColors(theme === 'dark');
    const stroke = STATUS_COLOR_FOR_PATH[escapePath.status];

    const arrivalTargetAltM = escapePath.lzElevM + localCheckParams.arrivalHeightM;
    const lzDistKm = escapePath.totalDistanceM / 1000;

    const opts: uPlot.Options = {
      width: container.clientWidth || 300,
      height: container.clientHeight || 200,
      series: [
        {},
        {
          label: t('escapePath.terrainSeries'),
          stroke: 'rgba(160, 100, 40, 0.7)',
          fill: 'rgba(160, 100, 40, 0.3)',
          width: 1,
          points: { show: false },
        },
        {
          label: t('escapePath.glideSeries'),
          stroke,
          width: 2,
          points: { show: false },
        },
      ],
      cursor: { points: { show: true }, sync: undefined },
      hooks: {
        // Overlay two guide lines: the arrival-height target and the LZ
        // marker at the terminal distance. Drawn after the base chart so
        // they sit on top of the series.
        draw: [
          (u: uPlot) => {
            const ctx = u.ctx;
            const { left, top, width: bw, height: bh } = u.bbox;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, bw, bh);
            ctx.clip();

            // Horizontal dashed line: arrival target altitude.
            const yTarget = u.valToPos(arrivalTargetAltM, 'y', true);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = STATUS_COLORS['in-local-marginal'];
            ctx.lineWidth = uPlot.pxRatio;
            ctx.beginPath();
            ctx.moveTo(left, yTarget);
            ctx.lineTo(left + bw, yTarget);
            ctx.stroke();

            // Vertical dashed line: LZ position.
            const xLz = u.valToPos(lzDistKm, 'x', true);
            ctx.strokeStyle = axisStroke;
            ctx.beginPath();
            ctx.moveTo(xLz, top);
            ctx.lineTo(xLz, top + bh);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          },
        ],
      },
      axes: [
        {
          label: t('escapePath.distance') + ' (km)',
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
        },
      ],
      scales: {
        x: { time: false },
      },
      legend: { show: false },
    };

    const plot = new uPlot(opts, data, container);
    uplotRef.current = plot;

    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
      uplotRef.current = null;
    };
  }, [escapePath, theme, t, localCheckParams.arrivalHeightM]);

  if (!flight || !localCheckResult || landingZones.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
        {t('escapePath.waiting')}
      </div>
    );
  }

  if (!escapePath) {
    return (
      <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
        {t('escapePath.empty')}
      </div>
    );
  }

  const statusColor = STATUS_COLOR_FOR_PATH[escapePath.status];
  const statusLabel =
    escapePath.status === 'in-local'
      ? t('escapePath.status.inLocal')
      : escapePath.status === 'in-local-marginal'
        ? t('escapePath.status.marginal')
        : t('escapePath.status.outOfLocal');

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs">
        <span className="font-medium">{t('escapePath.profileTitle')}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white"
          style={{ backgroundColor: statusColor }}
        >
          {statusLabel}
        </span>
      </div>
      <div className="flex items-center gap-3 px-2 py-1 text-[10px] text-muted-foreground">
        <span>
          {t('escapePath.distance')}:{' '}
          <b className="text-foreground">
            {(escapePath.totalDistanceM / 1000).toFixed(1)} km
          </b>
        </span>
        <span>
          {t('escapePath.arrivalHeight')}:{' '}
          <b className="text-foreground">
            {escapePath.arrivalHeightM >= 0 ? '+' : ''}
            {Math.round(escapePath.arrivalHeightM)} m
          </b>
        </span>
        <span>
          {t('escapePath.minMargin')}:{' '}
          <b className="text-foreground">
            {escapePath.minMarginM >= 0 ? '+' : ''}
            {Math.round(escapePath.minMarginM)} m
          </b>
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
