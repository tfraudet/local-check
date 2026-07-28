import { create } from 'zustand';
import type { IgcParseError, NormalizedFlight } from '../domain/flight';

export type PlaybackSpeed = 1 | 2 | 4 | 8 | 16;

export interface FlightStoreState {
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  altitudeSource: 'pressure' | 'gnss';

  loadFlight: (flight: NormalizedFlight) => void;
  setLoadError: (error: IgcParseError) => void;
  clearFlight: () => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (timeMs: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setAltitudeSource: (source: 'pressure' | 'gnss') => void;
  /** Advance the clock during replay; internal use by the replay engine. */
  tick: (deltaMs: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Binary search for the index of the fix at/just-before `timeMs`. */
export function findCurrentFixIndex(
  flight: NormalizedFlight | null,
  timeMs: number,
): number {
  if (!flight || flight.fixes.length === 0) return -1;
  const { fixes } = flight;
  let lo = 0;
  let hi = fixes.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fixes[mid].timeMs <= timeMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

export const useFlightStore = create<FlightStoreState>((set, get) => ({
  flight: null,
  loadError: null,
  currentTimeMs: 0,
  isPlaying: false,
  playbackSpeed: 1,
  altitudeSource: 'pressure',

  loadFlight: (flight) =>
    set({
      flight,
      loadError: null,
      currentTimeMs: flight.fixes[0]?.timeMs ?? 0,
      isPlaying: false,
      altitudeSource: flight.preferredAltitudeSource,
    }),

  setLoadError: (error) => set({ loadError: error, flight: null }),

  clearFlight: () =>
    set({ flight: null, loadError: null, currentTimeMs: 0, isPlaying: false }),

  play: () => {
    const { flight, currentTimeMs } = get();
    if (!flight) return;
    const lastFixTime = flight.fixes[flight.fixes.length - 1].timeMs;
    // If already at the end, restart from the beginning on play.
    if (currentTimeMs >= lastFixTime) {
      set({ currentTimeMs: flight.fixes[0].timeMs, isPlaying: true });
    } else {
      set({ isPlaying: true });
    }
  },

  pause: () => set({ isPlaying: false }),

  reset: () => {
    const { flight } = get();
    if (!flight) return;
    set({ currentTimeMs: flight.fixes[0].timeMs, isPlaying: false });
  },

  seek: (timeMs) => {
    const { flight } = get();
    if (!flight) return;
    const firstFixTime = flight.fixes[0].timeMs;
    const lastFixTime = flight.fixes[flight.fixes.length - 1].timeMs;
    set({ currentTimeMs: clamp(timeMs, firstFixTime, lastFixTime) });
  },

  stepForward: () => {
    const { flight, currentTimeMs } = get();
    if (!flight) return;
    const index = findCurrentFixIndex(flight, currentTimeMs);
    const nextIndex = Math.min(index + 1, flight.fixes.length - 1);
    set({ currentTimeMs: flight.fixes[nextIndex].timeMs, isPlaying: false });
  },

  stepBackward: () => {
    const { flight, currentTimeMs } = get();
    if (!flight) return;
    const index = findCurrentFixIndex(flight, currentTimeMs);
    const prevIndex = Math.max(index - 1, 0);
    set({ currentTimeMs: flight.fixes[prevIndex].timeMs, isPlaying: false });
  },

  setSpeed: (speed) => set({ playbackSpeed: speed }),

  setAltitudeSource: (source) => set({ altitudeSource: source }),

  tick: (deltaMs) => {
    const { flight, isPlaying, currentTimeMs, playbackSpeed } = get();
    if (!flight || !isPlaying) return;
    const firstFixTime = flight.fixes[0].timeMs;
    const lastFixTime = flight.fixes[flight.fixes.length - 1].timeMs;
    const next = currentTimeMs + deltaMs * playbackSpeed;
    if (next >= lastFixTime) {
      set({ currentTimeMs: lastFixTime, isPlaying: false });
    } else {
      set({ currentTimeMs: clamp(next, firstFixTime, lastFixTime) });
    }
  },
}));
