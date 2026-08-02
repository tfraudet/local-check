import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { useFlightStore } from '../state/useFlightStore';
import { useTheme } from '../hooks/useTheme';
import type { SampledPoint } from '../domain/localCheck';
import { sampleElevation } from '../domain/elevation';
import { STATUS_COLORS, getSegmentColor } from '../domain/phaseColors';

const DOWNSAMPLE_THRESHOLD = 5000;

function buildBarogramColors(
  times: number[],
  samples: SampledPoint[],
): string[] {
  const colors: string[] = new Array(times.length).fill(
    STATUS_COLORS['default'],
  );
  let sIdx = 0;
  for (let i = 0; i < times.length; i++) {
    const tMs = times[i] * 1000;
    while (
      sIdx < samples.length - 1 &&
      Math.abs(samples[sIdx + 1].timeMs - tMs) <
        Math.abs(samples[sIdx].timeMs - tMs)
    ) {
      sIdx++;
    }
    colors[i] = getSegmentColor(samples[sIdx].phase, samples[sIdx].status);
  }
  return colors;
}

/** uPlot draws on canvas, so it can't inherit CSS variables/colors — the
 * axis/grid colors must be provided explicitly and kept in sync with the
 * current light/dark theme (uPlot's defaults are black, invisible on a
 * dark background). */
function getChartColors(isDark: boolean) {
  return {
    axisStroke: isDark ? '#a1a1aa' : '#52525b',
    gridStroke: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    seriesStroke: isDark ? '#60a5fa' : '#2563eb',
  };
}

/**
 * Altitude-over-time chart rendered with uPlot: a single series for the
 * selected altitude source, a cursor synchronized to `currentTimeMs`
 * (driven programmatically, not only on hover), and click/hover-to-seek
 * (FR-M-11, FR-M-12, FR-M-13). Large flights are stride-downsampled for
 * rendering while `fixes` remains the source of truth for seeking.
 */
