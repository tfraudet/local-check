# Local Check — Phase 3 Technical Specification

|                  |                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Product**      | Local Check                                                                                                                |
| **Document**     | Phase 3 (Escape paths & reachable zone) Technical Specification                                                            |
| **Version**      | 0.1 (Draft)                                                                                                                |
| **Status**       | Draft — for review                                                                                                         |
| **Related docs** | `docs/PRD.md` (Product Requirements Document), `docs/phase-1-technical-spec.md`, `docs/phase-2-technical-spec.md` (previous) |

---

## 1. Purpose & scope

This document turns Phase 3 of the roadmap (`docs/PRD.md` §6, §8.2, FR-3-1 …
FR-3-3) into a concrete, buildable technical design. Phase 3 builds directly
on Phase 2's local-verification stack: it visualises **how the glider would
escape to a safe landing** at any given moment (the escape path), what area
is **reachable in a glide** from that same moment (the reachable zone), and
**at what height the glider would arrive over each visible Landing Zone**.

Phase 3 is **additive** on Phase 2. No Phase 1 or Phase 2 module is
rewritten — new domain modules, a new worker, one new UI panel and three
new map layers slot on top of the existing state/domain/UI stack.

### 1.1 In scope (Phase 3)

- **Escape path (FR-3-1).** For the current replay position, display the
  straight-line escape trajectory to the best reachable LZ, together with a
  compact altitude profile (terrain vs glide plane) beside the barogram.
- **Reachable zone (FR-3-2).** For the current replay position, compute and
  render the set of ground points reachable in a glide, using a grid
  method with user-configurable grid size (90 / 180 / 360 / 720 m) and
  diameter.
- **Arrival heights over LZs (FR-3-3).** For every currently visible LZ,
  display the height at which the glider would arrive over that LZ from the
  current position, as a text label on the map.
- Toggle switches for each new overlay, persisted alongside the existing
  Phase 2 params.

### 1.2 Explicitly out of scope (Phase 3)

Deferred to Phase 4+ or dropped:

- Static "all sampled points" escape-path overlay across the whole flight.
- Terrain-avoiding poly-line escape routing (via col/pass waypoints); Phase 3
  ships straight-line only.
- Click-to-pin an arbitrary source point on the map / barogram; Phase 3 ties
  the source to the current replay position.
- Wind effect on glide (Phase 4).
- Airspace penetration detection (Phase 4).
- Downloadable debrief reports (Phase 4).
- Any backend, database, authentication, or server-side storage (aside from
  the third-party elevation HTTP API already introduced in Phase 2).

---

## 2. Architecture overview

Phase 3 introduces **no new layers**. It extends the existing layered design
with one new worker and a handful of new domain / UI modules.

### 2.1 Layered design

