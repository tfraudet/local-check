# Local Check — Phase 2 Technical Specification

|                  |                                                                               |
| ---------------- | ----------------------------------------------------------------------------- |
| **Product**      | Local Check                                                                   |
| **Document**     | Phase 2 (Local verification) Technical Specification                          |
| **Version**      | 0.1 (Draft)                                                                   |
| **Status**       | Draft — for review                                                            |
| **Related docs** | `docs/PRD.md` (Product Requirements Document), `docs/phase-1-technical-spec.md` |

---

## 1. Purpose & scope

This document turns Phase 2 of the roadmap (`docs/PRD.md` §6, §8.1, FR-2-1 …
FR-2-6) into a concrete, buildable technical design. Phase 2 introduces the
**core safety-verification feature** the product was designed for: continuously
classifying each point of the flight as **"in local"** (a Landing Zone is
reachable in a glide under safety constraints) or **"out of local"**, with
terrain-aware glide computation.

Phase 2 is **additive** on Phase 1. No Phase 1 module is rewritten — new
layers (elevation service, `.cup` ingestion, worker-based local check,
color-coded rendering) slot on top of the existing state/domain/UI stack.

### 1.1 In scope (Phase 2)

- `.cup` Landing Zone (LZ) import from user-uploaded files, including
  difficulty tags and de-duplication (FR-2-1).
- Terrain elevation integration via an HTTP elevation API, pre-fetched at
  flight load; AGL (Height Above Ground Level) computed per fix (FR-2-2).
- Configurable computation parameters: working L/D, safety arrival height,
  ground clearance, time step, ENL threshold (FR-2-3).
- Continuous in/out-of-local classification and missing-height per sampled
  point (FR-2-4).
- Color-coded map track and barogram with an out-of-local statistics panel
  (FR-2-5).
- Flight-phase detection: initial climb (tow/winch), motor use via ENL/MOP,
  final glide (FR-2-6).

### 1.2 Explicitly out of scope (Phase 2)

Deferred to Phase 3+:

- Escape-path visualization at sampled points.
- Reachable-zone computation and rendering.
- Arrival-height overlays over LZs.
- Airspace detection, wind modeling, downloadable reports, batch processing.
- Bundled/shipped LZ datasets or bundled terrain data.
- Any backend, database, authentication, or server-side storage (aside from
  the third-party elevation HTTP API).

---

## 2. Architecture overview

Phase 2 keeps the Phase 1 client-side SPA and layered design intact. Two new
horizontal layers are introduced: a **services layer** (external HTTP calls,
kept isolated) and an additional **worker** for the local-check computation.

### 2.1 Layered design

