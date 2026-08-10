import { useEffect, useRef } from 'react';
import { useFlightStore } from '../state/useFlightStore';

/**
 * Drives the replay clock with a requestAnimationFrame loop: while
 * `isPlaying`, advances `currentTimeMs` by `elapsedWallClockMs * playbackSpeed`
 * every frame via the store's `tick` action. Reaching the end auto-pauses
 * (handled inside `tick`).
 */
export function useReplayEngine(): void {
  const isPlaying = useFlightStore((s) => s.isPlaying);
  const tick = useFlightStore((s) => s.tick);
  const lastFrameTimeRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameTimeRef.current = null;
      return;
    }

    const loop = (now: number) => {
      if (lastFrameTimeRef.current !== null) {
        const deltaMs = now - lastFrameTimeRef.current;
        tick(deltaMs);
      }
      lastFrameTimeRef.current = now;
      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      lastFrameTimeRef.current = null;
    };
  }, [isPlaying, tick]);
}

/**
 * Binds global keyboard shortcuts for replay control (FR-M-17):
 * Space (play/pause), ArrowRight/ArrowLeft (step), Home (reset).
 * Ignored while a text input/textarea/select is focused.
 */
export function useReplayKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const store = useFlightStore.getState();
      if (!store.flight) return;

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          if (store.isPlaying) {
            store.pause();
          } else {
            store.play();
          }
          break;
        case 'ArrowRight':
          event.preventDefault();
          store.stepForward();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          store.stepBackward();
          break;
        case 'Home':
          event.preventDefault();
          store.reset();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