```
┌────────────────────────────────────────────────────────────────────────┐
│  UI Layer                                                              │
│  [Phase 1] MapView | Barogram | ReplayControls | TelemetryPanel |      │
│            FlightSummaryPanel | AppSidebar | ThemeProvider             │
│  [Phase 2] LandingZonesPanel | LocalCheckSettings | LocalStatsPanel |  │
│            ColorLegend                                                 │
│  [Phase 3] EscapePathProfilePanel | ReachableZoneSettings              │
│            (+ MapView layers: escape-path line, reachable-zone fill,   │
│               arrival-height labels)                                   │
└────────────▲───────────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────────┐
│  State Layer (Zustand)                                                 │
│  [Phase 1] flight, currentTimeMs, isPlaying, playbackSpeed,            │
│            altitudeSource                                              │
│  [Phase 2] elevationGrid, landingZones, visibleLandingZoneIds,         │
│            localCheckParams, localCheckResult, isComputingLocalCheck   │
│  [Phase 3] showEscapePath, showReachableZone, showArrivalHeights,      │
│            reachableZoneParams, reachableZoneResult,                   │
│            isComputingReachableZone                                    │
└────────────▲───────────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────────┐
│  Domain Layer (pure TypeScript)                                        │
│  [Phase 1] flight, normalizeIgc, derivedMetrics, summary, units        │
│  [Phase 2] landingZone, parseCup, elevation, glide, localCheck,        │
│            enlDetection, flightPhases, phaseColors                     │
│  [Phase 3] escapePath, reachableZone                                   │
│            (glide.ts extended with `reachableAltitudeAt` helper)       │
└────────────▲───────────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────────┐
│  Services Layer                                                        │
│  [Phase 2] elevationApi (unchanged)                                    │
└────────────▲───────────────────────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────────────────────┐
│  Worker Layer                                                          │
│  [Phase 1] igcParser.worker.ts                                         │
│  [Phase 2] localCheck.worker.ts                                        │
│  [Phase 3] reachableZone.worker.ts                                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data flow — Phase 3 happy path

1. Phase 1 + Phase 2 flow runs to completion: flight loaded, elevation grid
   fetched, `.cup` LZs uploaded, `localCheckResult` computed.
2. User toggles **Show escape path** on. The `MapView` and
   `EscapePathProfilePanel` subscribe to `currentTimeMs` and, on each cursor
   move, look up the nearest `SampledPoint` in `localCheckResult.samples`,
   read its `bestLzId`, and call `escapePath.compute(...)` on the main
   thread (small work — ≤ ~200 terrain samples). The resulting `EscapePath`
   drives the map polyline and the mini altitude-profile chart.
3. User toggles **Show reachable zone** on. The store's
   `runReachableZone()` action is debounced (250 ms) against
   `currentTimeMs` and `reachableZoneParams`, and posts to
   `reachableZone.worker`. The worker computes a regular grid of reachable
   / unreachable cells, plus an outer contour polygon. `MapView` renders
   the polygon as a translucent fill layer.
4. User toggles **Show arrival heights** on. On each cursor move, the main
   thread recomputes per-LZ arrival heights (haversine distance × workingLD,
   no terrain check) and pushes them into the existing LZ symbol layer's
   GeoJSON `properties`. A companion `symbol` text layer renders them as
   coloured labels next to each LZ icon.
5. Any change to `localCheckParams.workingLD` / `arrivalHeightM` /
   `groundClearanceM` re-runs Phase 2's `runLocalCheck` (existing behaviour)
   and — if the reachable zone is visible — also re-runs
   `runReachableZone` because it consumes the same glide parameters.
6. Changing `reachableZoneParams.gridSizeM` or `.diameterKm` re-invokes only
   `runReachableZone` (Phase 2 result is untouched).

### 2.3 Non-happy paths

- **No `localCheckResult` yet** (e.g., no LZ uploaded): the Phase 3
  overlays are disabled; the panel shows a hint pointing at
  `LandingZonesPanel`.
- **`bestLzId` is `null` at the current sample** (out-of-local): the escape
  path renders in **red**, points at the LZ with the smallest missing
  height (fallback), and the profile clearly shows the glide plane dipping
  under terrain / arrival threshold.
- **Reachable-zone cell count exceeds 100 k** (see §7): the worker
  down-grades resolution (bumps `gridSizeM` to the next step) and surfaces
  a hint in `ReachableZoneSettings`; the toggle stays on.
- **Elevation grid unavailable / stale**: Phase 3 overlays are disabled and
  the settings panel echoes Phase 2's "terrain data unavailable" state.

---

## 3. Technology stack additions

| Concern                        | Choice                                                                                                            | Rationale                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escape-path polyline           | MapLibre `line` layer sourced from a small in-memory GeoJSON, restyled per status                                 | Same pattern as the Phase 1 track layer; no new dependency.                                                                                        |
| Reachable-zone rendering       | MapLibre `fill` layer sourced from a marching-squares GeoJSON polygon; fallback: raster image source              | Vector polygon keeps the same styling language as the rest of the map; raster fallback (see §11) is a spike item if marching squares is too slow. |
| Altitude-profile mini-chart    | Reused `uplot` — a new small `uPlot` instance sitting to the **left** of the barogram, at a **30/70 width ratio** | Reuses the charting library already in the bundle; the two charts stay visually consistent.                                                        |
| Arrival-height labels          | MapLibre `symbol` (text) layer bound to the LZ symbol source                                                      | Reuses the Phase 2 LZ source; a single properties-refresh drives the labels.                                                                       |
| Marching squares contour       | Hand-rolled 2-D marching squares in `domain/reachableZone.ts`                                                     | Tiny algorithm, no dep; keeps the worker self-contained.                                                                                           |

No changes to React / Vite / Tailwind / shadcn-ui / MapLibre / uPlot /
Zustand / react-i18next.

---

## 4. Project structure additions

```
local-check/
├── docs/
│   ├── PRD.md
│   ├── phase-1-technical-spec.md
│   ├── phase-2-technical-spec.md
│   └── phase-3-technical-spec.md                # this document
├── src/
│   ├── components/
│   │   ├── EscapePathProfilePanel.tsx           # [new]  altitude profile mini-chart
│   │   ├── ReachableZoneSettings.tsx            # [new]  toggle + grid-size + diameter controls
│   │   ├── MapView.tsx                          # [mod]  escape-path line, reachable-zone fill, LZ arrival-height labels
│   │   ├── Barogram.tsx                         # [mod]  becomes the 70% right pane of a 30/70 layout
│   │   └── AppSidebar.tsx                       # [mod]  hosts ReachableZoneSettings + toggles
│   ├── domain/
│   │   ├── escapePath.ts                        # [new]  compute EscapePath from a fix + best LZ
│   │   ├── reachableZone.ts                     # [new]  grid computation + marching-squares contour
│   │   └── glide.ts                             # [mod]  add reachableAltitudeAt(...) helper
│   ├── workers/
│   │   ├── igcParser.worker.ts                  # [phase 1]
│   │   ├── localCheck.worker.ts                 # [phase 2]
│   │   └── reachableZone.worker.ts              # [new]  runs reachableZone.compute() off-thread
│   ├── state/
│   │   └── useFlightStore.ts                    # [mod]  add Phase 3 slice + actions + persistence
│   └── i18n/locales/en.json                     # [mod]  new keys for escapePath / reachableZone / arrivalHeights
├── fixtures/
│   └── sample-flights/                          # [mod]  optional: a short IGC useful for RZ e2e tests
└── tests/
    └── unit/
        ├── escapePath.spec.ts                   # [new]
        └── reachableZone.spec.ts                # [new]