```
┌────────────────────────────────────────────────────────────────────┐
│  UI Layer                                                          │
│  [Phase 1] MapView | Barogram | ReplayControls | TelemetryPanel |  │
│            FlightSummaryPanel | AppSidebar | ThemeProvider         │
│  [Phase 2] LandingZonesPanel | LocalCheckSettings | LocalStatsPanel│
│            ColorLegend                                              │
└────────────▲───────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────┐
│  State Layer (Zustand)                                             │
│  [Phase 1] flight, currentTimeMs, isPlaying, playbackSpeed,        │
│            altitudeSource                                          │
│  [Phase 2] elevationGrid, landingZones, visibleLandingZoneIds,     │
│            localCheckParams, localCheckResult, isComputingLocalCheck│
└────────────▲───────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────┐
│  Domain Layer (pure TypeScript)                                    │
│  [Phase 1] flight, normalizeIgc, derivedMetrics, summary, units    │
│  [Phase 2] landingZone, parseCup, elevation, glide, localCheck,    │
│            enlDetection, flightPhases                              │
└────────────▲───────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────┐
│  Services Layer                                                    │
│  [Phase 2] elevationApi (HTTP client for Open-Elevation)           │
└────────────▲───────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────┐
│  Worker Layer                                                      │
│  [Phase 1] igcParser.worker.ts                                     │
│  [Phase 2] localCheck.worker.ts                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data flow — Phase 2 happy path

1. User uploads `.igc` → Phase 1 path unchanged, `NormalizedFlight` stored.
2. On successful flight load, the store triggers `elevationApi.fetchGrid(bbox)`
   with a bbox buffered by 10 km around the flight envelope.
3. Elevation grid received → stored in `elevationGrid`. Per-fix
   `terrainElevationM` and `aglM` are computed and merged into the existing
   `DerivedPoint` array (single traversal).
4. User uploads one or more `.cup` files via `LandingZonesPanel`. Each file is
   parsed on the main thread (small files), merged into the current LZ list,
   and de-duplicated.
5. As soon as the pre-conditions are met (flight loaded + elevation grid
   present + ≥ 1 LZ), `runLocalCheck()` posts inputs to
   `localCheck.worker`.
6. Worker samples the flight every `timeStepS` seconds, computes per-sample
   AGL, best-reachable LZ, glide-plane terrain-clearance check, status
   classification, missing height, and flight-phase tag. It posts back
   `LocalCheckResult` (samples + aggregate stats).
7. `MapView` re-renders the track with a color-coded gradient / segmentation,
   and adds an LZ symbol layer. `Barogram` re-renders the altitude line with
   phase/status coloring. `LocalStatsPanel` displays aggregates.
8. Any change to `localCheckParams` re-invokes the worker with the cached
   `fixes`/`elevationGrid`/`landingZones` inputs (no re-parse, no re-fetch).

### 2.3 Non-happy paths

- **Elevation API failure / offline:** `elevationLoadError` set;
  `LandingZonesPanel` and `LocalCheckSettings` display "terrain data
  unavailable — retry?" and disable the local check. Phase 1 replay is
  unaffected.
- **No LZ uploaded yet:** the local check does not run; the map shows the
  neutral Phase 1 track color and a hint to upload a `.cup` file.
- **Malformed `.cup`:** parser returns typed errors; per-file toast with the
  line number and reason.

---

## 3. Technology stack additions

| Concern              | Choice                                                                                                          | Rationale                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.cup` parsing       | Hand-rolled parser in `src/domain/parseCup.ts`                                                                  | Small CSV-like format; hand-rolled parser avoids adding a runtime dep and directly handles the SeeYou coordinate format and difficulty tags. |
| Elevation API client | Fetch-based, POST-batched to `Open-Elevation` (`/api/v1/lookup`); base URL configurable via `VITE_ELEVATION_API_URL`. | Free, keyless, batch-friendly; env-swappable to alternatives like `OpenTopography` without code changes.                                     |
| Elevation grid       | In-memory regular grid with bilinear sampling                                                                    | Sub-cell accuracy along the track; no dependency on a raster library; grid resolution auto-clamped to control API cost.                        |
| Color-coded track    | MapLibre `line-gradient` data-driven expression on the existing GeoJSON source (fallback: multi-feature segments) | Reuses Phase 1 track source; single-pass GPU render; no per-fix feature explosion.                                                              |
| LZ symbols on map    | MapLibre `symbol` layer with a small local sprite (airfield / outlanding / difficulty variants)                  | Client-side, no external icon dependency.                                                                                                    |
| Barogram coloring    | uPlot per-point paint hook (or segmented series) driven by the same phase/status codes                            | Reuses the existing uPlot instance; no new charting library.                                                                                 |

No changes to React / Vite / Tailwind / shadcn-ui / MapLibre / uPlot / Zustand /
react-i18next.

---

## 4. Project structure additions

