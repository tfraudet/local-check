
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { findCurrentFixIndex, flightTimeBounds, type IgcParseError, type NormalizedFlight } from '../domain/flight';
import type { ElevationGrid } from '@/domain/elevation';
import type { LandingZone } from '../domain/landingZone';
import { computeActiveZones, DEFAULT_SOURCE_TOGGLES, mergeZonesBySource } from './landingZoneCatalog';
import type { ZonesBySource, ToggleableSource, SourceToggles } from './landingZoneCatalog';
import type { LocalCheckInput, LocalCheckResult } from '@/domain/localCheck';

import { createWorkerChannel } from './workerChannel';
import { DEFAULT_REACHABLE_ZONE_PARAMS, recommendedReachableZoneParams, type ReachableZoneInputs, type ReachableZoneParams, type ReachableZoneResult } from '@/domain/reachableZone';
import { pickAltitude } from '@/domain/units';
import { applyQnhOffsetToFlight, computeQnhOffset, QNH_DEFAULT_SAMPLES, QNH_MIN_SAMPLES, type QnhCorrectionError } from '@/domain/qnhCorrection';
import { DEFAULT_ELEVATION_SOURCE, SUPPORTED_ELEVATION_SOURCES, type ElevationSource } from '@/services/elevationApi';

function describeQnhError(err: QnhCorrectionError): string {
  switch (err.kind) {
    case 'insufficient-samples':
      return `QNH recalibration disabled: only ${err.available} pre-takeoff fix(es) available (need at least ${QNH_MIN_SAMPLES}).`;
    case 'no-pressure-altitude':
      return 'QNH recalibration disabled: pressure altitude missing in pre-takeoff fixes.';
    case 'no-terrain':
      return 'QNH recalibration disabled: no terrain elevation available at the takeoff position.';
  }
}


export type PlaybackSpeed = 1 | 2 | 4 | 8 | 16 | 32;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sources the user can switch off. Anything not listed is always on. */
// const TOGGLEABLE_SOURCES: Record<string, boolean> = {
//   'outlanding-alps': false,
//   'outlanding-auvergne': false,
// };

export interface Settings {
  // Parameters for the local check algorithm
  workingLD: number;
  arrivalHeightM: number;
  groundClearanceM: number;
  timeStepS: number;
  enlThreshold: number;
  detectFinalGlide: boolean;

  // Terrain-aware routing: when enabled, escape path / arrival heights /
  // reachable zone / local-check consider curved paths around ridges
  // instead of rejecting LZs behind terrain. Off by default (slower).
  terrainAwareRouting: boolean;

  // Recalibrate barometric altitude on local QNH (using first N pre-takeoff
  // fixes compared to terrain elevation).
  recalibrateAltitude: boolean;

  // Terrain-elevation backend used to build the DEM grid on flight load.
  elevationSource: ElevationSource;

  // Enabled sources for landng zones
  enabledSources: SourceToggles;

  // show / hide features
  showEscapePath: boolean;
  showArrivalHeights: boolean;
  showReachableZone: boolean;
  reachableZoneParams: ReachableZoneParams;
}