```

---

## 5. Domain data model

The domain layer stays framework-agnostic — no imports from React /
MapLibre / uPlot.

```ts
// src/domain/escapePath.ts

export type EscapePathStatus = 'in-local' | 'in-local-marginal' | 'out-of-local';

export interface EscapePathWaypoint {
  lat: number;
  lon: number;
  distFromSourceM: number;
}

export interface EscapePathProfilePoint {
  distFromSourceM: number;
  terrainM: number;
  glideAltM: number;
}

export interface EscapePath {
  sourceFixIndex: number;                // fix that anchors the source
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  lzId: string;                          // target LZ = highest arrival height above ground at the current fix
  waypoints: EscapePathWaypoint[];       // straight line: [source, LZ] in Phase 3
  profile: EscapePathProfilePoint[];     // sampled every ~100 m along the line
  arrivalHeightM: number;                // sourceAlt − lzElev − dist / L/D  (height above LZ ground)
  minMarginM: number;                    // min(glideAlt − terrainM) along the line — informational, not used for status
  status: EscapePathStatus;              // derived from `arrivalHeightM` only (see §6.1)
}

export interface EscapePathInputs {
  sourceFixIndex: number;
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  lz: LandingZone;
  grid: ElevationGrid;
  params: LocalCheckParams;
  sampleStepM?: number;                  // default 100 m
}

export function computeEscapePath(inputs: EscapePathInputs): EscapePath;
```

```ts
// src/domain/reachableZone.ts

