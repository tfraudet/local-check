import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IgcParseError, NormalizedFlight } from '../domain/flight';
import type { ElevationGrid } from '../domain/elevation';
import type { LandingZone, LandingZoneSource } from '../domain/landingZone';
import {
  DEFAULT_LOCAL_CHECK_PARAMS,
  type LocalCheckParams,
  type LocalCheckResult,
  type LocalCheckInput,
} from '../domain/localCheck';
import {
  DEFAULT_REACHABLE_ZONE_PARAMS,
  type ReachableZoneInputs,
  type ReachableZoneParams,
  type ReachableZoneResult,
} from '../domain/reachableZone';
import { computeFlightPhases } from '../domain/flightPhases';
import { detectMotorUse } from '../domain/enlDetection';
import { haversineDistanceM, pickAltitude } from '../domain/units';

export type PlaybackSpeed = 1 | 2 | 4 | 8 | 16;

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface FlightStoreState {
  // Phase 1
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  altitudeSource: 'pressure' | 'gnss';

  // Phase 2
  elevationGrid: ElevationGrid | null;
  elevationLoadError: string | null;
  /**
   * Effective landing zones — the union of the per-source cache, filtered
   * by `showOutlandingFields` / `showAuvergneFields`. Rebuilt whenever a
   * toggle flips or new zones are added.
   */
  landingZones: LandingZone[];
  /** Full per-source catalog kept so we can restore zones when a toggle
   * flips back on without re-fetching. */
  landingZonesBySource: Partial<Record<LandingZoneSource, LandingZone[]>>;
  visibleLandingZoneIds: Set<string>;
  showOutlandingFields: boolean;
  showAuvergneFields: boolean;
  /** [minLon, minLat, maxLon, maxLat] of the current map viewport, or null
   * before the map has emitted its first `moveend`. */
  visibleBounds: [number, number, number, number] | null;
  localCheckParams: LocalCheckParams;
  localCheckResult: LocalCheckResult | null;
  isComputingLocalCheck: boolean;

  // Phase 3
  showEscapePath: boolean;
  showReachableZone: boolean;
  showArrivalHeights: boolean;
  reachableZoneParams: ReachableZoneParams;
  reachableZoneResult: ReachableZoneResult | null;
  isComputingReachableZone: boolean;

  // Phase 1 actions
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

  // Phase 2 actions
  setElevationGrid: (grid: ElevationGrid | null) => void;
  setElevationLoadError: (message: string | null) => void;
  addLandingZones: (zones: LandingZone[]) => void;
  clearLandingZones: () => void;
  toggleLandingZoneVisibility: (id: string) => void;
  setShowOutlandingFields: (show: boolean) => void;
  setShowAuvergneFields: (show: boolean) => void;
  setVisibleBounds: (bbox: [number, number, number, number] | null) => void;
  setLocalCheckParams: (patch: Partial<LocalCheckParams>) => void;
  runLocalCheck: () => Promise<void>;

  // Phase 3 actions
  setShowEscapePath: (visible: boolean) => void;
  setShowReachableZone: (visible: boolean) => void;
  setShowArrivalHeights: (visible: boolean) => void;
  setReachableZoneParams: (patch: Partial<ReachableZoneParams>) => void;
  runReachableZone: () => Promise<void>;
  clearReachableZone: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Return true if the given source is currently enabled by its toggle. */
function isSourceEnabled(
  source: LandingZoneSource,
  toggles: { showOutlandingFields: boolean; showAuvergneFields: boolean },
): boolean {
  if (source === 'outlanding-alps') return toggles.showOutlandingFields;
  if (source === 'outlanding-auvergne') return toggles.showAuvergneFields;
  return true; // 'user' imports are always on
}

/** Merge threshold: two zones from different sources within this distance
 * are treated as the same real-world site. 400 m comfortably covers airfield
 * center-vs-runway-threshold offsets between OpenAIP and .cup imports. */
const DEDUP_THRESHOLD_M = 400;

/**
 * Concatenate the per-source cache into a single active list.
 *
 * OpenAIP entries are authoritative: any zone from another source that lies
 * within `DEDUP_THRESHOLD_M` of an OpenAIP zone is dropped, so imported .cup
 * airfields don't shadow the canonical OpenAIP record.
 */
function computeActiveZones(
  bySource: Partial<Record<LandingZoneSource, LandingZone[]>>,
  toggles: { showOutlandingFields: boolean; showAuvergneFields: boolean },
): LandingZone[] {
  const openaipZones = bySource['openaip'] ?? [];
  const out: LandingZone[] = [...openaipZones];

  for (const [src, arr] of Object.entries(bySource)) {
    if (!arr || src === 'openaip') continue;
    if (!isSourceEnabled(src as LandingZoneSource, toggles)) continue;
    for (const z of arr) {
      const duplicate = openaipZones.some(
        (o) => haversineDistanceM(z.latitude, z.longitude, o.latitude, o.longitude) < DEDUP_THRESHOLD_M,
      );
      if (!duplicate) out.push(z);
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// Worker singleton
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let currentRequestId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/localCheck.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

let rzWorker: Worker | null = null;
let rzRequestId = 0;

function getReachableZoneWorker(): Worker {
  if (!rzWorker) {
    rzWorker = new Worker(
      new URL('../workers/reachableZone.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return rzWorker;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFlightStore = create<FlightStoreState>()(
  persist(
    (set, get) => ({
      // Phase 1 initial state
      flight: null,
      loadError: null,
      currentTimeMs: 0,
      isPlaying: false,
      playbackSpeed: 1,
      altitudeSource: 'pressure',

      // Phase 2 initial state
      elevationGrid: null,
      elevationLoadError: null,
      landingZones: [],
      landingZonesBySource: {},
      visibleLandingZoneIds: new Set<string>(),
      showOutlandingFields: true,
      showAuvergneFields: true,
      visibleBounds: null,
      localCheckParams: DEFAULT_LOCAL_CHECK_PARAMS,
      localCheckResult: null,
      isComputingLocalCheck: false,

      // Phase 3 initial state
      showEscapePath: false,
      showReachableZone: false,
      showArrivalHeights: false,
      reachableZoneParams: DEFAULT_REACHABLE_ZONE_PARAMS,
      reachableZoneResult: null,
      isComputingReachableZone: false,

      // Phase 1 actions (unchanged)
      loadFlight: (flight) =>
        set({
          flight,
          loadError: null,
          currentTimeMs: flight.fixes[0]?.timeMs ?? 0,
          isPlaying: false,
          altitudeSource: flight.preferredAltitudeSource,
          // Clear phase 2 results when a new flight is loaded
          localCheckResult: null,
          elevationGrid: null,
          elevationLoadError: null,
          reachableZoneResult: null,
        }),

      setLoadError: (error) => set({ loadError: error, flight: null }),

      clearFlight: () =>
        set({
          flight: null,
          loadError: null,
          currentTimeMs: 0,
          isPlaying: false,
          localCheckResult: null,
          elevationGrid: null,
          elevationLoadError: null,
          reachableZoneResult: null,
        }),

      play: () => {
        const { flight, currentTimeMs } = get();
        if (!flight) return;
        const lastFixTime = flight.fixes[flight.fixes.length - 1].timeMs;
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

      // Phase 2 actions
      setElevationGrid: (grid) => set({ elevationGrid: grid, elevationLoadError: null }),

      setElevationLoadError: (message) =>
        set({ elevationLoadError: message, elevationGrid: null }),

      addLandingZones: (zones) => {
        const {
          landingZonesBySource,
          visibleLandingZoneIds,
          showOutlandingFields,
          showAuvergneFields,
        } = get();

        // Merge new zones into the per-source cache, deduped by id.
        const nextBySource: Partial<Record<LandingZoneSource, LandingZone[]>> = {
          ...landingZonesBySource,
        };
        for (const [src, arr] of Object.entries(nextBySource)) {
          if (arr) nextBySource[src as LandingZoneSource] = [...arr];
        }
        for (const z of zones) {
          const bucket = nextBySource[z.source] ?? (nextBySource[z.source] = []);
          const idx = bucket.findIndex((b) => b.id === z.id);
          if (idx >= 0) bucket[idx] = z;
          else bucket.push(z);
        }

        const newVisible = new Set(visibleLandingZoneIds);
        for (const z of zones) newVisible.add(z.id);

        set({
          landingZonesBySource: nextBySource,
          landingZones: computeActiveZones(nextBySource, {
            showOutlandingFields,
            showAuvergneFields,
          }),
          visibleLandingZoneIds: newVisible,
        });
      },

      clearLandingZones: () =>
        set({
          landingZones: [],
          landingZonesBySource: {},
          visibleLandingZoneIds: new Set(),
          localCheckResult: null,
        }),

      toggleLandingZoneVisibility: (id) => {
        const { visibleLandingZoneIds } = get();
        const next = new Set(visibleLandingZoneIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        set({ visibleLandingZoneIds: next });
      },

      setShowOutlandingFields: (show) => {
        const { landingZonesBySource, showAuvergneFields } = get();
        set({
          showOutlandingFields: show,
          landingZones: computeActiveZones(landingZonesBySource, {
            showOutlandingFields: show,
            showAuvergneFields,
          }),
        });
        void get().runLocalCheck();
      },

      setVisibleBounds: (bbox) => set({ visibleBounds: bbox }),

      setShowAuvergneFields: (show) => {
        const { landingZonesBySource, showOutlandingFields } = get();
        set({
          showAuvergneFields: show,
          landingZones: computeActiveZones(landingZonesBySource, {
            showOutlandingFields,
            showAuvergneFields: show,
          }),
        });
        void get().runLocalCheck();
      },

      setLocalCheckParams: (patch) => {
        const { localCheckParams } = get();
        set({ localCheckParams: { ...localCheckParams, ...patch } });
      },

      runLocalCheck: async () => {
        const {
          flight,
          elevationGrid,
          landingZones,
          localCheckParams,
          altitudeSource,
        } = get();

        if (!flight || !elevationGrid || landingZones.length === 0) return;

        set({ isComputingLocalCheck: true });

        const motorFlags = detectMotorUse(flight.fixes, localCheckParams.enlThreshold);
        const phases = computeFlightPhases(
          flight.fixes,
          flight.derived,
          motorFlags,
          altitudeSource,
        );

        const input: LocalCheckInput = {
          fixes: flight.fixes,
          altitudeSource,
          elevationGrid,
          landingZones,
          phases,
          params: localCheckParams,
        };

        const requestId = ++currentRequestId;

        return new Promise<void>((resolve) => {
          const w = getWorker();

          const handler = (event: MessageEvent) => {
            const { data } = event;
            if (data.requestId !== requestId) return; // stale response

            w.removeEventListener('message', handler);
            set({ isComputingLocalCheck: false });

            if (data.type === 'success') {
              set({ localCheckResult: data.result });
            }
            resolve();
          };

          w.addEventListener('message', handler);
          w.postMessage({ type: 'run', requestId, input });
        });
      },

      // Phase 3 actions
      setShowEscapePath: (visible) => set({ showEscapePath: visible }),

      setShowReachableZone: (visible) => {
        set({ showReachableZone: visible });
        if (!visible) set({ reachableZoneResult: null });
      },

      setShowArrivalHeights: (visible) => set({ showArrivalHeights: visible }),

      setReachableZoneParams: (patch) => {
        const { reachableZoneParams } = get();
        set({ reachableZoneParams: { ...reachableZoneParams, ...patch } });
      },

      clearReachableZone: () => set({ reachableZoneResult: null }),

      runReachableZone: async () => {
        const {
          flight,
          currentTimeMs,
          elevationGrid,
          localCheckParams,
          reachableZoneParams,
          altitudeSource,
          showReachableZone,
        } = get();

        if (!showReachableZone || !flight || !elevationGrid) return;

        const fixes = flight.fixes;
        if (fixes.length === 0) return;

        // Locate the fix closest to the current replay time.
        const idx = findCurrentFixIndex(flight, currentTimeMs);
        if (idx < 0) return;
        const fix = fixes[idx];
        const altM = pickAltitude(fix, altitudeSource);
        if (altM === null) return;

        set({ isComputingReachableZone: true });

        const input: ReachableZoneInputs = {
          sourceLat: fix.latitude,
          sourceLon: fix.longitude,
          sourceAltM: altM,
          grid: elevationGrid,
          params: localCheckParams,
          zoneParams: reachableZoneParams,
        };

        const requestId = ++rzRequestId;

        return new Promise<void>((resolve) => {
          const w = getReachableZoneWorker();

          const handler = (event: MessageEvent) => {
            const { data } = event;
            if (data.requestId !== requestId) return;

            w.removeEventListener('message', handler);

            // Only clear the "computing" flag if this response corresponds
            // to the newest request — otherwise a stale, faster response
            // would prematurely stop the spinner while the latest work is
            // still in-flight.
            if (requestId === rzRequestId) {
              set({ isComputingReachableZone: false });
            }

            if (data.type === 'success') {
              // Guard against a stale response overwriting a fresher one.
              if (requestId === rzRequestId) {
                set({ reachableZoneResult: data.result });
              }
            }
            resolve();
          };

          w.addEventListener('message', handler);
          w.postMessage({ type: 'run', requestId, input });
        });
      },
    }),
    {
      name: 'local-check.params.v1',
      // Only persist the computation parameters; everything else is transient.
      partialize: (state) => ({
        localCheckParams: state.localCheckParams,
        showOutlandingFields: state.showOutlandingFields,
        showAuvergneFields: state.showAuvergneFields,
        showEscapePath: state.showEscapePath,
        showReachableZone: state.showReachableZone,
        showArrivalHeights: state.showArrivalHeights,
        reachableZoneParams: state.reachableZoneParams,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Debug: log the landingZones slice whenever its reference changes.
// Gated by DEV so production users don't get a console spammed with zones.
// ---------------------------------------------------------------------------
if (import.meta.env.DEV) {
  let prevLandingZones: LandingZone[] | undefined;
  useFlightStore.subscribe((state) => {
    if (state.landingZones === prevLandingZones) return;
    prevLandingZones = state.landingZones;
    console.log(
      `[flightStore] landingZones updated (${state.landingZones.length}):`,
      state.landingZones,
    );
  });
}