```
local-check/
├── docs/
│   ├── PRD.md
│   ├── phase-1-technical-spec.md
│   └── phase-2-technical-spec.md           # this document
├── public/
│   └── icons/lz/                           # [new]  airfield/outlanding sprite images
├── src/
│   ├── components/
│   │   ├── LandingZonesPanel.tsx           # [new]  upload .cup, list, per-zone visibility
│   │   ├── LocalCheckSettings.tsx          # [new]  L/D, arrival height, clearance, timeStep, ENL
│   │   ├── LocalStatsPanel.tsx             # [new]  aggregate out-of-local statistics
│   │   ├── ColorLegend.tsx                 # [new]  legend for track/baro colors
│   │   ├── MapView.tsx                     # [mod]  add LZ symbol layer + gradient track
│   │   └── Barogram.tsx                    # [mod]  phase/status coloring
│   ├── domain/
│   │   ├── landingZone.ts                  # [new]  LandingZone, DifficultyTag types
│   │   ├── parseCup.ts                     # [new]  SeeYou .cup parser → LandingZone[]
│   │   ├── elevation.ts                    # [new]  ElevationGrid model + bilinear sampling
│   │   ├── glide.ts                        # [new]  glide-plane / reachable-from-fix primitives
│   │   ├── localCheck.ts                   # [new]  classification + missing-height algorithm
│   │   ├── enlDetection.ts                 # [new]  motor use from ENL/MOP
│   │   ├── flightPhases.ts                 # [new]  initial-climb & final-glide heuristics
│   │   └── flight.ts                       # [mod]  extend DerivedPoint with terrainElevationM/aglM
│   ├── services/
│   │   └── elevationApi.ts                 # [new]  batched HTTP client for Open-Elevation
│   ├── workers/
│   │   ├── igcParser.worker.ts             # [phase 1]
│   │   └── localCheck.worker.ts            # [new]  runs localCheck.run() off the main thread
│   ├── state/
│   │   └── useFlightStore.ts               # [mod]  add LZ/elevation/params/result slices + actions
│   └── i18n/locales/en.json                # [mod]  new keys for LZ/settings/stats/legend
├── fixtures/
│   ├── sample-flights/                     # [mod]  add "leaves-local" and "always-in-local" fixtures
│   └── landing-zones/                      # [new]  small hand-curated .cup for tests
```

---

## 5. Domain data model (extensions)

The domain layer remains framework-agnostic. All new types live in
`src/domain/` and never import from React / MapLibre / uPlot.

```ts
// src/domain/landingZone.ts

export type DifficultyTag =
  | 'A'   // airfield
  | 'F'   // easy
  | 'E'   // easy (alt tag)
  | 'ZA'  // group of fields
  | 'LA'  // group of fields (alt tag)
  | 'M'   // medium
  | 'D'   // difficult
  | 'TD'  // very difficult
  | 'VD'; // very difficult (alt tag)

export interface LandingZone {
  /** Stable ID derived from name + lat + lon (SHA-1 / fnv). */
  id: string;
  name: string;
  code: string | null;              // .cup "code" column
  latitude: number;                 // decimal degrees
  longitude: number;                // decimal degrees
  elevationM: number | null;        // from .cup elevation column, null if absent
  style: number | null;             // .cup style code (2 = airfield grass, etc.)
  difficulty: DifficultyTag | null;
  description: string | null;
  isAirfield: boolean;              // style ∈ {2,3,4,5} OR difficulty === 'A'
}
```

```ts
// src/domain/elevation.ts

export interface ElevationGrid {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  cols: number;                            // grid width (samples)
  rows: number;                            // grid height (samples)
  resolutionM: number;                     // approximate cell size for reporting
  data: Float32Array;                      // row-major, length = cols * rows
}

/** Bilinear interpolation. Returns NaN if the point is outside the grid. */
export function sampleElevation(
  grid: ElevationGrid,
  lat: number,
  lon: number,
): number;
```

```ts
// src/domain/localCheck.ts

export interface LocalCheckParams {
  workingLD: number;                      // default 20
  arrivalHeightM: number;                 // default 300
  groundClearanceM: number;               // default 150
  timeStepS: number;                      // default 20 (min 10)
  enlThreshold: number;                   // default 500
}

export type FlightPhase =
  | 'initial-climb'      // tow / winch
  | 'motor'              // ENL over threshold
  | 'cruise'
  | 'final-glide';       // sustained descent + low-altitude circuit into the LZ

export type LocalStatus =
  | 'in-local'
  | 'in-local-marginal'  // 0 <= margin < 100 m
  | 'out-of-local';

export interface SampledPoint {
  timeMs: number;
  fixIndex: number;
  latitude: number;
  longitude: number;
  altitudeM: number;
  terrainElevationM: number | null;
  aglM: number | null;
  phase: FlightPhase;
  status: LocalStatus;
  bestLzId: string | null;                // null if out-of-local
  missingHeightM: number;                 // 0 if in-local; positive if out
  marginAboveGlidePlaneM: number;         // positive = in-local
}

export interface LocalCheckResult {
  params: LocalCheckParams;
  samples: SampledPoint[];
  stats: {
    outOfLocalTimeMs: number;
    outOfLocalPercent: number;
    meanMissingHeightM: number;
    maxMissingHeightM: number;
    firstOutOfLocalTimeMs: number | null;
  };
  computedAt: number;                     // ms since epoch
}
```

