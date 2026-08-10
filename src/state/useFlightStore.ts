
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { findCurrentFixIndex, flightTimeBounds, type IgcParseError, type NormalizedFlight } from '../domain/flight';
import type { ElevationGrid } from '@/domain/elevation';
import type { LandingZone } from '../domain/landingZone';
import { computeActiveZones, mergeZonesBySource, type ZonesBySource, DEFAULT_SOURCE_TOGGLES } from './landingZoneCatalog';
import type { LocalCheckInput, LocalCheckResult } from '@/domain/localCheck';

import { createWorkerChannel } from './workerChannel';


export type PlaybackSpeed = 1 | 2 | 4 | 8 | 16 | 32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sources the user can switch off. Anything not listed is always on. */
const TOGGLEABLE_SOURCES: Record<string, boolean> = {
  'outlanding-alps': false,
  'outlanding-auvergne': false,
};

type ToggleableSource = typeof TOGGLEABLE_SOURCES;

export interface Settings {
  // Parameters for the local check algorithm
  workingLD: number;
  arrivalHeightM: number; 
  groundClearanceM: number; 
  timeStepS: number; 
  enlThreshold: number; 
  detectFinalGlide: boolean; 

  // Enabled sources for landng zones
  enabledSources: ToggleableSource;
}

const DEFAULT_SETTINGS : Settings = {
  // parameters for the local check algorithm
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
  timeStepS: 20,
  enlThreshold: 500,
  detectFinalGlide: true,

  //enabled sources for landing zones
  enabledSources: TOGGLEABLE_SOURCES
} as const;


// Example of summary
// {
//     "date": "2026-07-27",
//     "pilotName": "Thierry Fraudet",
//     "gliderType": "Janus C",
//     "takeoffTimeMs": 1785163717000,
//     "landingTimeMs": 1785171257000,
//     "durationMs": 7540000,
//     "maxAltitudeM": 1701,
//     "minAltitudeM": 321,
//     "maxGroundSpeedKmh": 155.98980048735885,
//     "totalDistanceKm": 227.3327025759508,
//     "fixCount": 7541
// }

// And fligh object has the following properties:

//   derived
//   filename
//   fixes
//   header
//   preferredAltitudeSource
//   summary

// with derived object (the first record of derived is null) ?
// {
//     "groundSpeedKmh": null,
//     "verticalSpeedMs": null,
//     "cumulativeDistanceKm": 0,
//     "terrainElevationM": null,
//     "aglM": null
// }

// with fixes properties
// {
//     "timeMs": 1785163717000,
//     "latitude": 45.51043333333333,
//     "longitude": 3.2679833333333335,
//     "pressureAltitudeM": 322,
//     "gnssAltitudeM": 434
// }

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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
export interface FlightStoreState {
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  isParsingIgc: boolean;

  settings: Settings;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  currentTimeMs: number;
  altitudeSource: 'pressure' | 'gnss';

  showEscapePath: boolean;
  showReachableZone: boolean;
  showArrivalHeights: boolean;

  elevationGrid: ElevationGrid | null;
  elevationLoadError: string | null;
  exception: Error | null;

  landingZones: LandingZone[];
  landingZonesBySource: ZonesBySource; // Full per-source catalog kept so we can restore zones when a toggle  flips back on without re-fetching.
  visibleLandingZoneIds: Set<string>;
  visibleBounds: [number, number, number, number] | null;

  localCheckResult: LocalCheckResult | null;
  isComputingLocalCheck: boolean;

  loadFlight: (flight: NormalizedFlight) => void;
  clearFlight: () => void;
  setLoadError: (error: IgcParseError | null) => void;
  setIsParsingIgc: (isParsing: boolean) => void;

  play: () => void;
  pause: () => void;
  reset: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  seek: (timeMs: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setAltitudeSource: (source: 'pressure' | 'gnss') => void;
  tick: (deltaMs: number) => void;

  setSettings: (patch: Partial<Settings>) => void;
  setSourceEnabled: (source: keyof ToggleableSource, enabled: boolean) => void;

  setShowEscapePath: (visible: boolean) => void;
  setShowReachableZone: (visible: boolean) => void;
  setShowArrivalHeights: (visible: boolean) => void;  
  resetSettingsToDefaults: () => void;

  setElevationGrid: (grid: ElevationGrid | null) => void;
  setElevationLoadError: (message: string | null) => void; 
  setException: (error: Error | null) => void;

  addLandingZones: (zones: LandingZone[]) => void;
  clearLandingZones: () => void;
  setVisibleBounds: (bbox: [number, number, number, number] | null) => void;

  runLocalCheck: () => Promise<void>;
}

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
        // Initial state
        flight: null,
        loadError: null,
        isParsingIgc: false,

        isPlaying: false,
        playbackSpeed: 1,
        currentTimeMs: 0,
        altitudeSource: 'pressure',

        settings: DEFAULT_SETTINGS,
        showEscapePath: false,
        showReachableZone: false,
        showArrivalHeights: true,

        elevationGrid: null,
        elevationLoadError: null,
        exception: null,

