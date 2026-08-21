import { useEffect, useMemo, useState } from 'react';
import throttle from 'lodash/throttle';

/**
 * Returns a throttled snapshot of `value` that updates at most once every
 * `waitMs`. Used to decouple expensive recomputations (terrain-aware
 * reachable zone, escape-path routing) from `currentTimeMs`, which otherwise
 * changes on every replay animation frame (~60/s) and would trigger a full
 * recompute each time.
 *
 * Mirrors the `useMemo` + `useEffect` cleanup pattern used for the throttled
 * `seek` calls in Barogram/ReplayControls/MapView (`lodash/throttle`,
 * `{ leading: true, trailing: true }`), but throttles a *value* rather than
 * an event-driven callback.
 */
export function useThrottledValue<T>(value: T, waitMs: number): T {
  const [throttled, setThrottled] = useState(value);

  const throttledSet = useMemo(
    () =>
      throttle((next: T) => setThrottled(next), waitMs, {
        leading: true,
        trailing: true,
      }),
    [waitMs],
  );

  useEffect(() => () => throttledSet.cancel(), [throttledSet]);

  useEffect(() => {
    throttledSet(value);
  }, [value, throttledSet]);

  return throttled;
}