```ts
// src/domain/flight.ts — extension (Phase 2)

export interface DerivedPoint {
  groundSpeedKmh: number | null;
  verticalSpeedMs: number | null;
  cumulativeDistanceKm: number;
  terrainElevationM: number | null;       // [new]  bilinear sample under fix
  aglM: number | null;                    // [new]  fix altitude − terrainElevationM
}
```

The `derivedMetrics` computation is extended to accept an optional
`ElevationGrid` and populate the two new fields when the grid is available.
When the grid is `null`, both fields remain `null` and Phase 1 behavior is
preserved.

---

## 6. Component / module technical requirements

### 6.1 `.cup` ingestion (`LandingZonesPanel`, `domain/parseCup.ts`)

**Maps to:** FR-2-1

- `LandingZonesPanel` accepts `.cup` files via file picker and drag-and-drop.
  Multiple files can be uploaded in the same session; results are merged.
- Parsing runs on the main thread (files are typically kilobytes to a few MB).
- **Parse rules:**
  - First non-empty line is the header row; subsequent rows are records.
  - Fields are comma-separated with optional double-quoting; embedded commas
    inside quoted fields are respected.
  - Latitude is in the SeeYou `DDMM.mmm[NS]` format; longitude in
    `DDDMM.mmm[EW]` — convert to decimal degrees.
  - Elevation supports `m`/`ft` suffixes; convert to meters.
  - Difficulty tags are extracted from the description column via a regex over
    `{A}|{F}|{E}|{ZA}|{LA}|{M}|{D}|{TD}|{VD}`.
- **De-duplication:** LZs within 250 m of one another are considered the same
  physical point. Merging rules: prefer entries with a difficulty tag; entries
  flagged as airfields (via style code or `{A}` tag) are always kept.
- **Errors:** typed per-file result — `{ ok: true, zones }` or
  `{ ok: false, errors: [{ line, message }] }`. UI shows a toast with the first
  N errors and the parse count.
- Panel lists parsed zones grouped by airfield vs outlanding; each row has a
  visibility toggle (map only — all uploaded zones remain active in the local
  check regardless of visibility).

### 6.2 Elevation service (`services/elevationApi.ts`, `domain/elevation.ts`)

**Maps to:** FR-2-2

- **Bbox calculation:** compute the flight's lon/lat envelope; expand by 10 km
  in each direction to allow LZs slightly outside the track's own hull.
- **Grid sizing:** target ~90 m cell spacing (SRTM-comparable); cap the total
  sample count at 40,000 (200 × 200 grid) to keep API round-trips bounded.
  Very large tracks degrade resolution rather than fail.
- **HTTP calls:** POST `/api/v1/lookup` with a JSON `locations` array,
  chunked to 500 points per request; issue requests in parallel with a
  concurrency of 4; report cumulative progress to the UI.
- **Errors:** any HTTP failure (network, non-2xx, rate limit) sets
  `elevationLoadError` and disables the local check. `LandingZonesPanel`
  displays a retry button.
- **Sampling:** `sampleElevation(grid, lat, lon)` performs bilinear
  interpolation across the 4 surrounding cells. Callers outside the bbox get
  `NaN`, which propagates as `null` in `terrainElevationM` / `aglM`.
- **Cache lifetime:** in-memory only, tied to the loaded flight. Loading a
  new flight discards the previous grid.

### 6.3 Local-check algorithm (`domain/localCheck.ts`, `domain/glide.ts`, `workers/localCheck.worker.ts`)

**Maps to:** FR-2-3, FR-2-4, FR-2-5

**Worker contract:**