export type ReachableZoneGridSizeM = 90 | 180 | 360 | 720;

export interface ReachableZoneParams {
  gridSizeM: ReachableZoneGridSizeM;     // default 360
  diameterKm: number;                    // circular sampling diameter around source; default 40, max 60
}

export interface ReachableZoneResult {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  params: ReachableZoneParams;           // effective (may differ from requested — see §7)
  requestedParams: ReachableZoneParams;  // what the user asked for
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  cols: number;
  rows: number;
  reachableMask: Uint8Array;             // 1 = reachable, 0 = not, length = cols*rows
  marginM: Float32Array;                 // margin above (glide − terrain − clearance)
  outerPolygon: Array<[number, number]>; // marching-squares contour (lon, lat)
  degraded: boolean;                     // true if we downgraded the grid size / diameter
  computedAt: number;                    // ms since epoch
}

export interface ReachableZoneInputs {
  sourceLat: number;
  sourceLon: number;
  sourceAltM: number;
  grid: ElevationGrid;
  landingZones: LandingZone[];           // used only for the terrain-check optimisation
  params: LocalCheckParams;              // workingLD, arrivalHeightM, groundClearanceM
  zoneParams: ReachableZoneParams;
}

export function computeReachableZone(
  inputs: ReachableZoneInputs,
): ReachableZoneResult;
```

```ts
// src/domain/glide.ts — extension (Phase 3)

/**
 * Convenience wrapper around the existing glide-plane math.
 * Returns the altitude at which the glide plane arrives at (toLat, toLon)
 * from (fromLat, fromLon, fromAltM) at the given L/D, ignoring terrain.
 */