export function Barogram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const { theme } = useTheme();

  // Keep a ref of the latest currentTimeMs so the setCursor hook (created
  // once per data change) can read it without stale closures.
  const currentTimeMsRef = useRef(currentTimeMs);
  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);

  // Guards against the feedback loop where programmatically syncing the
  // cursor (to reflect replay state) would otherwise re-trigger the
  // setCursor hook below and call seek() on our own update.
  const isProgrammaticCursorUpdateRef = useRef(false);

  // While the pointer is over the plot, uPlot's own mouse-driven cursor is
  // authoritative — skipping the programmatic sync avoids the snap-back
  // that otherwise fights the mouse and shows up as visible lag.
  const isPointerOverRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !flight) return;

    const fullTimes = flight.fixes.map((f) => f.timeMs / 1000);
    const fullAltitudes = flight.fixes.map((f) =>
      altitudeSource === 'pressure' ? f.pressureAltitudeM : f.gnssAltitudeM,
    );

    const fullTerrain = elevationGrid
      ? flight.fixes.map((f) => {
          const v = sampleElevation(elevationGrid, f.latitude, f.longitude);
          return isNaN(v) ? null : v;
        })
      : flight.fixes.map(() => null as number | null);

    const stride = Math.max(
      1,
      Math.floor(fullTimes.length / DOWNSAMPLE_THRESHOLD),
    );
    const times: number[] = [];
    const altitudes: (number | null)[] = [];
    const terrain: (number | null)[] = [];
    for (let i = 0; i < fullTimes.length; i += stride) {
      times.push(fullTimes[i]);
      altitudes.push(fullAltitudes[i]);
      terrain.push(fullTerrain[i]);
    }
    // Always include the last point.
    if (times[times.length - 1] !== fullTimes[fullTimes.length - 1]) {
      times.push(fullTimes[fullTimes.length - 1]);
      altitudes.push(fullAltitudes[fullAltitudes.length - 1]);
      terrain.push(fullTerrain[fullTerrain.length - 1]);
    }

    const hasTerrain = terrain.some((v) => v !== null);

    // Series order: terrain first (renders behind), altitude on top.
    // data[1] = terrain, data[2] = altitude (when terrain available)
    // data[1] = altitude only (when no terrain)
    const data: uPlot.AlignedData = hasTerrain
      ? [times, terrain, altitudes]
      : [times, altitudes];

    const samples = localCheckResult?.samples ?? null;
    const colors =
      samples && samples.length > 0
        ? buildBarogramColors(times, samples)
        : null;

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const { axisStroke, gridStroke, seriesStroke } = getChartColors(
      theme === 'dark',
    );

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height: container.clientHeight || 200,
      scales: { x: { time: true } },
      series: [
        {},
        ...(hasTerrain
          ? [
              {
                label: 'Terrain (m)',
                stroke: 'rgba(160, 100, 40, 0.7)',
                fill: 'rgba(160, 100, 40, 0.3)',
                width: 1,
                points: { show: false },
              },
            ]
          : []),
        {
          label: 'Altitude (m)',
          stroke: colors ? 'transparent' : seriesStroke,
          width: 2,
          points: { show: false },
        },
      ],
      cursor: {
        points: { show: true },
        sync: undefined,
      },
      hooks: {
        setCursor: [
          (u) => {
            if (isProgrammaticCursorUpdateRef.current) return;
            const { idx } = u.cursor;
            if (idx == null || idx < 0) return;
            const timeMs = u.data[0][idx] * 1000;
            if (Math.abs(timeMs - currentTimeMsRef.current) > 500) {
              seek(timeMs);
            }
          },
        ],
        ...(colors
          ? {
              draw: [
                (u: uPlot) => {
                  const ctx = u.ctx;
                  const { left, top, width: bw, height: bh } = u.bbox;
                  ctx.save();
                  ctx.beginPath();
                  ctx.rect(left, top, bw, bh);
                  ctx.clip();
                  ctx.lineWidth = 2 * uPlot.pxRatio;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  for (let i = 0; i < times.length - 1; i++) {
                    const a0 = altitudes[i];
                    const a1 = altitudes[i + 1];
                    if (a0 == null || a1 == null) continue;
                    const x0 = u.valToPos(times[i], 'x', true);
                    const y0 = u.valToPos(a0, 'y', true);
                    const x1 = u.valToPos(times[i + 1], 'x', true);
                    const y1 = u.valToPos(a1, 'y', true);
                    ctx.beginPath();
                    ctx.strokeStyle = colors[i];
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x1, y1);
                    ctx.stroke();
                  }
                  ctx.restore();
                },
              ],
            }
          : {}),
      },
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
          // Time-only labels: uPlot's default time axis also inserts a
          // secondary date row whenever splits cross a day boundary. This
          // overrides that with a single-row, time-only label.
          values: (_u, splits) =>
            splits.map((v) =>
              new Date(v * 1000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            ),
        },
        {
          label: 'Altitude (m)',
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          ticks: { stroke: gridStroke },
        },
      ],
    };

    const plot = new uPlot(opts, data, container);
    uplotRef.current = plot;

    const onPointerEnter = () => {
      isPointerOverRef.current = true;
    };
    const onPointerLeave = () => {
      isPointerOverRef.current = false;
    };
    plot.over.addEventListener('pointerenter', onPointerEnter);
    plot.over.addEventListener('pointerleave', onPointerLeave);

    // Use a ResizeObserver (not just the window `resize` event) so the
    // chart also re-flows when its container changes size without the
    // viewport changing — e.g. toggling the sidebar, which animates via
    // CSS width transitions rather than firing a window resize event.
    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      plot.over.removeEventListener('pointerenter', onPointerEnter);
      plot.over.removeEventListener('pointerleave', onPointerLeave);
      plot.destroy();
      uplotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, altitudeSource, theme, localCheckResult, elevationGrid]);

  // Programmatically move the cursor to reflect currentTimeMs, so the
  // barogram cursor stays synchronized during replay, not only on hover.
  useEffect(() => {
    const plot = uplotRef.current;
    if (!plot || !flight) return;
    // Pointer is over the plot → uPlot already tracks it. Overriding here
    // would snap the cursor to the closest fix a frame later and fight
    // the mouse, showing up as visible lag.
    if (isPointerOverRef.current) return;
    const timeSec = currentTimeMs / 1000;
    const xData = plot.data[0] as number[];
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < xData.length; i++) {
      const dist = Math.abs(xData[i] - timeSec);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    const left = plot.valToPos(xData[closestIdx], 'x');
    isProgrammaticCursorUpdateRef.current = true;
    plot.setCursor({ left, top: -10 });
    isProgrammaticCursorUpdateRef.current = false;
  }, [currentTimeMs, flight]);

  return <div ref={containerRef} className="h-full w-full" />;
}
