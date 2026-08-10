import { useEffect, useRef, type RefObject } from 'react';

/**
 * Keep the latest value of `value` in a ref without re-running effects that
 * depend on it.
 *
 * The assignment happens in an effect (not during render) so it satisfies
 * the `react-hooks/refs` rule; declare this hook *before* the effects that
 * read the ref so React commits the update first.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
