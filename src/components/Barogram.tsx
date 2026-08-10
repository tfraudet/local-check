import { useFlightStore } from "@/state/useFlightStore";
import { useEffect, useMemo, useRef } from "react";
import uPlot from 'uplot';
import throttle from 'lodash/throttle';
import { useTheme } from "./theme-provider";
import { sampleElevation } from "@/domain/elevation";

import { Telemetry } from "./Telemetry"
import { getSegmentColor, STATUS_COLORS } from "@/domain/phaseColors";
import type { SampledPoint } from "@/domain/localCheck";

const DOWNSAMPLE_THRESHOLD = 10000;
const MAX_SEEK_INTERVAL_MS = 50;

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
    while (sIdx < samples.length - 1 && samples[sIdx + 1].timeMs <= tMs) {
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

export function Barogram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const isUserInteractingRef = useRef(false);

  const flight = useFlightStore((s) => s.flight);
  const altitudeSource = useFlightStore((s) => s.altitudeSource);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);

  const { theme } = useTheme();
  const seek = useFlightStore((s) => s.seek);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const currentTimeMsRef = useRef(currentTimeMs);

  useEffect(() => {
    currentTimeMsRef.current = currentTimeMs;
  }, [currentTimeMs]);

  const throttledSeek = useMemo(
    () =>
      throttle(
        (targetTimeMs: number) => seek(targetTimeMs),
        MAX_SEEK_INTERVAL_MS,
        { leading: true, trailing: true },
      ),
    [seek],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !flight) return;

    // Prepare data to plot: downsample if necessary, and always include the last point
    const fullTimes = flight.fixes.map((f) => f.timeMs / 1000);
    const fullAltitudes = flight.fixes.map((f) =>
      altitudeSource === 'pressure' ? f.pressureAltitudeM : f.gnssAltitudeM,
    );
    const fullTerrain = elevationGrid
      ? flight.fixes.map((f) => {
          const v = sampleElevation(elevationGrid, f.latitude, f.longitude);
          return Number.isFinite(v) ? v : null;
        })
      : flight.fixes.map(() => null as number | null);
    const stride = Math.max(1, Math.floor(fullTimes.length / DOWNSAMPLE_THRESHOLD));

    if (import.meta.env.DEV) {
      console.log('Done downsampling barogram data', {
        fullTimesLength: fullTimes.length,
        stride,
        downsampledLength: Math.ceil(fullTimes.length / stride),
      });
    }

    const localCheckFixIndices = new Set(
      (localCheckResult?.samples ?? [])
        .map((sample) => sample.fixIndex)
        .filter((index) => index >= 0 && index < fullTimes.length),
    );
    const plottedIndices = new Set<number>();
    for (let i = 0; i < fullTimes.length; i += stride) {
      plottedIndices.add(i);
    }
    for (const index of localCheckFixIndices) plottedIndices.add(index);
    plottedIndices.add(fullTimes.length - 1);

    const times: number[] = [];
    const altitudes: (number | null)[] = [];
    const terrain: (number | null)[] = [];
    for (const index of [...plottedIndices].sort((a, b) => a - b)) {
      times.push(fullTimes[index]);
      altitudes.push(fullAltitudes[index]);
      terrain.push(fullTerrain[index]);
    }

    const hasTerrain = terrain.some((v) => v !== null);

    // Series order: terrain first (renders behind), altitude on top.
    // data[1] = terrain, data[2] = altitude (when terrain available)
    // data[1] = altitude only (when no terrain)
    const data: uPlot.AlignedData = hasTerrain
      ? [times, terrain, altitudes]
      : [times, altitudes];

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const samples = localCheckResult?.samples ?? null;
    const colors =
      samples && samples.length > 0
        ? buildBarogramColors(times, samples)
        : null;

    const { axisStroke, gridStroke, seriesStroke } = getChartColors(
      theme === 'dark',
    );
    
    // Set options for uPlot chart
    const opts: uPlot.Options = {
      // title: "My Barogram",
      // class: "my-chart",
      id: "barogram",
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      legend: { show: false, live: true, isolate: true},
      series: [
        {},
        ...(hasTerrain
          ? [
              {
                label: 'Terrain (m)',
                show: true,
                stroke: 'rgba(160, 100, 40, 0.7)',
                fill: 'rgba(160, 100, 40, 0.3)',
                width: 1,
                points: { show: false },
                value: (_u: uPlot, rawValue: number | null) => { return rawValue != null ? `${Math.round(rawValue)}m` : "--";},
              },
            ]
          : []),
        {
          label: 'Altitude (m)',
          show: true,
          stroke: seriesStroke,
          width: 2,
          points: { show: false },
        },
      ],
      cursor: {
        show: true,
        x: true,
        y: false,
        lock: false,
      },
      hooks: {
        setCursor: [
          (u: uPlot) => {
            const idx = u.cursor.idx;
            if (idx == null) return;
            const time = u.data[0]?.[idx];
            throttledSeek(time * 1000);
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

    const resizePlot = () => {
      const width = Math.max(1, container.clientWidth);
      const titleHeight =
        container.querySelector<HTMLElement>('.u-title')?.offsetHeight ?? 0;
      const legendHeight =
        container.querySelector<HTMLElement>('.u-legend')?.offsetHeight ?? 0;
      const height = Math.max(
        1,
        container.clientHeight - titleHeight - legendHeight,
      );
      if (plot.width !== width || plot.height !== height) {
        plot.setSize({ width, height });
      }
    };

    resizePlot();

    // Initialize the cursor now that the plot has its real size (a size of 0
    // at construction time would make valToPos return a non-finite value).
    const left = plot.valToPos(currentTimeMs / 1000, 'x');
    if (Number.isFinite(left)) {
      plot.setCursor({ left, top: plot.over.clientHeight / 2 }, false);
    }

    const resizeObserver = new ResizeObserver(resizePlot);
    resizeObserver.observe(container);

    // Registered after uPlot's own listeners on this element, so this runs
    // after uPlot hides the cursor on mouseleave (regardless of which edge
    // — including the bottom — the mouse exits through), restoring it to
    // the replay position instead of leaving it invisible.
    const overEl = plot.over;
    const handleOverEnter = () => {
      isUserInteractingRef.current = true;
    };
    const handleOverLeave = () => {
      isUserInteractingRef.current = false;
      const left = plot.valToPos(currentTimeMsRef.current / 1000, 'x');
      if (Number.isFinite(left)) {
        plot.setCursor({ left, top: overEl.clientHeight / 2 }, false);
      }
    };
    overEl.addEventListener('mouseenter', handleOverEnter);
    overEl.addEventListener('mouseleave', handleOverLeave);

    return () => {
      overEl.removeEventListener('mouseenter', handleOverEnter);
      overEl.removeEventListener('mouseleave', handleOverLeave);
      resizeObserver.disconnect();
      throttledSeek.cancel();
      plot.destroy();
      uplotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, altitudeSource, theme, localCheckResult, elevationGrid, throttledSeek]);

  // Keep the uPlot cursor synced to the replay position (playing, reset, or seek).
  // fireHook=false avoids re-triggering setCursor's seek callback.
  // Skipped while the user is hovering/dragging the plot themselves, to avoid
  // the cursor fighting between the throttled seek and this sync.
  useEffect(() => {
    const plot = uplotRef.current;
    if (!plot || isUserInteractingRef.current) return;
    const left = plot.valToPos(currentTimeMs / 1000, 'x');
    if (Number.isFinite(left)) {
      plot.setCursor({ left, top: plot.over.clientHeight / 2 }, false);
    }
  }, [currentTimeMs]);

  return (
    <div className="flex h-full w-[70%] shrink-0 flex-col border-r">
      <div className="shrink-0">
        <Telemetry />
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      />
    </div>
  )
}