```ts
// posted to worker
type LocalCheckRequest = {
  fixes: Fix[];
  altitudeSource: 'pressure' | 'gnss';
  elevationGrid: ElevationGrid;
  landingZones: LandingZone[];
  params: LocalCheckParams;
  phases: FlightPhase[]; // pre-computed per-fix phases (see §6.4)
};

// posted back
type LocalCheckResponse =
  | { kind: 'ok'; result: LocalCheckResult }
  | { kind: 'error'; message: string };
```

**Sampling loop:**

- Iterate `fixes` in time order; emit one sample whenever
  `fix.timeMs - lastSampleTimeMs >= params.timeStepS * 1000`.
- Guarantee at least one sample per LZ-visible interval (never skip more than
  `timeStepS` even in gaps).

**Per-sample computation:**

1. **AGL:** `terrainElevationM = sampleElevation(grid, lat, lon)`;
   `aglM = altitudeM - terrainElevationM` (or `null` if terrain is `NaN`).
2. **Candidate LZs:** filter by a maximum plausible glide distance:
   `maxDistM = (altitudeM - lzElevM - arrivalHeightM) * workingLD`.
   Skip LZs where `maxDistM ≤ 0`.
3. **Straight-line glide-plane check:** for each candidate,
   `distanceM = haversine(fix, lz)`;
   `requiredAltitudeM = lzElevM + arrivalHeightM + distanceM / workingLD`;
   `margin = altitudeM - requiredAltitudeM`.
   Along the great-circle-approximated straight line, sample terrain every
   ~200 m and verify the glide-plane altitude at each step is at least
   `terrainAtStep + groundClearanceM`. If any step fails, the LZ is
   ineligible for this fix.
4. **Best LZ:** pick the LZ with the largest positive `margin`. If none
   qualifies (all fail the terrain check or all have negative margins),
   status is `out-of-local` and
   `missingHeightM = -max(margin)` across all candidates (or a sentinel large
   value if there are no candidates in range at all).
5. **Marginal band:** `0 ≤ margin < 100 m` yields status `in-local-marginal`.
6. **Phase override:** if the pre-computed `phases[fixIndex]` is
   `initial-climb`, `motor`, or `final-glide`, the display status
   coloring uses the phase color (§9.3 of PRD), while the underlying
   in/out-of-local status is still stored for statistics.

**Statistics:**

- `outOfLocalTimeMs`: sum of `timeStepS * 1000` over samples with
  status `out-of-local` and phase `cruise`.
- `outOfLocalPercent`: `outOfLocalTimeMs / flightDurationMs`.
- `meanMissingHeightM`, `maxMissingHeightM`: over out-of-local cruise samples.
- `firstOutOfLocalTimeMs`: earliest such sample's `timeMs`, or `null`.

**Performance:** target ≤ 3 s for a typical multi-hour flight
(≈ 500 samples at 20 s step, up to a few dozen LZs), running off-thread.

### 6.4 Flight-phase detection (`domain/flightPhases.ts`, `domain/enlDetection.ts`)

**Maps to:** FR-2-6

Phases are computed in the main thread once at load time (with the flight,
before or independently of the worker) and passed into `runLocalCheck` as an
input.

- **Initial climb:** starting from the first fix, mark consecutive fixes as
  `initial-climb` while vertical speed exceeds a rolling threshold
  (default 1.5 m/s) and altitude is monotonically increasing (with a small
  tolerance). Stop at the first sustained level-off (>10 s below threshold),
  or at 500 m cumulative gain — whichever comes first.
- **Final glide:** walk backward from the last fix; mark fixes as
  `final-glide` while AGL < 300 m AND horizontal distance from the last
  fix < 3 km. Then extend `final-glide` further backwards through the
  sustained descent from the last thermal (≥ 200 m altitude loss, tolerating
  brief climbs ≤ 50 m). Terminate at the first fix that no longer satisfies
  either condition.
- **Motor:** if the IGC file exposes an ENL or MOP extension, mark any fix
  where the value exceeds `params.enlThreshold` (default 500) as `motor`.
  Motor tag wins over `cruise` but loses to `initial-climb` (a motor climb
  from take-off is still classified as `initial-climb`).
- **Cruise:** every fix not otherwise tagged.

`enlDetection.ts` isolates extension-parsing so it can be unit-tested against
fixtures with and without ENL.

### 6.5 Map & barogram coloring

**Maps to:** FR-2-5, PRD §9.3

