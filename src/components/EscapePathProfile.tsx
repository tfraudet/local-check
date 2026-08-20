import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useFlightStore } from '../state/useFlightStore';
import { useTheme } from "./theme-provider";
import type { EscapePath } from '../domain/escapePath';
import { STATUS_COLORS } from '../domain/phaseColors';

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
interface EscapePathProfileProps {
  escapePath: EscapePath | null;
}

export function EscapePathProfile({ escapePath }: EscapePathProfileProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const { theme } = useTheme();

  const flight = useFlightStore((s) => s.flight);
  const landingZones = useFlightStore((s) => s.landingZones);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const localCheckParams = useFlightStore((s) => s.settings);

  // Read the latest escape path (and arrival buffer) from refs inside
  // uPlot's option closures so the chart can be created ONCE and updated
  // via `setData` — recreating uPlot on every replay tick (as the memo
  // above changes each frame) saturates the main thread and starves the
  // MapLibre paint that keeps the arrival-height labels in sync.
  const escapePathRef = useRef<EscapePath | null>(escapePath);
  const arrivalHeightMRef = useRef(localCheckParams.arrivalHeightM);
  const groundClearanceMRef = useRef(localCheckParams.groundClearanceM);
  // Sync refs in a layout effect so they are updated before the `setData`
  // effect below fires uPlot's `draw` hook.
  useEffect(() => {
    escapePathRef.current = escapePath;
    arrivalHeightMRef.current = localCheckParams.arrivalHeightM;
    groundClearanceMRef.current = localCheckParams.groundClearanceM;
  });

  // Build the uPlot chart when it first has data or when the theme /
  // translations change; recreated only on those (rare) transitions.
  const hasEscapePath = escapePath !== null;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = escapePathRef.current;
    if (!initial) return;

    const distanceKm = initial.profile.map((p) => p.distFromSourceM / 1000);
    const terrain = initial.profile.map((p) => p.terrainM);
    const glide = initial.profile.map((p) => p.glideAltM);
    const initialClearance = groundClearanceMRef.current;
    const clearance = initial.profile.map((p) =>
      initialClearance > 0 && p.terrainM !== null
        ? p.terrainM + initialClearance
        : null,
    );
    const data: uPlot.AlignedData = [distanceKm, terrain, clearance, glide];

    const { axisStroke, gridStroke } = getChartColors(theme === 'dark');

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
          label: t('escapePath.groundClearanceSeries'),
          stroke: 'rgba(147, 51, 234, 0.9)',
          width: 1,
          dash: [4, 4],
          points: { show: false },
        },
        {
          label: t('escapePath.glideSeries'),
          stroke: () =>
            STATUS_COLOR_FOR_PATH[
              escapePathRef.current?.status ?? 'in-local'
            ],
          width: 2,
          points: { show: false },
        },
      ],
      cursor: { show: false },
      hooks: {
        // Overlay two guide lines: the arrival-height target and the LZ
        // marker at the terminal distance. Drawn after the base chart so
        // they sit on top of the series.
        draw: [
          (u: uPlot) => {
            const ep = escapePathRef.current;
            if (!ep) return;
            const ctx = u.ctx;
            const { left, top, width: bw, height: bh } = u.bbox;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, bw, bh);
            ctx.clip();

            const arrivalTargetAltM = ep.lzElevM + arrivalHeightMRef.current;
            const lzDistKm = ep.totalDistanceM / 1000;

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
            const yLzGround = u.valToPos(ep.lzElevM, 'y', true);
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
          range: () => [
            0,
            ((escapePathRef.current?.totalDistanceM ?? 0) / 1000) * 1.2,
          ],
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
  }, [theme, t, hasEscapePath]);

  // Every replay tick, push the new profile into the existing chart with
  // `setData` — no destroy/recreate, so the main thread stays free for
  // MapLibre.
  useEffect(() => {
    const plot = uplotRef.current;
    if (!plot || !escapePath) return;
    const distanceKm = escapePath.profile.map((p) => p.distFromSourceM / 1000);
    const terrain = escapePath.profile.map((p) => p.terrainM);
    const glide = escapePath.profile.map((p) => p.glideAltM);
    const gc = localCheckParams.groundClearanceM;
    const clearance = escapePath.profile.map((p) =>
      gc > 0 && p.terrainM !== null ? p.terrainM + gc : null,
    );
    plot.setData([distanceKm, terrain, clearance, glide]);
  }, [escapePath, localCheckParams.groundClearanceM]);

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
    <div className="flex h-full w-[30%] shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 py-2 text-xs">
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
          i18nKey={
            escapePath.waypoints.length > 2
              ? 'escapePath.profileSubtitleRouted'
              : 'escapePath.profileSubtitle'
          }
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
          <b className="text-foreground" style={{ color: statusColor }}>
            {escapePath.arrivalHeightM >= 0 ? '+' : ''}
            {Math.round(escapePath.arrivalHeightM)} m
          </b>
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
