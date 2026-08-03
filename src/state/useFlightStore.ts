import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IgcParseError, NormalizedFlight } from '../domain/flight';
import { findCurrentFixIndex, flightTimeBounds } from '../domain/flight';
import type { ElevationGrid } from '../domain/elevation';
import type { LandingZone } from '../domain/landingZone';
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
import { computeDerivedMetrics } from '../domain/derivedMetrics';
import { detectMotorUse } from '../domain/enlDetection';
import { pickAltitude } from '../domain/units';
import {
  computeActiveZones,
  mergeZonesBySource,
  DEFAULT_SOURCE_TOGGLES,
  type SourceToggles,
  type ToggleableSource,
  type ZonesBySource,
} from './landingZoneCatalog';
import { createWorkerChannel } from './workerChannel';

export type PlaybackSpeed = 1 | 2 | 4 | 8 | 16;

/** Transient user-facing error pushed by any of the external-service hooks
 * (elevation, OpenAIP, outlanding DB fetches). Rendered by
 * `ServiceErrorBanner`; users dismiss them explicitly. */
export interface ServiceError {
  id: string;
  service: 'elevation' | 'openaip' | 'outlanding-db';
  title: string;
  message: string;
  hint?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface FlightStoreState {
  // Phase 1
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  /** True while `useIgcFileLoader` is parsing an uploaded IGC file off the
   * main thread. Lifted into the store (rather than local hook state) so
   * `IgcLoadProgressDialog` can observe it from anywhere in the tree. */
  isParsingIgc: boolean;
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  altitudeSource: 'pressure' | 'gnss';

  // Phase 2
  elevationGrid: ElevationGrid | null;
  elevationLoadError: string | null;
  /**
   * Effective landing zones — the union of the per-source cache, filtered
   * by `enabledSources`. Rebuilt whenever a toggle flips or new zones are
   * added.
   */
  landingZones: LandingZone[];
  /** Full per-source catalog kept so we can restore zones when a toggle
   * flips back on without re-fetching. */
  landingZonesBySource: ZonesBySource;
  visibleLandingZoneIds: Set<string>;
  /** Per-source visibility switches for the optional outlanding databases. */
  enabledSources: SourceToggles;
  /** [minLon, minLat, maxLon, maxLat] of the current map viewport, or null
   * before the map has emitted its first `moveend`. */
  visibleBounds: [number, number, number, number] | null;
  localCheckParams: LocalCheckParams;
  localCheckResult: LocalCheckResult | null;
  isComputingLocalCheck: boolean;

  // Cross-service errors surfaced via ServiceErrorBanner.
  serviceErrors: ServiceError[];

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
  setIsParsingIgc: (parsing: boolean) => void;
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
  /** Flip one optional landing-zone database on/off and recompute. */
  setSourceEnabled: (source: ToggleableSource, enabled: boolean) => void;
  setVisibleBounds: (bbox: [number, number, number, number] | null) => void;
  setLocalCheckParams: (patch: Partial<LocalCheckParams>) => void;
  runLocalCheck: () => Promise<void>;

  // Service-error actions
  pushServiceError: (err: Omit<ServiceError, 'id' | 'createdAt'>) => void;
  dismissServiceError: (id: string) => void;

  // Phase 3 actions
  setShowEscapePath: (visible: boolean) => void;
  setShowReachableZone: (visible: boolean) => void;
  setShowArrivalHeights: (visible: boolean) => void;
  setReachableZoneParams: (patch: Partial<ReachableZoneParams>) => void;
  runReachableZone: () => Promise<void>;
  clearReachableZone: () => void;

  /** Reset all sidebar settings (Parameters, Landing zones data, Escape path
   * & Reachable zone) back to their factory defaults and re-run the local
   * check. Does not touch the loaded flight or cached elevation/landing-zone
   * data. */
  resetSettingsToDefaults: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** State shared by every "factory defaults" reset. */
const DEFAULT_SETTINGS = {
  localCheckParams: DEFAULT_LOCAL_CHECK_PARAMS,
  enabledSources: DEFAULT_SOURCE_TOGGLES,
  showEscapePath: true,
  showReachableZone: false,
  showArrivalHeights: true,
  reachableZoneParams: DEFAULT_REACHABLE_ZONE_PARAMS,
} as const;

/** State cleared whenever the loaded flight changes. */
const CLEARED_ON_FLIGHT_CHANGE = {
  localCheckResult: null,
  elevationGrid: null,
  elevationLoadError: null,
  reachableZoneResult: null,
} as const;

/** Slice of the store written to localStorage. */
type PersistedSettings = Pick<
  FlightStoreState,
  | 'localCheckParams'
  | 'enabledSources'
  | 'showEscapePath'
  | 'showReachableZone'
  | 'showArrivalHeights'
  | 'reachableZoneParams'
>;

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

const localCheckChannel = createWorkerChannel<
  LocalCheckInput,
  LocalCheckResult
>(
  () =>
    new Worker(new URL('../workers/localCheck.worker.ts', import.meta.url), {
      type: 'module',
    }),
);

const reachableZoneChannel = createWorkerChannel<
  ReachableZoneInputs,
  ReachableZoneResult
>(
  () =>
    new Worker(new URL('../workers/reachableZone.worker.ts', import.meta.url), {
      type: 'module',
    }),
);

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFlightStore = create<FlightStoreState>()(
  persist(
    (set, get) => {
      /** Jump `delta` fixes from the current position and pause. */
      const stepBy = (delta: number) => {
        const { flight, currentTimeMs } = get();
        if (!flight) return;
        const index = findCurrentFixIndex(flight, currentTimeMs);
        const nextIndex = clamp(index + delta, 0, flight.fixes.length - 1);
        set({
          currentTimeMs: flight.fixes[nextIndex].timeMs,
          isPlaying: false,
        });
      };

      return {
        // Phase 1 initial state
        flight: null,
        loadError: null,
        isParsingIgc: false,
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
        visibleBounds: null,
        localCheckResult: null,
        isComputingLocalCheck: false,

        serviceErrors: [],

        // Phase 3 initial state
        reachableZoneResult: null,
        isComputingReachableZone: false,

        ...DEFAULT_SETTINGS,

        // Phase 1 actions
        loadFlight: (flight) =>
          set({
            flight,
            loadError: null,
            currentTimeMs: flight.fixes[0]?.timeMs ?? 0,
            isPlaying: false,
            altitudeSource: flight.preferredAltitudeSource,
            ...CLEARED_ON_FLIGHT_CHANGE,
          }),

        setLoadError: (error) => set({ loadError: error, flight: null }),

        setIsParsingIgc: (parsing) => set({ isParsingIgc: parsing }),

        clearFlight: () =>
          set({
            flight: null,
            loadError: null,
            currentTimeMs: 0,
            isPlaying: false,
            ...CLEARED_ON_FLIGHT_CHANGE,
          }),

        play: () => {
          const { flight, currentTimeMs } = get();
          if (!flight) return;
          const { firstFixTimeMs, lastFixTimeMs } = flightTimeBounds(flight);
          // Restarting from the end replays from the top.
          set(
            currentTimeMs >= lastFixTimeMs
              ? { currentTimeMs: firstFixTimeMs, isPlaying: true }
              : { isPlaying: true },
          );
        },

        pause: () => set({ isPlaying: false }),

        reset: () => {
          const { flight } = get();
          if (!flight) return;
          set({
            currentTimeMs: flightTimeBounds(flight).firstFixTimeMs,
            isPlaying: false,
          });
        },

        seek: (timeMs) => {
          const { flight } = get();
          if (!flight) return;
          const { firstFixTimeMs, lastFixTimeMs } = flightTimeBounds(flight);
          set({ currentTimeMs: clamp(timeMs, firstFixTimeMs, lastFixTimeMs) });
        },

        stepForward: () => stepBy(1),

        stepBackward: () => stepBy(-1),

        setSpeed: (speed) => set({ playbackSpeed: speed }),

        setAltitudeSource: (source) => set({ altitudeSource: source }),

        tick: (deltaMs) => {
          const { flight, isPlaying, currentTimeMs, playbackSpeed } = get();
          if (!flight || !isPlaying) return;
          const { firstFixTimeMs, lastFixTimeMs } = flightTimeBounds(flight);
          const next = currentTimeMs + deltaMs * playbackSpeed;
          if (next >= lastFixTimeMs) {
            set({ currentTimeMs: lastFixTimeMs, isPlaying: false });
          } else {
            set({ currentTimeMs: clamp(next, firstFixTimeMs, lastFixTimeMs) });
          }
        },

        // Phase 2 actions
        setElevationGrid: (grid) =>
          set({ elevationGrid: grid, elevationLoadError: null }),

        setElevationLoadError: (message) =>
          set({ elevationLoadError: message, elevationGrid: null }),

        addLandingZones: (zones) => {
          const {
            landingZonesBySource,
            visibleLandingZoneIds,
            enabledSources,
          } = get();

          const nextBySource = mergeZonesBySource(landingZonesBySource, zones);
          const nextVisible = new Set(visibleLandingZoneIds);
          for (const zone of zones) nextVisible.add(zone.id);

          set({
            landingZonesBySource: nextBySource,
            landingZones: computeActiveZones(nextBySource, enabledSources),
            visibleLandingZoneIds: nextVisible,
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
          const next = new Set(get().visibleLandingZoneIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          set({ visibleLandingZoneIds: next });
        },

        setSourceEnabled: (source, enabled) => {
          const { landingZonesBySource, enabledSources } = get();
          const nextToggles = { ...enabledSources, [source]: enabled };
          set({
            enabledSources: nextToggles,
            landingZones: computeActiveZones(landingZonesBySource, nextToggles),
          });
          void get().runLocalCheck();
        },

        setVisibleBounds: (bbox) => set({ visibleBounds: bbox }),

        setLocalCheckParams: (patch) =>
          set({ localCheckParams: { ...get().localCheckParams, ...patch } }),

        runLocalCheck: async () => {
          const {
            flight,
            elevationGrid,
            landingZones,
            localCheckParams,
            altitudeSource,
          } = get();

          if (!flight || !elevationGrid || landingZones.length === 0) return;

          const startedAt = import.meta.env.DEV ? performance.now() : 0;

          set({ isComputingLocalCheck: true });

          const motorFlags = detectMotorUse(
            flight.fixes,
            localCheckParams.enlThreshold,
          );
          // Derived metrics stored on `flight` may lack AGL when the elevation
          // grid loaded after IGC parsing. Re-derive with the grid so
          // `computeFlightPhases` sees populated `aglM` for initial-climb /
          // final-glide detection. Kept local so `flight` identity stays
          // stable (mutating it here would loop the auto-effect hooks).
          const derivedWithAgl = computeDerivedMetrics(
            flight.fixes,
            altitudeSource,
            elevationGrid,
          );
          const phases = computeFlightPhases(
            flight.fixes,
            derivedWithAgl,
            motorFlags,
            altitudeSource,
          );

          const result = await localCheckChannel.run({
            fixes: flight.fixes,
            altitudeSource,
            elevationGrid,
            landingZones,
            phases,
            params: localCheckParams,
          });

          // `null` means a newer request superseded this one — leave both the
          // result and the spinner to the newest request.
          if (result === null && localCheckChannel.isLatestPending()) return;

          set({
            isComputingLocalCheck: false,
            ...(result !== null ? { localCheckResult: result } : {}),
          });

          if (import.meta.env.DEV) {
            console.log(
              `[runLocalCheck] ${(performance.now() - startedAt).toFixed(1)} ms`,
            );
          }
        },

        pushServiceError: (err) => {
          const id = `${err.service}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          // De-duplicate by (service + title) so a service failing repeatedly
          // (e.g. retry attempts) doesn't stack identical banners.
          const withoutDup = get().serviceErrors.filter(
            (e) => !(e.service === err.service && e.title === err.title),
          );
          set({
            serviceErrors: [
              ...withoutDup,
              { ...err, id, createdAt: Date.now() },
            ],
          });
        },

        dismissServiceError: (id) =>
          set({
            serviceErrors: get().serviceErrors.filter((e) => e.id !== id),
          }),

        // Phase 3 actions
        setShowEscapePath: (visible) => set({ showEscapePath: visible }),

        setShowReachableZone: (visible) =>
          set({
            showReachableZone: visible,
            ...(visible ? {} : { reachableZoneResult: null }),
          }),

        setShowArrivalHeights: (visible) =>
          set({ showArrivalHeights: visible }),

        setReachableZoneParams: (patch) =>
          set({
            reachableZoneParams: { ...get().reachableZoneParams, ...patch },
          }),

        clearReachableZone: () => set({ reachableZoneResult: null }),

        resetSettingsToDefaults: () => {
          set({
            ...DEFAULT_SETTINGS,
            landingZones: computeActiveZones(
              get().landingZonesBySource,
              DEFAULT_SETTINGS.enabledSources,
            ),
            reachableZoneResult: null,
          });
          void get().runLocalCheck();
        },

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

          // Locate the fix closest to the current replay time.
          const idx = findCurrentFixIndex(flight, currentTimeMs);
          if (idx < 0) return;
          const fix = flight.fixes[idx];
          const altM = pickAltitude(fix, altitudeSource);
          if (altM === null) return;

          set({ isComputingReachableZone: true });

          const result = await reachableZoneChannel.run({
            sourceLat: fix.latitude,
            sourceLon: fix.longitude,
            sourceAltM: altM,
            grid: elevationGrid,
            params: localCheckParams,
            zoneParams: reachableZoneParams,
          });

          // Stale response: the newest request is still running, so neither
          // the result nor the spinner belongs to us.
          if (result === null && reachableZoneChannel.isLatestPending()) return;

          set({
            isComputingReachableZone: false,
            ...(result !== null ? { reachableZoneResult: result } : {}),
          });
        },
      };
    },
    {
      name: 'local-check.params.v1',
      version: 2,
      // Only persist the computation parameters; everything else is transient.
      partialize: (state) => ({
        localCheckParams: state.localCheckParams,
        enabledSources: state.enabledSources,
        showEscapePath: state.showEscapePath,
        showReachableZone: state.showReachableZone,
        showArrivalHeights: state.showArrivalHeights,
        reachableZoneParams: state.reachableZoneParams,
      }),
      // v1 stored the two outlanding databases as standalone booleans.
      migrate: (persisted, version) => {
        const legacy = (persisted ?? {}) as PersistedSettings & {
          showOutlandingFields?: boolean;
          showAuvergneFields?: boolean;
        };
        if (version >= 2) return legacy;
        const { showOutlandingFields, showAuvergneFields, ...rest } = legacy;
        return {
          ...rest,
          enabledSources: {
            'outlanding-alps': showOutlandingFields ?? false,
            'outlanding-auvergne': showAuvergneFields ?? false,
          },
        };
      },
    },
  ),
);
