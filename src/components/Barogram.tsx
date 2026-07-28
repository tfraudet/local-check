import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useFlightStore } from '../state/useFlightStore';

const DOWNSAMPLE_THRESHOLD = 5000;

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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !flight) return;

    const fullTimes = flight.fixes.map((f) => f.timeMs / 1000);
    const fullAltitudes = flight.fixes.map((f) =>
      altitudeSource === 'pressure' ? f.pressureAltitudeM : f.gnssAltitudeM,
    );

    const stride = Math.max(
      1,
      Math.floor(fullTimes.length / DOWNSAMPLE_THRESHOLD),
    );
    const times: number[] = [];
    const altitudes: (number | null)[] = [];
    for (let i = 0; i < fullTimes.length; i += stride) {
      times.push(fullTimes[i]);
      altitudes.push(fullAltitudes[i]);
    }
    // Always include the last point.
    if (times[times.length - 1] !== fullTimes[fullTimes.length - 1]) {
      times.push(fullTimes[fullTimes.length - 1]);
      altitudes.push(fullAltitudes[fullAltitudes.length - 1]);
    }

    const data: uPlot.AlignedData = [times, altitudes];

    if (uplotRef.current) {
      uplotRef.current.destroy();
      uplotRef.current = null;
    }

    const opts: uPlot.Options = {
      width: container.clientWidth || 600,
      height: container.clientHeight || 200,
      scales: { x: { time: true } },
      series: [
        {},
        {
          label: 'Altitude (m)',
          stroke: '#2563eb',
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
      },
      axes: [{}, { label: 'Altitude (m)' }],
    };

    const plot = new uPlot(opts, data, container);
    uplotRef.current = plot;

    const handleResize = () => {
      plot.setSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      plot.destroy();
      uplotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, altitudeSource]);

  // Programmatically move the cursor to reflect currentTimeMs, so the
  // barogram cursor stays synchronized during replay, not only on hover.
  useEffect(() => {
    const plot = uplotRef.current;
    if (!plot || !flight) return;
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