export const DEFAULT_SETTINGS : Settings = {
  // parameters for the local check algorithm
  workingLD: 20,
  arrivalHeightM: 300,
  groundClearanceM: 150,
  timeStepS: 20,
  enlThreshold: 500,
  detectFinalGlide: true,
  terrainAwareRouting: false,
  recalibrateAltitude: false,

  elevationSource: DEFAULT_ELEVATION_SOURCE,

  //enabled sources for landing zones
  enabledSources: DEFAULT_SOURCE_TOGGLES,

  showEscapePath: false,
  showReachableZone: false,
  showArrivalHeights: true,
  reachableZoneParams: DEFAULT_REACHABLE_ZONE_PARAMS

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
export interface FlightStoreState {
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  isParsingIgc: boolean;

  settings: Settings;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  currentTimeMs: number;
  altitudeSource: 'pressure' | 'gnss';

  elevationGrid: ElevationGrid | null;
  elevationLoadError: string | null;
  qnhWarning: string | null;
  isLoadingAirports: boolean;
  hasLoadedAirports: boolean;
  airportsLoadError: string | null;
  exception: Error | null;

  landingZones: LandingZone[];
  landingZonesBySource: ZonesBySource; // Full per-source catalog kept so we can restore zones when a toggle  flips back on without re-fetching.
  visibleLandingZoneIds: Set<string>;
  visibleBounds: [number, number, number, number] | null;

  localCheckResult: LocalCheckResult | null;
  isComputingLocalCheck: boolean;

  reachableZoneResult: ReachableZoneResult | null;
  isComputingReachableZone: boolean;

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
  setSourceEnabled: (source: ToggleableSource, enabled: boolean) => void;

  resetSettingsToDefaults: () => void;

  setElevationGrid: (grid: ElevationGrid | null) => void;
  setElevationLoadError: (message: string | null) => void;
  setIsLoadingAirports: (loading: boolean) => void;
  setAirportsLoaded: () => void;
  setAirportsLoadError: (message: string | null) => void;
  setException: (error: Error | null) => void;

  addLandingZones: (zones: LandingZone[]) => void;
  clearLandingZones: () => void;
  toggleLandingZoneVisibility: (id: string) => void;
  setVisibleBounds: (bbox: [number, number, number, number] | null) => void;

  runLocalCheck: () => Promise<void>;
  runReachableZone: () => Promise<void>;
  clearReachableZone: () => void;
}

export const useFlightStore = create<FlightStoreState>()(
  persist(
    (set, get) => {
      /** Recompute QNH offset when the settings toggle or the elevation
       * grid changes. Clears the correction when the toggle is off or when
       * calibration fails; sets a warning message for user feedback. */
      const reapplyQnhCorrection = () => {
        const { flight, elevationGrid, settings } = get();
        if (!flight) return;

        // Toggle off → drop any previously computed offset.
        if (!settings.recalibrateAltitude) {
          if (flight.qnhOffsetM != null) {
            set({
              flight: applyQnhOffsetToFlight(flight, null, elevationGrid),
              qnhWarning: null,
            });
          } else {
            set({ qnhWarning: null });
          }
          return;
        }

        // Toggle on but grid not ready yet → wait for setElevationGrid.
        if (!elevationGrid) {
          set({ qnhWarning: null });
          return;
        }

        const outcome = computeQnhOffset(
          flight.fixes,
          flight.derived,
          elevationGrid,
          QNH_DEFAULT_SAMPLES,
        );
        if (!outcome.ok) {
          set({
            flight: applyQnhOffsetToFlight(flight, null, elevationGrid),
            qnhWarning: describeQnhError(outcome.error),
          });
          return;
        }

        set({
          flight: applyQnhOffsetToFlight(flight, outcome.correction.offsetM, elevationGrid),
          qnhWarning: null,
        });
      };

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

        elevationGrid: null,
        elevationLoadError: null,
        qnhWarning: null,
        isLoadingAirports: false,
        hasLoadedAirports: false,
        airportsLoadError: null,
        exception: null,

        landingZones: [],
        landingZonesBySource: {},
        visibleLandingZoneIds: new Set<string>(),
        visibleBounds: null,

        localCheckResult: null,
        isComputingLocalCheck: false,
        reachableZoneResult: null,
        isComputingReachableZone: false,

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
        setSettings: (patch: Partial<Settings>) => {
          const prev = get().settings;
          const nextSettings = { ...prev, ...patch } as Settings;
          set({ settings: nextSettings });
          if ('recalibrateAltitude' in patch && patch.recalibrateAltitude !== prev.recalibrateAltitude) {
            reapplyQnhCorrection();
          }
        },
        // Recompute with the updated source selection.
        setSourceEnabled: (source, enabled) => {
          const currentSettings = get().settings;
          const nextSources = {...currentSettings.enabledSources, [source]: enabled, };
          const nextLandingZones = computeActiveZones(get().landingZonesBySource, nextSources);
          const activeIds = new Set(nextLandingZones.map((zone) => zone.id));
          const nextVisible = new Set(
            [...get().visibleLandingZoneIds].filter((id) => activeIds.has(id)),
          );

          if (enabled) {
            for (const zone of get().landingZonesBySource[source] ?? []) {
              if (activeIds.has(zone.id)) nextVisible.add(zone.id);
            }
          }

          // Mettre à jour le store en une seule fois
          set((state) => ({
            settings: {
              ...state.settings,
              enabledSources: nextSources,
            },
            landingZones: nextLandingZones,
            visibleLandingZoneIds: nextVisible,
          }));
        },
        
        resetSettingsToDefaults: () => {
          const nextLandingZones = computeActiveZones(
            get().landingZonesBySource,
            DEFAULT_SOURCE_TOGGLES,
          );
          const activeIds = new Set(nextLandingZones.map((zone) => zone.id));
          const nextVisible = new Set(
            [...get().visibleLandingZoneIds].filter((id) => activeIds.has(id)),
          );

          set({
            settings: DEFAULT_SETTINGS,
            landingZones: nextLandingZones,
            visibleLandingZoneIds: nextVisible,
          });
        },

        // Flight file management
        loadFlight: (flight: NormalizedFlight) => {
          // OpenAIP airports are country-dependent: a new flight may cross a
          // different set of countries, so drop the previously fetched batch
          // and let `useAirportsLoader` refetch. Other sources (user .cup,
          // outlanding catalogs) are flight-independent and preserved.

          // const { landingZonesBySource, visibleLandingZoneIds } = get();
          // const {
          //   openaip: _dropped,
          //   ...restBySource
          // } = landingZonesBySource;
          // void _dropped;
          // const nextVisible = new Set(visibleLandingZoneIds);
          // if (landingZonesBySource.openaip) {
          //   for (const z of landingZonesBySource.openaip) nextVisible.delete(z.id);
          // }

          set({
            flight: { ...flight, qnhOffsetM: null },
            loadError: null,
            currentTimeMs: flight.fixes[0]?.timeMs ?? 0,
            isPlaying: false,
            altitudeSource: flight.preferredAltitudeSource,

            elevationGrid: null,
            elevationLoadError: null,
            qnhWarning: null,
            isLoadingAirports: false,
            hasLoadedAirports: false,
            airportsLoadError: null,
            localCheckResult: null,
            reachableZoneResult: null,

            // landingZonesBySource: restBySource,
            // landingZones: computeActiveZones(restBySource, DEFAULT_SOURCE_TOGGLES),
            // visibleLandingZoneIds: nextVisible,

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
            isLoadingAirports: false,
            hasLoadedAirports: false,
            airportsLoadError: null,

            localCheckResult: null,
            isComputingLocalCheck: false,
            
            reachableZoneResult: null,
            isComputingReachableZone: false,
           
            exception: null,
          }),
        setLoadError: (error: IgcParseError | null) => set({ loadError: error }),
        setIsParsingIgc: (isParsing: boolean) => set({ isParsingIgc: isParsing }),
        
        // elevation grid management
        setElevationGrid: (grid) => {
          set({ elevationGrid: grid, elevationLoadError: null });
          if (!grid) return;

          // Match the reachable-zone grid to the DEM this flight actually
          // got. Backends coarsen their step to a sample budget, so the
          // resolution depends on the flight's bounding box: ~62 m for a
          // local flight, ~247 m for a long XC. A fixed default is therefore
          // either wasteful (sampling below the DEM only interpolates the
          // same cells) or needlessly coarse.
          //
          // Deliberately runs on elevation load, i.e. once per flight, so a
          // manual choice made afterwards sticks until the next flight.
          const prevSettings = get().settings;
          const prevParams = prevSettings.reachableZoneParams;
          const nextParams = recommendedReachableZoneParams(
            grid.resolutionM,
            prevParams.diameterKm,
          );
          if (
            nextParams.gridSizeM !== prevParams.gridSizeM ||
            nextParams.diameterKm !== prevParams.diameterKm
          ) {
            set({
              settings: { ...prevSettings, reachableZoneParams: nextParams },
            });
          }

          reapplyQnhCorrection();
        },

        setElevationLoadError: (message) =>
          set({ elevationLoadError: message, elevationGrid: null }),

        setIsLoadingAirports: (loading) => set({ isLoadingAirports: loading }),
        setAirportsLoaded: () =>
          set({ isLoadingAirports: false, hasLoadedAirports: true, airportsLoadError: null }),
        setAirportsLoadError: (message) =>
          set({ isLoadingAirports: false, airportsLoadError: message }),

        // Landing zones management
        addLandingZones: (zones) => {
          const {landingZonesBySource, visibleLandingZoneIds } = get();
          const enabledSources = get().settings.enabledSources;

          const nextBySource = mergeZonesBySource(landingZonesBySource, zones);
          const nextLandingZones = computeActiveZones(nextBySource, enabledSources);
          const activeIds = new Set(nextLandingZones.map((zone) => zone.id));
          const nextVisible = new Set(
            [...visibleLandingZoneIds].filter((id) => activeIds.has(id)),
          );
          for (const zone of zones) {
            if (activeIds.has(zone.id)) nextVisible.add(zone.id);
          }

          set({
            landingZonesBySource: nextBySource,
            landingZones: nextLandingZones,
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

        toggleLandingZoneVisibility: (id) => {
          const next = new Set(get().visibleLandingZoneIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          set({ visibleLandingZoneIds: next });
        },  

        setVisibleBounds: (bbox) => set({ visibleBounds: bbox }),
        clearReachableZone: () => set({ reachableZoneResult: null }),

        runLocalCheck: async () => {
          const {
            flight,
            elevationGrid,
            landingZones,
            visibleLandingZoneIds,
            settings: localCheckParams,
            altitudeSource,
          } = get();

          if (!flight || !elevationGrid || landingZones.length === 0) return;

          // Hidden zones must not be considered reachable by the check.
          const selectedZones = landingZones.filter((zone) =>
            visibleLandingZoneIds.has(zone.id),
          );

          const startedAt = import.meta.env.DEV ? performance.now() : 0;

          set({ isComputingLocalCheck: true });

          // console.log('BEFORE running runLocalCheckFull() in a worker');
          const result = await localCheckChannel.run({
            fixes: flight.fixes,
            altitudeSource,
            elevationGrid,
            landingZones: selectedZones,
            // phases,
            params: localCheckParams,
            qnhOffsetM: flight.qnhOffsetM ?? 0,
          });
          // console.log('AFTER running runLocalCheckFull() in a worker');

          // `null` means a newer request superseded this one — leave both the
          // result and the spinner to the newest request.
          if (result === null && localCheckChannel.isLatestPending()) return;

          set({
            isComputingLocalCheck: false,
            ...(result !== null ? { localCheckResult: result } : {}),
          });

          if (import.meta.env.DEV) {
            console.log(
              `[usFlightStore.runLocalCheck] ${(performance.now() - startedAt).toFixed(2)} ms`,
            );
          }
        },

        runReachableZone: async () => {
          const {
            flight,
            currentTimeMs,
            elevationGrid,
            settings: {
              reachableZoneParams,
              showReachableZone,
              ...localCheckParams
            },
            altitudeSource,
          } = get();

          if (!showReachableZone || !flight || !elevationGrid) return;

          // Locate the fix closest to the current replay time.
          const idx = findCurrentFixIndex(flight, currentTimeMs);
          if (idx < 0) return;
          const fix = flight.fixes[idx];
          const altM = pickAltitude(fix, altitudeSource, flight.qnhOffsetM ?? 0);
          if (altM === null) return;

          set({ isComputingReachableZone: true });

          // console.log('BEFORE running reachableZoneChannel() in a worker');
          const result = await reachableZoneChannel.run({
            sourceLat: fix.latitude,
            sourceLon: fix.longitude,
            sourceAltM: altM,
            grid: elevationGrid,
            params: localCheckParams,
            zoneParams: reachableZoneParams,
            terrainAwareRouting: localCheckParams.terrainAwareRouting,
          });
          // console.log('AFTER running reachableZoneChannel() in a worker');

          // Stale response: the newest request is still running, so neither
          // the result nor the spinner belongs to us.
          if (result === null && reachableZoneChannel.isLatestPending()) return;

          set({
            isComputingReachableZone: false,
            ...(result !== null ? { reachableZoneResult: result } : {}),
          });
        },

        setException: (error) => set({ exception: error }),
      }
    },
    {
      name: 'flight-store',
      version: 3,

      // Pick only the properties you want to keep in localStorage
      partialize: (state) => ({
        playbackSpeed: state.playbackSpeed ,
        settings: state.settings,
      }),

      // Fill in fields added in newer versions with defaults so existing
      // users don't lose their persisted settings when the shape changes.
      migrate: (persistedState, fromVersion) => {
        const state = (persistedState ?? {}) as { settings?: Partial<Settings> };
        if (fromVersion < 2) {
          const source = state.settings?.elevationSource;
          const valid =
            source && SUPPORTED_ELEVATION_SOURCES.includes(source)
              ? source
              : DEFAULT_ELEVATION_SOURCE;
          state.settings = {
            ...DEFAULT_SETTINGS,
            ...(state.settings ?? {}),
            elevationSource: valid,
          };
        }
        if (fromVersion < 3) {
          // v3 adds `terrainAwareRouting` (default off). Existing settings
          // are merged over the new defaults so no user preference is lost.
          state.settings = {
            ...DEFAULT_SETTINGS,
            ...(state.settings ?? {}),
          };
        }
        return state as never;
      },
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