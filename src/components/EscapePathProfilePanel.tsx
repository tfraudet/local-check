import { useEffect, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useFlightStore, findCurrentFixIndex } from '../state/useFlightStore';
import { useTheme } from '../hooks/useTheme';
import { computeEscapePath, type EscapePath } from '../domain/escapePath';
import { reachableAltitudeAt } from '../domain/glide';
import { haversineDistanceKm, pickAltitude } from '../domain/units';
import { STATUS_COLORS } from '../domain/phaseColors';
import type { LandingZone } from '../domain/landingZone';

/**
 * Pick the "best" LZ from the pilot's current position: the one with the
 * highest arrival height above ground. When reachable LZs exist, this is
 * the one with the most margin over its ground; when everything is
 * out-of-local, it's the least-negative — semantically "the LZ closest to
 * being reachable", which is what a pilot debriefing wants.
 *
 * Uses the same math as the on-map arrival-height labels so the escape
 * path always points at the LZ the pilot sees as the greenest / least-red
 * (fixes an earlier mismatch where the sample-level bestLzId lagged the
 * cursor by up to `timeStepS` seconds).
 */
function pickBestLzForEscape(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  workingLD: number,
  landingZones: LandingZone[],
): LandingZone | null {
  let best: { lz: LandingZone; heightAboveGroundM: number } | null = null;
  for (const lz of landingZones) {
    const arrivalAltM = reachableAltitudeAt(
      fromLat,
      fromLon,
      fromAltM,
      lz.latitude,
      lz.longitude,
      workingLD,
    );
    const heightAboveGroundM = arrivalAltM - (lz.elevationM ?? 0);
    if (!best || heightAboveGroundM > best.heightAboveGroundM) {
      best = { lz, heightAboveGroundM };
    }
  }
  return best?.lz ?? null;
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

  const escapePath = useMemo<EscapePath | null>(() => {
    if (!flight || !elevationGrid || !localCheckResult) return null;
    if (landingZones.length === 0) return null;

    const idx = findCurrentFixIndex(flight, currentTimeMs);
    if (idx < 0) return null;
    const fix = flight.fixes[idx];
    const altM = pickAltitude(fix, altitudeSource);
    if (altM === null) return null;

    const lz = pickBestLzForEscape(
      fix.latitude,
      fix.longitude,
      altM,
      localCheckParams.workingLD,
      landingZones,
    );
    if (!lz) return null;

    // Extend the profile 20% beyond the source→LZ distance so the chart
    // always shows some post-LZ context, scaled to the escape length.
    const targetDistM =
      haversineDistanceKm(fix.latitude, fix.longitude, lz.latitude, lz.longitude) *
      1000;
    return computeEscapePath({
      sourceFixIndex: idx,
      sourceLat: fix.latitude,
      sourceLon: fix.longitude,
      sourceAltM: altM,
      lz,
      grid: elevationGrid,
      params: localCheckParams,
      extraDistanceM: targetDistM * 0.2,
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

            // Filled square marker at the LZ ground position — same look
            // as an airfield on the map.
            const yLzGround = u.valToPos(escapePath.lzElevM, 'y', true);
            const size = 9 * uPlot.pxRatio;
            ctx.fillStyle = '#3E6FC4';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 * uPlot.pxRatio;
            ctx.fillRect(xLz - size / 2, yLzGround - size / 2, size, size);
            ctx.strokeRect(xLz - size / 2, yLzGround - size / 2, size, size);

            ctx.restore();
          },
        ],
      },
      axes: [
        {
          // Axis title omitted so the chart bottom aligns with the
          // barogram's. Unit is baked into each tick label instead.
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
          values: (_u, splits) => splits.map((v) => `${v} km`),
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
        },
      ],
      scales: {
        x: {
          time: false,
          // Force the x-axis to always span 120 % of the source→LZ
          // distance, so the pilot sees some post-LZ context proportional
          // to the escape length.
          range: () => [0, (escapePath.totalDistanceM / 1000) * 1.2],
        },
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
  const targetLz = landingZones.find((z) => z.id === escapePath.lzId);
  const lzName = targetLz?.name ?? escapePath.lzId;

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
      <div className="px-2 pt-1 text-[10px] text-muted-foreground">
        <Trans
          i18nKey="escapePath.profileSubtitle"
          values={{
            lzName,
            lzElevM: Math.round(escapePath.lzElevM),
          }}
          components={{ b: <b className="text-foreground" /> }}
        />
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
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