- **Track coloring (`MapView.tsx`):**
  - Every fix carries a numeric code combining phase & status (e.g., 0 =
    initial-climb, 1 = motor, 2 = in-local, 3 = in-local-marginal, 4 =
    out-of-local, 5 = final-glide).
  - The GeoJSON `LineString` source is enriched at flight-load with an
    ordered `coordinates` array + a matching per-vertex code array supplied
    to MapLibre through `line-gradient` (using the layer's built-in
    `["line-progress"]` when suitable) or via multi-feature line segments
    grouped by code.
  - When no local-check result is available yet, the track uses the neutral
    Phase 1 color to avoid a jarring flash.
- **LZ layer (`MapView.tsx`):** new `symbol` layer sourced from
  `landingZones.filter(z => visibleLandingZoneIds.has(z.id))`. Airfields use
  a filled square icon; outlandings use a diamond, sized by difficulty
  (`A > F > M > D > TD`). Clicking a symbol opens a small popover with the
  LZ metadata (name, code, elevation, difficulty).
- **Barogram (`Barogram.tsx`):** color the altitude line by the same phase/
  status code — implemented as either a uPlot per-point `stroke` hook or as
  multiple parallel series (one per code) drawn in sequence with a shared
  x-axis. Downsampling from Phase 1 is preserved; the color code array is
  downsampled with a "most severe wins" rule so out-of-local segments are
  not lost.
- **Legend (`ColorLegend.tsx`):** persistent legend surfacing the color →
  meaning mapping (cyan initial climb / motor, green in-local, yellow
  marginal, red out-of-local, blue final glide, purple deferred).

### 6.6 Settings & stats panels

- **`LocalCheckSettings.tsx`:**
  - Inputs for L/D (5–60), arrival height (0–1000 m), ground clearance
    (0–500 m), time step (10–120 s), ENL threshold (0–1000).
  - Defaults from PRD Appendix 16.1 (`workingLD=20`, `arrivalHeightM=300`,
    `groundClearanceM=150`, `timeStepS=20`, `enlThreshold=500`).
  - Values persist in `localStorage` under `local-check.params.v1` and
    hydrate on app start.
  - Changing any value calls `setLocalCheckParams(patch)` on the store and
    debounces (250 ms) a `runLocalCheck()` re-invocation.
- **`LocalStatsPanel.tsx`:**
  - Displays: total out-of-local duration, % of flight, mean/max missing
    height, first out-of-local time.
  - The "first out-of-local time" row is a click-to-seek button that calls
    `store.seek(firstOutOfLocalTimeMs)`.
  - Skeleton state while `isComputingLocalCheck` is `true`.

### 6.7 State store additions (`state/useFlightStore.ts`)

```ts
interface FlightStoreState {
  // Phase 1 fields unchanged.
  flight: NormalizedFlight | null;
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: 1 | 2 | 4 | 8 | 16;
  altitudeSource: 'pressure' | 'gnss';

  // Phase 2 additions.
  elevationGrid: ElevationGrid | null;
  elevationLoadError: string | null;
  landingZones: LandingZone[];
  visibleLandingZoneIds: Set<string>;
  localCheckParams: LocalCheckParams;
  localCheckResult: LocalCheckResult | null;
  isComputingLocalCheck: boolean;

  // Existing actions unchanged.
  loadFlight: (flight: NormalizedFlight) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (timeMs: number) => void;
  setSpeed: (speed: 1 | 2 | 4 | 8 | 16) => void;
  setAltitudeSource: (source: 'pressure' | 'gnss') => void;

  // New actions.
  setElevationGrid: (grid: ElevationGrid | null) => void;
  setElevationLoadError: (message: string | null) => void;
  addLandingZones: (zones: LandingZone[]) => void;
  clearLandingZones: () => void;
  toggleLandingZoneVisibility: (id: string) => void;
  setLocalCheckParams: (patch: Partial<LocalCheckParams>) => void;
  runLocalCheck: () => Promise<void>;
}
```

`runLocalCheck` guards its own preconditions (flight + elevation grid +
≥ 1 LZ). It sets `isComputingLocalCheck = true`, posts to
`localCheck.worker`, and stores the result on message. Successive calls
cancel any in-flight worker request.