export function reachableAltitudeAt(
  fromLat: number,
  fromLon: number,
  fromAltM: number,
  toLat: number,
  toLon: number,
  workingLD: number,
): number;
```

No changes to Phase 2's `LocalCheckResult` / `SampledPoint` shape.

---

## 6. Component / module technical requirements

### 6.1 Escape path (`domain/escapePath.ts`, `MapView`, `EscapePathProfilePanel`)

**Maps to:** FR-3-1

- **Source selection.** For the current `currentTimeMs`, the caller finds
  the nearest `SampledPoint` in `localCheckResult.samples` (binary search
  on the sorted `timeMs` array). If `bestLzId` is set, that's the target;
  otherwise (out-of-local), the caller falls back to the LZ with the
  smallest `missingHeightM` and marks the path as `out-of-local`.
- **Target LZ.** At each cursor position, pick the LZ with the
  **highest arrival height above its own ground** (the same rule used by
  the arrival-height labels and by `localCheck.classifyFix` for the
  barogram). Terrain-collision is not part of the target selection.
- **Algorithm (`computeEscapePath`).**
  1. Sample the straight line from source → LZ every `sampleStepM` metres
     (default 100 m). Linear interpolation in lat/lon is adequate at the
     distances involved.
  2. For each sample, `terrainM = sampleElevation(grid, lat, lon)`
     (Phase 2). `NaN` propagates as `null` in the profile.
  3. `glideAltM = sourceAltM − (distFromSourceM / workingLD)`.
  4. `arrivalHeightM = sourceAltM − lzElevM − distanceLZ / workingLD`
     (height above LZ ground).
  5. `minMarginM = min(glideAltM − terrainM)` along the source→LZ segment
     — informational only, not part of the status.
  6. **Status (shared rule):**
     - `arrivalHeightM > arrivalHeightM param` → `in-local` (green)
     - `0 < arrivalHeightM ≤ arrivalHeightM param` → `in-local-marginal`
       (yellow)
     - `arrivalHeightM ≤ 0` → `out-of-local` (red)
- **Rendering (`MapView.tsx`).**
  - A new `LineString` GeoJSON source `escape-path-src` holds the
    2-vertex line (source → LZ). Two `line` layers are stacked: a wide
    translucent halo (2 px, 30 % opacity) and a solid dashed stroke (2 px,
    dash pattern `[2, 1.5]`). Colour picked from `phaseColors.ts`: green
    (in-local), yellow (marginal), red (out-of-local).
  - Layer is added below the current-position marker and above the
    track / LZ symbols.
- **Rendering (`EscapePathProfilePanel.tsx`).**
  - A compact `uPlot` chart placed **to the right of the barogram** in a
    horizontal `flex` container. Width ratio **barogram : escape-path
    profile = 70 : 30**. The escape-path panel also hosts the current
    telemetry row above the barogram so both panes share a top border,
    and its outer wrapper adds a top border for the right pane
    (`border-l border-t`) so the two edges align pixel-perfectly.
  - X axis: distance from source in km. Y axis: altitude m.
  - Two series: `terrainM` (filled area, ground colour) and
    `glideAltM` (solid stroke, coloured per status).
  - A horizontal dashed line at `lzElev + arrivalHeightM` (target arrival
    altitude); a vertical dashed line at `distLZ` (LZ position). Legend
    inline.
  - The chart is `useMemo`-ed on `(sampleIndex, params, grid)`; recomputes
    on cursor move without a worker.
  - Empty state: "Toggle **Show escape path** to visualise the escape
    trajectory at the current replay position."

### 6.2 Reachable zone (`domain/reachableZone.ts`, `workers/reachableZone.worker.ts`, `ReachableZoneSettings`)

**Maps to:** FR-3-2

- **Grid construction.**
  - Centre the grid on the source lat/lon; the disc has diameter =
    `diameterKm` (radius `diameterKm / 2`).
  - `gridSizeM` values allowed: `90 | 180 | 360 | 720`. Default `360`.
  - Bounding square: `cols = rows = ceil((diameterKm * 1000) / gridSizeM) + 1`.
    Cells whose distance to the source exceeds the radius are skipped
    (circular footprint inscribed in the square).
  - Enforce the **cell cap of 100 000**: while `cols * rows > 100_000`,
    bump `gridSizeM` to the next step (720 max); if still exceeded, shrink
    `diameterKm` in 5 km decrements. Set `degraded = true` when this happens.
- **Per-cell computation.** For each grid cell at `(lat, lon)`:
  1. `distM = haversine(source, cell)`.
  2. `glideAltAtCellM = sourceAltM − distM / workingLD`.
  3. `terrainM = sampleElevation(grid, lat, lon)`.
     If `NaN`, mark cell unreachable.
  4. `marginM = glideAltAtCellM − terrainM`.
  5. Cell is reachable iff `marginM ≥ arrivalHeightM` **and** the straight line from
     source to cell doesn't clip terrain (sparse ~10-sample check with
     zero clearance buffer).
- **Rendering primitives.** Emit one rectangular polygon ring per
  reachable cell (a `MultiPolygon` of cell-sized quads). Simpler than
  marching squares, handles holes trivially, and MapLibre's fill layer
  blends adjacent quads visually. `fill-antialias: false` avoids seams
  between quads at the edges.
- **Worker contract.**
  ```ts
  // posted to worker
  type ReachableZoneRequest = {
    requestId: number;
    inputs: ReachableZoneInputs;
  };
  // posted back
  type ReachableZoneResponse =
    | { requestId: number; kind: 'ok'; result: ReachableZoneResult }
    | { requestId: number; kind: 'error'; message: string };
  ```
  Successive calls carry monotonically increasing `requestId`s; the store
  discards responses whose id is not the latest, matching Phase 2's
  `localCheck.worker` pattern.
- **Rendering (`MapView.tsx`).**
  - New GeoJSON source `reachable-zone-src` from `outerPolygon`.
  - A `fill` layer, colour green with 20 % opacity; a `line` layer for the
    outline (1 px, 60 % opacity). Layer stacks below the LZ symbols and
    the track.
  - When `degraded === true`, a small toast / hint appears in
    `ReachableZoneSettings` explaining the effective grid size.
- **Settings (`ReachableZoneSettings.tsx`).**
  - Toggle **Show reachable zone**.
  - Radio group for grid size: `90 / 180 / 360 / 720 m`.
  - Slider for diameter: 10 – 60 km (step 10 km), default 40 km.
  - Values persist in `localStorage` under the existing
    `local-check.params.v1` key.
  - Any change debounces (250 ms) into `runReachableZone`.

### 6.3 Arrival heights over LZs (`MapView.tsx`)

**Maps to:** FR-3-3

- **Trigger.** When `showArrivalHeights` is on and the flight has fixes,
  a small utility recomputes per-LZ arrival heights on `currentTimeMs`
  change: `arrivalHeightM = currentAltM − lzElevM − haversine(currentPos,
  lz) / workingLD`. This drives both the on-map pill label and — via
  `classifyFix` in Phase 2 — the barogram track colour, so the two
  surfaces are always in agreement (same rule, same threshold).
- **Rendering.** Each visible LZ carries a signed pill label rendered
  through an SDF rounded-rectangle icon so a single image serves all
  three status colours (`icon-color` recoloured at paint time via a
  `match` on the `status` feature property). Label glyphs are white on
  the coloured pill; text reads `+340 m` / `−120 m` (sign always shown,
  m suffix). Colour: green when `arrivalHeightM > arrivalHeightM param`,
  yellow when `> 0`, red otherwise — same three bands as the barogram
  track and the escape-path polyline.
- **Toggle** lives in the sidebar next to the escape-path and
  reachable-zone toggles.

### 6.4 Barogram layout change (`Barogram.tsx`, `AppSidebar.tsx` / bottom-bar host)

**Maps to:** FR-3-1 layout requirement

- The barogram's outer container becomes a horizontal `flex` row with two
  children:
  - **Left**: `EscapePathProfilePanel` at `flex: 3` (~30 %).
  - **Right**: the current barogram at `flex: 7` (~70 %).
- Both children respect the row's height; their internal `uPlot` instances
  are `useResizeObserver`-driven so they redraw on flex changes.
- When `showEscapePath` is off, the left pane collapses (`flex: 0`) and the
  barogram takes 100 %, keeping the Phase 2 layout intact.
- On narrow (mobile) breakpoints the two panes stack vertically; the
  ratio only applies at `md` and up.

### 6.5 State store additions (`state/useFlightStore.ts`)

```ts
interface FlightStoreState {
  // Phase 1 + Phase 2 fields unchanged.