        landingZones: [],
        landingZonesBySource: {},
        visibleLandingZoneIds: new Set<string>(),
        visibleBounds: null,

        localCheckResult: null,
        isComputingLocalCheck: false,

        // Replay Controler
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

        // Settings
        setSettings: (patch: Partial<Settings>) => set((state) => ({ settings: { ...state.settings, ...patch } })),
        setSourceEnabled: (source, enabled) => set((state) => ({
          settings: {
            ...state.settings,
            enabledSources: {
              ...state.settings.enabledSources,
              [source]: enabled,
            },
          },
          // void get().runLocalCheck();
        })),
        
        setShowEscapePath: (visible: boolean) => set({ showEscapePath: visible }),
        setShowReachableZone: (visible: boolean) => set({ showReachableZone: visible }),
        setShowArrivalHeights: (visible: boolean) => set({ showArrivalHeights: visible }),
        resetSettingsToDefaults: () => {
          set({
            settings: DEFAULT_SETTINGS,
            showEscapePath: false,
            showReachableZone: false,
            showArrivalHeights: true,
          });
          // void get().runLocalCheck();
        },

        // Flight file management
        loadFlight: (flight: NormalizedFlight) => {
          set({
            flight,
            loadError: null,
            currentTimeMs: flight.fixes[0]?.timeMs ?? 0,
            isPlaying: false,
            altitudeSource: flight.preferredAltitudeSource,

            elevationGrid: null,
            elevationLoadError: null,
            localCheckResult: null,

            exception: null,
          });
        },
        clearFlight: () =>
          set({
            flight: null,
            isPlaying: false,
            currentTimeMs: 0,
            elevationGrid: null,
            elevationLoadError: null,
            localCheckResult: null,
            exception: null,
          }),
        setLoadError: (error: IgcParseError | null) => set({ loadError: error }),
        setIsParsingIgc: (isParsing: boolean) => set({ isParsingIgc: isParsing }),
        
        // elevation grid management
        setElevationGrid: (grid) =>
          set({ elevationGrid: grid, elevationLoadError: null }),

        setElevationLoadError: (message) =>
          set({ elevationLoadError: message, elevationGrid: null }),

        // Landing zones management
        addLandingZones: (zones) => {
          // const {landingZonesBySource, visibleLandingZoneIds, enabledSources } = get();
          const {landingZonesBySource, visibleLandingZoneIds } = get();

          const nextBySource = mergeZonesBySource(landingZonesBySource, zones);
          const nextVisible = new Set(visibleLandingZoneIds);
          for (const zone of zones) nextVisible.add(zone.id);

          set({
            landingZonesBySource: nextBySource,
            // landingZones: computeActiveZones(nextBySource, enabledSources),
            landingZones: computeActiveZones(nextBySource, DEFAULT_SOURCE_TOGGLES),
            visibleLandingZoneIds: nextVisible,
          });
        },

        clearLandingZones: () =>
          set({
            landingZones: [],
            landingZonesBySource: {},
            visibleLandingZoneIds: new Set(),
            // localCheckResult: null,
          }),

        setVisibleBounds: (bbox) => set({ visibleBounds: bbox }),
        
        runLocalCheck: async () => {
          const {
            flight,
            elevationGrid,
            landingZones,
            settings: localCheckParams,
            altitudeSource,
          } = get();

          if (!flight || !elevationGrid || landingZones.length === 0) return;

          const startedAt = import.meta.env.DEV ? performance.now() : 0;

          set({ isComputingLocalCheck: true });

          console.log('BEFORE running runLocalCheckFull() in a worker');
          const result = await localCheckChannel.run({
            fixes: flight.fixes,
            altitudeSource,
            elevationGrid,
            landingZones,
            // phases,
            params: localCheckParams,
          });
          console.log('AFTER running runLocalCheckFull() in a worker');

          // `null` means a newer request superseded this one — leave both the
          // result and the spinner to the newest request.
          if (result === null && localCheckChannel.isLatestPending()) return;

          set({
            isComputingLocalCheck: false,
            ...(result !== null ? { localCheckResult: result } : {}),
          });

          if (import.meta.env.DEV) {
            console.log(
              `[runLocalCheck] ${(performance.now() - startedAt).toFixed(2)} ms`,
            );
          }
        },

        setException: (error) => set({ exception: error }),
      }
    },
    {
      name: 'flight-store',
      version: 1,

      // Pick only the properties you want to keep in localStorage
      partialize: (state) => ({ 
        playbackSpeed: state.playbackSpeed ,
        settings: state.settings,
        showEscapePath: state.showEscapePath,
        showReachableZone: state.showReachableZone,
        showArrivalHeights: state.showArrivalHeights,

      }),
      // merge: (persistedState, currentState) => {
      //   const persisted = persistedState as Partial<FlightStoreState>;

      //   return {
      //     ...currentState,
      //     ...persisted,
      //     settings: {
      //       ...currentState.settings,
      //       ...persisted.settings,
      //       enabledSources: {
      //         ...currentState.settings.enabledSources,
      //         ...persisted.settings?.enabledSources,
      //       },
      //     },
      //   };
      // },

    }
  )
);