### 6.8 Internationalization

**Maps to:** existing FR-M-22

New i18n key groups added to `src/i18n/locales/en.json`:

- `landingZones.*` — panel title, upload CTA, empty state, per-file errors.
- `localCheck.settings.*` — labels for L/D, arrival height, clearance,
  timeStep, ENL threshold, tooltips.
- `localCheck.stats.*` — labels for out-of-local time, %, mean/max missing
  height, first-out button.
- `localCheck.legend.*` — labels for each color.
- `errors.elevation.*` — network/rate-limit messages.

---

## 7. Units & formatting

- All new displayed values go through `src/domain/units.ts` metric formatters
  (extended if needed for `formatHeight`, `formatPercent`).
- Metric-only for Phase 2 — a unit-system toggle remains a future concern.

---

## 8. Non-functional & performance requirements

| ID       | Requirement                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| NFR-2T-1 | Elevation prefetch for a typical bbox (~50 × 50 km at 90 m resolution) completes in ≲ 5 s over broadband; progress is visible in the UI. |
| NFR-2T-2 | Local-check computation for a typical multi-hour flight (~500 samples at 20 s step, ≤ 30 candidate LZs) completes in ≲ 3 s off-thread. |
| NFR-2T-3 | Recomputation after a parameter change completes in ≲ 3 s and reuses cached elevation and LZ inputs (no re-fetch, no re-parse). |
| NFR-2T-4 | Replay marker and barogram cursor never stutter (≥ 30 fps) while a worker computation is running.               |
| NFR-2T-5 | A missing or failed elevation fetch disables the local check gracefully; Phase 1 replay is unaffected.          |
| NFR-2T-6 | All new domain modules (`parseCup`, `elevation`, `glide`, `localCheck`, `enlDetection`, `flightPhases`) are unit-tested against fixture files. |
| NFR-2T-7 | Client-side-only guarantee unchanged: the only outbound calls are to the base-map tile provider and the configured elevation API. Flight data is never transmitted (elevation calls send only lat/lon of the pre-computed grid, never IGC content). |

---

## 9. Accessibility & UX

- Color is never the sole carrier of status:
  - `ColorLegend` is persistent and pairs every color with a text label.
  - `TelemetryPanel` gains a text status badge ("In local", "Marginal",
    "Out of local", "Initial climb", "Motor", "Final glide") tied to the
    current fix.
  - LZ layer symbols vary in **shape** as well as color so airfield vs
    outlanding is distinguishable in monochrome.
- All new panels are keyboard-navigable. Sliders in `LocalCheckSettings` have
  paired text inputs so precise values can be typed.
- Focus rings and contrast follow the Phase 1 palette from Tailwind / shadcn.

---

## 10. Tooling & quality

- **Scripts unchanged.** `dev`, `build`, `preview`, `lint`, `format`, `test`,
  `test:e2e` continue to work.
- **Testing pyramid additions:**
  - _Unit (Vitest):_ `parseCup` (well-formed, quoted fields, difficulty tags,
    dedupe within 250 m); `elevation` (bilinear at cell centers, edges,
    outside-bbox NaN); `glide` (required-altitude math, terrain-check happy
    and failing paths); `localCheck` (classification & missing-height on a
    hand-crafted flight); `enlDetection`; `flightPhases`.
  - _Component (RTL):_ `LandingZonesPanel` (upload → list, error state);
    `LocalCheckSettings` (values persist to `localStorage`, debounce fires
    `runLocalCheck`); `LocalStatsPanel` (renders result, click-to-seek fires
    store `seek`).
  - _E2E (Playwright):_ "load IGC → wait for elevation → upload .cup → verify
    colored track and non-zero stats → change L/D → verify recomputation
    updates statistics".
- **Fixtures added:** at least one IGC that leaves local (short, hand-crafted
  or trimmed real flight) and one that stays in local throughout; one small
  `.cup` with mixed airfield / outlanding entries carrying difficulty tags
  and one intentionally malformed row.

---

## 11. Concrete dependency list

**Runtime (new):** _none_ — `.cup` parser and elevation client are
hand-rolled to keep the bundle lean.