  // Phase 3 additions.
  showEscapePath: boolean;                    // default false
  showReachableZone: boolean;                 // default false
  showArrivalHeights: boolean;                // default false
  reachableZoneParams: ReachableZoneParams;   // default { gridSizeM: 360, diameterKm: 40 }
  reachableZoneResult: ReachableZoneResult | null;
  isComputingReachableZone: boolean;

  // Phase 3 actions.
  setShowEscapePath: (visible: boolean) => void;
  setShowReachableZone: (visible: boolean) => void;
  setShowArrivalHeights: (visible: boolean) => void;
  setReachableZoneParams: (patch: Partial<ReachableZoneParams>) => void;
  runReachableZone: () => Promise<void>;
}
```

- Preconditions for `runReachableZone`: `flight`, `elevationGrid`, and a
  valid current fix. The action bumps `isComputingReachableZone`, posts to
  the worker with a fresh `requestId`, and stores the response on match.
- Debounce (250 ms) sits on the caller side (a subscription that watches
  `currentTimeMs` + `showReachableZone` + `reachableZoneParams` +
  `localCheckParams`). Toggling `showReachableZone` off cancels any
  in-flight request.
- Persistence: extend the existing `local-check.params.v1` storage bucket
  with `showEscapePath`, `showReachableZone`, `showArrivalHeights`,
  `reachableZoneParams`.

### 6.6 Internationalization

**Maps to:** existing FR-M-22

New i18n key groups added to `src/i18n/locales/en.json`:

- `escapePath.*` — panel title, toggle label, empty state, axis labels,
  legend labels (terrain, glide plane, arrival target), status pills.
- `reachableZone.*` — panel title, toggle, grid-size radio labels
  (90 / 180 / 360 / 720 m), diameter slider, degraded hint.
- `arrivalHeights.*` — toggle, label format (`{sign}{value} m`).
- `errors.reachableZone.*` — cell-cap hint, worker failure, no-terrain
  fallback.

---

## 7. Units & formatting

- All new displayed values pass through `src/domain/units.ts`:
  arrival height uses `formatHeight` with an explicit sign; distances in
  the profile chart use `formatDistanceKm`.
- Metric-only for Phase 3, consistent with Phase 1/2.

---

## 8. Non-functional & performance requirements

| ID       | Requirement                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-3T-1 | Escape-path recompute on `currentTimeMs` change completes in ≤ 15 ms on a mid-range laptop (100 m sampling along a ≤ 20 km line).              |
| NFR-3T-2 | Reachable-zone worker computes a typical case (diameter 40 km, grid 360 m ≈ 12 500 cells) in ≤ 500 ms; hard cap 100 k cells enforced.          |
| NFR-3T-3 | Recompute during scrubbing is debounced 250 ms; only the latest response is applied. In-flight requests are cancelled on new posts.            |
| NFR-3T-4 | Replay marker and barogram cursor never stutter (≥ 30 fps) while the reachable-zone worker is running.                                         |
| NFR-3T-5 | Phase 1/2 replay is unaffected when Phase 3 overlays are off. The escape-path mini-chart collapses to zero width.                              |
| NFR-3T-6 | All new domain modules (`escapePath`, `reachableZone`) are unit-tested against synthetic elevation grids and hand-crafted LZ sets.             |
| NFR-3T-7 | Client-side-only guarantee unchanged. No new outbound calls are introduced.                                                                    |

---

## 9. Accessibility & UX

- Toggle switches are keyboard-operable and expose ARIA labels.
- The escape-path polyline pairs colour with an on-map status pill
  ("In local", "Marginal", "Out of local") anchored to the target LZ so
  colour is never the sole status carrier.
- The arrival-height labels always include the sign and unit (`+340 m` /
  `−120 m`), independent of colour.
- The reachable-zone hint (when degraded) is text, not just an icon.
- `EscapePathProfilePanel` axis ticks and legend text respect the same
  contrast palette as the barogram.

---

## 10. Tooling & quality

- **Scripts unchanged.** `dev`, `build`, `preview`, `lint`, `format`,
  `test`, `test:e2e` continue to work.
- **Testing pyramid additions:**
  - _Unit (Vitest):_
    - `escapePath.compute` — happy path (in-local), marginal, out-of-local
      fallback; profile sampling at endpoints; NaN-terrain propagation.
    - `reachableZone.compute` — synthetic flat grid produces a circular
      contour of the expected radius; grid degradation kicks in above the
      cell cap; marching-squares connectivity on a hand-crafted grid.
    - `glide.reachableAltitudeAt` — direct math cases.
  - _Component (RTL):_
    - `EscapePathProfilePanel` — renders on cursor change, empty state,
      status pill.
    - `ReachableZoneSettings` — persistence in `localStorage`, debounce
      fires `runReachableZone`, degradation hint.
  - _E2E (Playwright):_
    - Load flight → wait for local check → toggle **Show reachable zone**
      → assert the fill polygon appears → step replay cursor forward →
      assert polygon geometry changes.
    - Toggle **Show escape path** → assert both the polyline and the
      profile chart render → change L/D via settings → assert the profile
      slope changes.
    - Toggle **Show arrival heights** → assert text labels next to LZ
      icons carry a signed metre value.
- **Fixtures:** the Phase 2 fixture pair is sufficient; add one screenshot
  fixture for the profile panel's visual regression if a snapshot suite
  exists.

---

## 11. Concrete dependency list

**Runtime (new):** _none_ — marching squares and the escape-path
computation are hand-rolled to keep the bundle lean.

**Runtime (unchanged from Phase 2):** `react`, `react-dom`, `igc-parser`,
`maplibre-gl`, `uplot`, `zustand`, `react-i18next`, `i18next`.

**Dev (new):** _none_.

**Env additions:** _none_ (`VITE_OPENTOPOGRAPHY_API_KEY` from Phase 2
covers all elevation needs).

---

## 12. Build order / technical milestones

Ordered so a session can pick this up top-down:

1. **Domain foundations.** Add `escapePath.ts`, `reachableZone.ts`; extend
   `glide.ts` with `reachableAltitudeAt`. Add `geo.slerp` if missing. Full
   unit-test coverage against synthetic grids.
2. **Worker.** `reachableZone.worker.ts` with the typed request/response
   contract. Wire in a unit test that runs the worker in a mocked context.
3. **State store extensions.** Add all Phase 3 slices, actions,
   preconditions, and persistence. Wire the cursor-change subscription
   with a 250 ms debounce.
4. **Escape-path map layer + profile panel.** New `line` layer on the map;
   new `EscapePathProfilePanel` with the 30 % `uPlot` chart. Adjust the
   barogram's outer container to the 30/70 flex row.
5. **Reachable-zone map layer + settings panel.** New `fill` + outline
   layers; `ReachableZoneSettings` component; degradation hint.
6. **Arrival-height labels.** Extend the LZ symbol source properties and
   add the `symbol` text layer. Add the toggle.
7. **i18n.** All new keys in `en.json`; audit for hardcoded strings.
8. **Test hardening.** Fill out unit / component / e2e; run against
   fixtures; verify NFR-3T-1 through NFR-3T-6 on a real-size flight.

---

## 13. Acceptance criteria / Definition of Done

Phase 3 is done when every PRD Phase-3 functional requirement is met and
demonstrable, and NFRs above are verified on a representative flight.

| PRD requirement                                          | Satisfied by                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| FR-3-1 Escape path with altitude profile                 | §6.1 `escapePath` + `MapView` line layer + `EscapePathProfilePanel` (30/70)  |
| FR-3-2 Reachable zone with adjustable grid size          | §6.2 `reachableZone` + `reachableZone.worker` + `ReachableZoneSettings`      |
| FR-3-3 Arrival heights over LZs                          | §6.3 `MapView` symbol text layer + throttled recompute                       |

Additionally:

- No Phase 1 or Phase 2 acceptance criterion regresses. With all Phase 3
  toggles off, the UI is byte-for-byte the Phase 2 layout (mini-chart pane
  collapsed).
- No hardcoded strings remain in the new components.
- `npm run build` produces a static bundle with no runtime errors on the
  Phase 2 fixture pair.

---

## 14. Open questions

1. **Marching-squares vs raster overlay.** For very large reachable zones
   (diameter ≥ 50 km at 90 m), a raster image source may render faster than a
   very-many-vertex polygon. Spike a comparison on the reference flight
   before locking in the vector approach.
2. **Elevation-grid transfer to worker.** The Phase 2
   `ElevationGrid.data` is a `Float32Array` — cheap to `Transferable`.
   Confirm the store keeps a copy after the transfer (or use
   `SharedArrayBuffer` if COOP/COEP headers are already set for the
   deployment target).
3. **Profile chart y-axis normalisation.** Fix the y-range to the
   flight's overall min/max altitude for the whole session, or auto-fit to
   each escape path? Auto-fit is more legible per path; global is easier
   to compare across the flight — user testing on a real debrief may
   settle this.
4. **Escape-path fallback when out-of-local.** Falling back to the LZ with
   the smallest `missingHeightM` is intuitive, but VerifLocal's exact
   fallback rule when everything is unreachable is worth cross-checking
   with `spike/VerifLocal_FR.pdf` before shipping.

---

_This document is scoped strictly to Phase 3. Phase 4 (airspace, wind,
reports, batch processing, terrain-avoiding poly-line escape routes) will
get its own technical specification once planned in detail._