**Runtime (unchanged from Phase 1):** `react`, `react-dom`, `igc-parser`,
`maplibre-gl`, `uplot`, `zustand`, `react-i18next`, `i18next`.

**Dev (new):** _none_.

**Env additions:**

- `VITE_ELEVATION_API_URL` — default
  `https://api.open-elevation.com/api/v1/lookup`; overridable for
  self-hosted / OpenTopography deployments.

---

## 12. Build order / technical milestones

Ordered so an execution session can pick this up top-down without
back-references:

1. **Domain foundations.** Add `landingZone`, `parseCup`, `elevation`,
   `glide`, `enlDetection`, `flightPhases`, `localCheck`. Extend
   `DerivedPoint`. Full unit-test coverage against new fixtures.
2. **Elevation service.** `services/elevationApi.ts` (batched POST +
   progress reporting). Wire it into `loadFlight` so the grid is fetched
   right after normalization. Handle failure / retry UI.
3. **State store extensions.** Add all Phase 2 slices, actions, and
   preconditions to `useFlightStore.ts`. Persist `localCheckParams` via
   `localStorage`.
4. **Worker.** `localCheck.worker.ts` with the typed `LocalCheckRequest` /
   `LocalCheckResponse`. Wire `runLocalCheck` in the store to post/receive
   messages and cancel in-flight computations.
5. **UI panels.** `LandingZonesPanel`, `LocalCheckSettings`,
   `LocalStatsPanel`, `ColorLegend` — each rendered inside the existing
   `AppSidebar` (or its own sidebar tab if the sidebar gets crowded).
6. **Map integration.** New LZ symbol layer; gradient / segmented track
   fed from `localCheckResult.samples`.
7. **Barogram integration.** Phase/status coloring on the altitude line;
   preserve downsampling and cursor sync.
8. **i18n.** Add all new keys to `en.json`; audit no hardcoded strings.
9. **Test hardening.** Fill out unit / component / e2e; run against
   fixtures; verify NFR-2T-1 through NFR-2T-6 on a real-size flight.

---

## 13. Acceptance criteria / Definition of Done

Phase 2 is done when every PRD Phase-2 functional requirement is met and
demonstrable, and NFRs above are verified on a representative flight.

| PRD requirement                                          | Satisfied by                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| FR-2-1 Import `.cup` LZs (with difficulty tags & dedupe) | §6.1 `LandingZonesPanel` + `parseCup`                            |
| FR-2-2 Terrain elevation & AGL                           | §6.2 `elevationApi` + `sampleElevation`; `DerivedPoint` extension |
| FR-2-3 Configurable parameters                           | §6.6 `LocalCheckSettings`; defaults in `LocalCheckParams`         |
| FR-2-4 Classify + missing height per sampled point       | §6.3 worker algorithm                                            |
| FR-2-5 Color-coded track/baro + statistics               | §6.5 map/baro; §6.6 `LocalStatsPanel`                             |
| FR-2-6 Tow/winch initial climb, motor (ENL), final glide     | §6.4 `flightPhases` + `enlDetection`                          |

Additionally:

- No Phase 1 acceptance criterion regresses (the neutral track color still
  appears when no local-check result is available; upload/replay unaffected).
- No French strings remain hardcoded in the UI.
- `npm run build` produces a static bundle with no runtime errors on the
  Phase 2 fixture pair (an IGC that leaves local + a matching `.cup`).

---

## 14. Open questions

1. **`line-gradient` vs segmented lines.** Both are viable for the
   color-coded track; the final choice is deferred to the map-integration
   milestone (#6) after a small spike on a real fixture.
2. **Elevation API SLA.** Open-Elevation has occasional outages; consider
   whether to add a secondary provider fallback in Phase 2 or leave that as
   a Phase 3 hardening item.
3. **Marginal-band threshold (100 m).** The 100 m threshold for
   `in-local-marginal` (yellow band per PRD §9.3) is copied from VerifLocal
   conventions — confirm on a test flight or expose as a hidden param.

---

_This document is scoped strictly to Phase 2. Phase 3 (escape paths &
reachable zone) and Phase 4 (airspace, wind, reports, batch) will each get
their own technical specification once planned in detail._
