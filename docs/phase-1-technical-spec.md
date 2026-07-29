# Local Check — Phase 1 Technical Specification

|                  |                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Product**      | Local Check                                                                           |
| **Document**     | Phase 1 (MVP) Technical Specification                                                 |
| **Version**      | 1.0                                                                                   |
| **Status**       | **Implemented** — Phase 1 shipped                                                     |
| **Related docs** | `docs/PRD.md` (Product Requirements Document); `docs/phase-2-technical-spec.md` (next) |

---

## 1. Purpose & scope

This document turns the Phase 1 (MVP) scope defined in `docs/PRD.md` into a
concrete, buildable technical design: **upload a single IGC file and replay the
flight** — synchronized map + barogram + playback controls + per-point
telemetry + flight summary.

### 1.1 In scope (Phase 1)

- Client-side IGC parsing (upload + drag-and-drop).
- 2D map track rendering with a replay marker.
- Barogram (altitude vs time) synchronized with the map.
- Replay engine: play/pause/speed/scrub/step.
- Live telemetry readout and flight summary panel.
- i18n scaffolding (English first).

### 1.2 Explicitly out of scope (Phase 1)

- Terrain elevation / AGL computation.
- Landing Zone (LZ) database / `.cup` import.
- "In local" / "out of local" computation, escape paths, reachable zone.
- Airspace detection, wind modeling, reports/export, batch processing.
- Any backend, database, authentication, or server-side storage.
- Deployment/hosting/CI pipeline (deferred — see §14 Open questions). The
  deliverable of Phase 1 is a static, framework-built web app; where and how it
  is hosted is not decided in this document.

---

## 2. Architecture overview

Local Check Phase 1 is a **100% client-side single-page application (SPA)**.
No backend, no network calls are required for the core flow (aside from
fetching base-map tiles).

### 2.1 Layered design

```
┌─────────────────────────────────────────────────────────┐
│  UI Layer (React components)                             │
│  MapView | Barogram | ReplayControls | TelemetryPanel |  │
│  FlightSummaryPanel | UploadZone | AppShell               │
└───────────────▲───────────────────────────────────────────┘
                │ reads / dispatches actions
┌───────────────┴───────────────────────────────────────────┐
│  State Layer (Zustand store)                              │
│  flight: NormalizedFlight | null                          │
│  currentTimeMs, isPlaying, playbackSpeed                   │
│  actions: loadFlight, play, pause, seek, setSpeed, reset   │
└───────────────▲───────────────────────────────────────────┘
                │ produces
┌───────────────┴───────────────────────────────────────────┐
│  Domain Layer (pure TypeScript, framework-agnostic)        │
│  Flight model, derived metrics (speed/vario/distance),     │
│  summary computation, unit formatting                      │
└───────────────▲───────────────────────────────────────────┘
                │ consumes
┌───────────────┴───────────────────────────────────────────┐
│  Ingestion Layer (Web Worker)                              │
│  igc-parser → raw IGC → normalize → NormalizedFlight        │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Single source of truth for replay time

`currentTimeMs` in the Zustand store is the **single source of truth** for "where
we are" in the flight. Both the map marker and the barogram cursor are pure
functions of this value:

- The replay engine (requestAnimationFrame loop) advances `currentTimeMs` when
  playing.
- Dragging the scrubber, clicking/hovering the track, or clicking/hovering the
  barogram all call the same `seek(timeMs)` action.
- `MapView` and `Barogram` both subscribe to `currentTimeMs` and re-render their
  respective cursor/marker — never to each other directly. This guarantees
  bi-directional sync (FR-M-10, FR-M-12, FR-M-13) without ad-hoc component-to-
  component wiring.

### 2.3 Data flow (happy path)

1. User drops/selects a `.igc` file → `UploadZone` reads it as text/ArrayBuffer.
2. File content is posted to a **Web Worker** running `igc-parser`.
3. Worker returns parsed IGC data or a structured error.
4. Main thread normalizes the parser output into `NormalizedFlight` (domain
   layer) and computes derived metrics + summary.
5. Store's `loadFlight(flight)` action sets state; UI transitions from empty
   state to loaded state.
6. `MapView` fits bounds to the track and renders it; `Barogram` renders the
   altitude series; `ReplayControls` become active.

---

## 3. Technology stack & rationale

| Concern                  | Choice                             | Rationale                                                                                                                                                           |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI framework             | **React 18 + TypeScript**          | Largest ecosystem for map/chart integrations; team familiarity assumed; strong typing for the domain model.                                                         |
| Build tool               | **Vite**                           | Fast dev server/HMR, simple static build output, first-class TS/React support.                                                                                      |
| Styling                  | **Tailwind CSS**                   | Utility-first, fast iteration, pairs naturally with shadcn/ui.                                                                                                      |
| UI components            | **shadcn/ui**                      | Accessible, unstyled-by-default primitives (buttons, sliders, dialogs) composed with Tailwind; no heavy runtime dependency.                                         |
| Map rendering            | **MapLibre GL JS**                 | WebGL rendering handles large tracks smoothly; open-source (no vendor lock-in); vector-tile ready for future terrain/LZ layers (Phase 2–3).                         |
| Barogram chart           | **uPlot**                          | Canvas-based, built for large time-series with minimal overhead — necessary for multi-hour flights (tens of thousands of points) with a smooth synchronized cursor. |
| IGC parsing              | **`igc-parser`** (npm)             | Mature, widely used TypeScript-friendly IGC parser; wrapped by our own normalization layer so the rest of the app never depends on its raw shape directly.          |
| State management         | **Zustand**                        | Minimal boilerplate, plain functions for actions, works well with a single flat "replay clock" store; avoids Redux ceremony for this scope.                         |
| i18n                     | **react-i18next**                  | De facto standard for React; supports lazy-loaded locale bundles for future French translation.                                                                     |
| Package manager          | **npm**                            | Default, zero extra tooling.                                                                                                                                        |
| Linting/formatting       | **ESLint + Prettier**              | Standard, low-friction code quality baseline.                                                                                                                       |
| Testing (unit/component) | **Vitest + React Testing Library** | Vitest integrates natively with Vite; RTL for component behavior.                                                                                                   |
| Testing (e2e)            | **Playwright** _(proposed)_        | Real-browser replay/map interaction flows — still open for confirmation, see §14.                                                                                   |
| Base map style           | **OpenFreeMap**                    | Free, no API key required, open-data (OpenMapTiles/OSM-based) vector styles suitable for a keyless default.                                                         |

> Items marked _(proposed)_ are defaults suggested for this spec and still open
> to change — see §14 Open questions. All other rows above are confirmed.

---

## 4. Project structure

```
local-check/
├── docs/
│   ├── PRD.md
│   └── phase-1-technical-spec.md
├── public/
│   └── ... (favicon, static assets)
├── src/
│   ├── app/
│   │   ├── App.tsx                 # AppShell composition root
│   │   └── routes/ (future; single view for Phase 1)
│   ├── components/
│   │   ├── ui/                     # shadcn/ui generated primitives
│   │   ├── UploadZone.tsx
│   │   ├── MapView.tsx
│   │   ├── Barogram.tsx
│   │   ├── ReplayControls.tsx
│   │   ├── TelemetryPanel.tsx
│   │   ├── FlightSummaryPanel.tsx
│   │   ├── LegendAndDisclaimer.tsx
│   │   └── EmptyState.tsx
│   ├── domain/
│   │   ├── flight.ts                # NormalizedFlight, Fix types
│   │   ├── normalizeIgc.ts          # igc-parser output -> NormalizedFlight
│   │   ├── derivedMetrics.ts        # speed, vario, distance calculations
│   │   ├── summary.ts               # flight summary computation
│   │   └── units.ts                 # metric formatting helpers
│   ├── workers/
│   │   └── igcParser.worker.ts      # runs igc-parser off the main thread
│   ├── state/
│   │   └── useFlightStore.ts        # Zustand store (flight, replay clock)
│   ├── replay/
│   │   └── replayEngine.ts          # requestAnimationFrame-based clock
│   ├── i18n/
│   │   ├── index.ts
│   │   └── locales/en.json
│   ├── lib/
│   │   └── (small shared utilities, e.g. geo distance/haversine)
│   ├── main.tsx
│   └── index.css                    # Tailwind entrypoint
├── tests/
│   ├── unit/                        # Vitest specs mirroring src/ structure
│   └── e2e/                         # Playwright specs
├── fixtures/
│   └── sample-flights/*.igc         # sample IGC files for dev/tests
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .eslintrc.cjs / .prettierrc
```

---

## 5. Domain data model & TypeScript types

The domain layer is **framework-agnostic** (no React/MapLibre/uPlot imports) so
it can be unit-tested in isolation and reused if the UI layer changes later.

```ts
// domain/flight.ts

export interface Fix {
  /** Milliseconds since Unix epoch, UTC. */
  timeMs: number;
  latitude: number; // decimal degrees
  longitude: number; // decimal degrees
  pressureAltitudeM: number | null; // meters, null if not recorded
  gnssAltitudeM: number | null; // meters, null if not recorded
}

export interface FlightHeader {
  date: string | null; // ISO date (from IGC header), null if absent
  pilotName: string | null;
  gliderType: string | null;
  gliderRegistration: string | null;
  competitionId: string | null;
  recorderInfo: string | null; // manufacturer/model, best-effort
}

/** Per-fix derived values, aligned 1:1 with `fixes`. */
export interface DerivedPoint {
  groundSpeedKmh: number | null; // null for the first fix (no prior point)
  verticalSpeedMs: number | null; // vario, null for the first fix
  cumulativeDistanceKm: number;
}

export interface FlightSummary {
  date: string | null;
  pilotName: string | null;
  gliderType: string | null;
  takeoffTimeMs: number | null;
  landingTimeMs: number | null;
  durationMs: number;
  maxAltitudeM: number;
  minAltitudeM: number;
  maxGroundSpeedKmh: number;
  totalDistanceKm: number;
  fixCount: number;
}

export interface NormalizedFlight {
  header: FlightHeader;
  fixes: Fix[]; // sorted ascending by timeMs, deduplicated
  derived: DerivedPoint[]; // same length/order as `fixes`
  summary: FlightSummary;
  /** Altitude source the UI should default to when both are available. */
  preferredAltitudeSource: 'pressure' | 'gnss';
}

export type IgcParseError =
  | { kind: 'invalid-format'; message: string }
  | { kind: 'empty-file'; message: string }
  | { kind: 'unknown'; message: string };
```

### 5.1 Mapping from `igc-parser` output

`igc-parser`'s `IGCFile` result (fixes with `timestamp`, `latitude`,
`longitude`, `pressureAltitude`, `gpsAltitude`, plus an `aRecords`/`hRecords`
header set) is transformed by `normalizeIgc.ts` into `NormalizedFlight`:

- **Time.** `igc-parser` already resolves UTC timestamps and handles midnight
  rollover; we defensively re-sort by `timeMs` and drop non-monotonic
  duplicates (FR-M-5).
- **Altitude.** Keep both `pressureAltitudeM` and `gnssAltitudeM` per fix as
  `null` when absent; `preferredAltitudeSource` defaults to `'pressure'`
  (confirmed choice — pressure altitude is generally smoother and less
  susceptible to GNSS multipath/noise), falling back to `'gnss'` only if the
  pressure series is entirely absent from the file.
- **Headers.** Best-effort extraction (pilot, glider type/registration,
  competition ID, date); any missing header maps to `null` and the UI simply
  omits that field (FR-M-4).
- **Errors.** Parser exceptions or an empty/near-empty fix list are caught and
  mapped to `IgcParseError` variants with user-facing messages (FR-M-5).

---

## 6. Component / module technical requirements

### 6.1 IGC ingestion (`UploadZone`, `workers/igcParser.worker.ts`, `domain/normalizeIgc.ts`)

**Maps to:** FR-M-1, FR-M-2, FR-M-3, FR-M-4, FR-M-5, FR-M-6

- `UploadZone` accepts a file via `<input type="file" accept=".igc">` and via
  native HTML5 drag-and-drop; both paths call the same `loadFile(file: File)`
  handler.
- The file is read with `File.text()` and posted to a dedicated **Web Worker**
  (`igcParser.worker.ts`) so parsing never blocks the main/UI thread (NFR
  performance, FR-M-6).
- The worker runs `igc-parser` and returns either the parsed result or a typed
  error via `postMessage`.
- The main thread calls `normalizeIgc(parsed)` to build a `NormalizedFlight`,
  then dispatches `loadFlight(flight)` to the store.
- **Validation:** non-`.igc` extension or parser failure → toast/inline error
  with a clear message (e.g., "This file doesn't look like a valid IGC flight
  log."); the app remains on/returns to the empty state (FR-M-5, FR-M-21).
- **Performance target:** parse + normalize a flight with ~20,000–50,000 fixes
  in under ~2 seconds on a mid-range laptop (FR-M-6, aligned with PRD NFR-2).

### 6.2 Flight model & derived metrics (`domain/derivedMetrics.ts`, `domain/summary.ts`)

**Maps to:** FR-M-18, FR-M-19

- **Ground speed** between consecutive fixes: haversine distance / elapsed
  time, converted to km/h.
- **Vertical speed (vario)**: altitude delta / elapsed time (seconds),
  computed on the `preferredAltitudeSource`; light smoothing (e.g., simple
  moving average over ~3 fixes) to avoid noisy single-sample spikes, matching
  the "computed from consecutive fixes" requirement without over-engineering
  for Phase 1.
- **Cumulative distance**: running haversine sum, exposed both per-fix
  (`DerivedPoint.cumulativeDistanceKm`) and as `summary.totalDistanceKm`.
- **Summary computation** (`summary.ts`): takeoff/landing time is approximated
  for Phase 1 as the first/last fix timestamp (no launch/landing heuristics —
  those are a future refinement); duration, min/max altitude, max ground
  speed, and fix count are derived by a single pass over `fixes`/`derived`.
- All derived values are computed **once** at load time (not per animation
  frame) and stored alongside `fixes` for O(1) lookup during replay.

### 6.3 Replay engine (`replay/replayEngine.ts`)

**Maps to:** FR-M-14, FR-M-15, FR-M-16, FR-M-17

- Implemented as a small class/hook driving a `requestAnimationFrame` loop:
  on each frame, if `isPlaying`, advance `currentTimeMs` by
  `elapsedWallClockMs * playbackSpeed`, clamped to `[firstFixTime, lastFixTime]`.
- Reaching the end of the flight auto-pauses (`isPlaying = false`).
- **Transport actions:** `play()`, `pause()`, `reset()` (seeks to
  `firstFixTime` and pauses).
- **Speed:** `setSpeed(multiplier)` — allowed values `[1, 2, 4, 8, 16]`.
- **Scrub:** a slider bound to `currentTimeMs` range `[firstFixTime,
lastFixTime]`; dragging calls `seek(timeMs)` directly (bypassing the rAF
  delta) for immediate feedback.
- **Step:** step forward/back moves `currentTimeMs` to the next/previous fix's
  exact timestamp (not a fixed delta), so stepping always lands on a real data
  point.
- **Keyboard shortcuts** (FR-M-17), bound at the `AppShell` level so they work
  regardless of focused element (unless a text input is focused):
  - `Space` → toggle play/pause
  - `ArrowRight` / `ArrowLeft` → step forward/back one fix
  - `Home` → reset to start
  - Shortcuts are listed in `LegendAndDisclaimer`/a small help affordance.

### 6.4 State store (`state/useFlightStore.ts`)

Zustand store shape (single store for Phase 1 — no need to split yet):

```ts
interface FlightStoreState {
  flight: NormalizedFlight | null;
  loadError: IgcParseError | null;
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: 1 | 2 | 4 | 8 | 16;
  altitudeSource: 'pressure' | 'gnss';

  loadFlight: (flight: NormalizedFlight) => void;
  setLoadError: (error: IgcParseError) => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (timeMs: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  setSpeed: (speed: 1 | 2 | 4 | 8 | 16) => void;
  setAltitudeSource: (source: 'pressure' | 'gnss') => void;
}
```

- `seek`, `stepForward`, `stepBackward` all clamp `currentTimeMs` to the
  flight's time range.
- Derived "current fix index" (used by `MapView`, `Barogram`,
  `TelemetryPanel`) is computed via a memoized binary search on `fixes` keyed
  by `currentTimeMs` — not stored redundantly in state.

### 6.5 Map (`components/MapView.tsx`, MapLibre GL JS)

**Maps to:** FR-M-7, FR-M-8, FR-M-9, FR-M-10

- On flight load: add a GeoJSON `LineString` source from `fixes`
  (lon/lat pairs) and a `line` layer for the track; call `fitBounds` to the
  track's bounding box with padding.
- A single marker (glider icon) is repositioned on every `currentTimeMs`
  change by interpolating between the two nearest fixes (smooth motion during
  playback rather than snapping fix-to-fix).
- **Base map:** default style is **OpenFreeMap** (no API key required,
  OSM/OpenMapTiles-based vector style), loaded via a style URL configured
  through an environment variable (`VITE_MAP_STYLE_URL`, defaulting to an
  OpenFreeMap style such as `https://tiles.openfreemap.org/styles/liberty`) so
  the provider can still be swapped without code changes; attribution
  rendered per OpenFreeMap/OSM terms (FR-M-8).
- **Hover/click-to-seek (FR-M-10):** a `mousemove`/`click` handler on the track
  layer finds the nearest fix (via a small spatial index or linear scan — track
  sizes are small enough for linear scan to be fine) and calls
  `store.seek(fix.timeMs)`.
- Map interactions (pan/zoom) are independent of replay state; the app does
  **not** force re-centering on every frame by default, keeping user-driven map
  navigation unobstructed (auto-follow could be a future toggle, not required
  for Phase 1).

### 6.6 Barogram (`components/Barogram.tsx`, uPlot)

**Maps to:** FR-M-11, FR-M-12, FR-M-13

- Single uPlot instance with one series: altitude (m) vs time, using
  `altitudeSource` from the store; a small in-UI toggle lets the user switch
  pressure/GNSS (only shown if both are present).
- **Downsampling:** for flights with a very large number of fixes, feed uPlot
  a stride-sampled (e.g., min/max-preserving) series above a configurable
  threshold (e.g., > 5,000 points) to keep rendering smooth; the full-resolution
  `fixes` array remains the source of truth for seeking/telemetry.
- **Synchronized cursor (FR-M-12):** uPlot's built-in cursor is driven
  programmatically by `currentTimeMs` via `uplot.setCursor({ left, top })`
  mapped from time to pixel `x`, updated on every store change — not only on
  user hover.
- **Interaction (FR-M-13):** uPlot's `hooks.setCursor`/click handlers call
  `store.seek(timeMs)` when the user interacts directly with the chart.

### 6.7 Telemetry & summary panels (`TelemetryPanel.tsx`, `FlightSummaryPanel.tsx`)

**Maps to:** FR-M-18, FR-M-19, FR-M-20

- `TelemetryPanel` reads the current fix (via the same binary-search lookup as
  §6.4) and renders: UTC time, lat/lon, pressure & GNSS altitude, ground speed,
  vario — all formatted via `domain/units.ts` metric formatters (FR-M-20).
- `FlightSummaryPanel` renders `flight.summary` once, computed at load time
  (no per-frame recomputation).
- `domain/units.ts` centralizes metric formatting (e.g., `formatAltitude`,
  `formatSpeed`, `formatDuration`) so all displayed values are consistent and
  ready to be extended with unit-system switching in a later phase.

### 6.8 App shell & layout (`app/App.tsx`, `components/EmptyState.tsx`, `components/LegendAndDisclaimer.tsx`)

**Maps to:** FR-M-21, PRD §9 (UX), PRD §1 safety disclaimer

- Responsive layout (Tailwind grid/flex): map + barogram as the primary area,
  a sidebar with `FlightSummaryPanel`/`TelemetryPanel`, and a control bar with
  `ReplayControls`.
- **Empty state (FR-M-21):** before a flight is loaded, the primary area shows
  `EmptyState` with an upload call-to-action and a short "how it works" hint;
  replay controls are disabled/hidden.
- A persistent, always-visible safety disclaimer ("indicative only, not for
  in-flight use") is rendered via `LegendAndDisclaimer`, satisfying the PRD's
  product-level disclaimer requirement.

### 6.9 Internationalization scaffolding (`i18n/`)

**Maps to:** FR-M-22

- `react-i18next` initialized with a single `en` namespace/bundle
  (`i18n/locales/en.json`); every user-facing string in components goes through
  `t('key')` from day one (no hardcoded literals), even though only English
  ships in Phase 1.
- Structure allows adding `fr.json` later without touching component code.

---

## 7. Units & formatting

- Default and only unit system for Phase 1: **metric** (m, km, km/h, m/s),
  matching PRD FR-M-20 and VerifLocal's default.
- All numeric formatting goes through `domain/units.ts` helpers so a future
  imperial/Australian unit toggle only requires changing this module, not each
  component.

---

## 8. Non-functional & performance requirements

| ID      | Requirement                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-T-1 | Parsing + normalization of a typical multi-hour flight (tens of thousands of fixes) completes in ≲ 2 s, off the main thread (Web Worker). |
| NFR-T-2 | Replay maintains smooth marker/cursor motion (target ~30–60 fps) without janking the map or chart, including via barogram downsampling.   |
| NFR-T-3 | The app never crashes on malformed/partial IGC input; failures degrade to a visible error state.                                          |
| NFR-T-4 | No flight data is sent to a network endpoint; the only network calls are for base-map tiles/fonts.                                        |
| NFR-T-5 | Supported browsers: latest 2 versions of Chrome, Firefox, Safari, Edge (desktop-first; usable on tablets).                                |
| NFR-T-6 | Domain layer (parsing/model/metrics) is covered by unit tests independent of the UI framework.                                            |

---

## 9. Accessibility & keyboard shortcuts

- Replay controls are real, focusable, labeled buttons/sliders (shadcn/ui
  primitives), not divs with click handlers only.
- Keyboard shortcuts (§6.3) provide full replay control without a mouse.
- Color is never the sole carrier of meaning (Phase 1 has no status coloring
  yet, but this constraint is set up for Phase 2's color model).
- Sufficient contrast on text/panels per Tailwind's default palette choices;
  verify with basic automated a11y checks (e.g., `axe` in Playwright, optional
  for Phase 1).

---

## 10. Tooling & quality

- **Scripts:** `dev`, `build`, `preview`, `lint`, `format`, `test` (Vitest),
  `test:e2e` (Playwright) — all wired via `package.json`.
- **Linting/formatting:** ESLint (TypeScript + React hooks rules) + Prettier,
  run in CI-equivalent local scripts (no CI pipeline defined in this document —
  see §14).
- **Testing pyramid:**
  - _Unit (Vitest):_ `normalizeIgc`, `derivedMetrics`, `summary`, `units` —
    pure functions, easy to test with fixture IGC files.
  - _Component (RTL):_ `ReplayControls`, `TelemetryPanel`, `FlightSummaryPanel`,
    `EmptyState` — render + interaction tests.
  - _E2E (Playwright):_ "upload a sample IGC → map and barogram render → play →
    scrub → telemetry updates" as the core smoke test.
- **Fixtures:** a small set of representative sample `.igc` files under
  `fixtures/sample-flights/` (short flight, long flight, flight with missing
  GNSS altitude, deliberately malformed file) used by both unit and e2e tests.

---

## 11. Concrete dependency list

**Runtime**

- `react`, `react-dom`
- `igc-parser`
- `maplibre-gl`
- `uplot`
- `zustand`
- `react-i18next`, `i18next`

**Dev**

- `vite`, `@vitejs/plugin-react`
- `typescript`
- `tailwindcss`, `postcss`, `autoprefixer`
- shadcn/ui CLI-generated component files (no extra runtime dependency beyond
  its own small primitives, e.g. `@radix-ui/*` as needed per component)
- `eslint` + TypeScript/React plugins, `prettier`
- `vitest`, `@testing-library/react`, `@testing-library/jest-dom`
- `@playwright/test`

---

## 12. Build order / technical milestones

1. **Scaffold** — Vite + React + TS project; Tailwind + shadcn/ui set up;
   ESLint/Prettier; empty `AppShell` with disclaimer/legend placeholder.
2. **Ingestion** — Web Worker + `igc-parser` wiring; `normalizeIgc`; error
   handling; unit tests against fixtures.
3. **Domain model** — derived metrics + summary computation; unit tests.
4. **State store** — Zustand store with replay clock and actions; unit tests
   for seek/clamp/step logic.
5. **Map** — `MapView` with track rendering, fit-bounds, marker; hover/click
   seek.
6. **Barogram** — uPlot integration, synchronized cursor, downsampling,
   click/hover seek.
7. **Replay engine** — rAF loop wired to controls; keyboard shortcuts.
8. **Panels** — `TelemetryPanel`, `FlightSummaryPanel`, `EmptyState`.
9. **Polish** — responsive layout, i18n string extraction, accessibility pass.
10. **Test hardening** — fill out unit/component/e2e coverage; run against all
    fixtures.

---

## 13. Acceptance criteria / Definition of Done

Phase 1 is done when every PRD MVP functional requirement is met and
demonstrable:

| PRD requirement                 | Satisfied by                                       |
| ------------------------------- | -------------------------------------------------- |
| FR-M-1 File upload              | §6.1 `UploadZone` (picker + drag-and-drop)         |
| FR-M-2 Client-side parsing      | §6.1 Web Worker parsing, no network transmission   |
| FR-M-3 Parse B-records          | §5 `Fix` model + `normalizeIgc`                    |
| FR-M-4 Parse headers            | §5 `FlightHeader` + `normalizeIgc`                 |
| FR-M-5 Validation & errors      | §6.1 typed `IgcParseError` + UI error state        |
| FR-M-6 Reasonable size handling | §6.1 + §8 NFR-T-1 (Web Worker, ≲2s)                |
| FR-M-7 Map display              | §6.5 track layer + fitBounds                       |
| FR-M-8 Base map layers          | §6.5 configurable style + attribution              |
| FR-M-9 Glider marker            | §6.5 interpolated marker                           |
| FR-M-10 Hover to seek           | §6.5 track hover/click → `seek()`                  |
| FR-M-11 Altitude curve          | §6.6 uPlot series, pressure/GNSS toggle            |
| FR-M-12 Synchronized cursor     | §6.6 programmatic `setCursor` from `currentTimeMs` |
| FR-M-13 Baro interaction        | §6.6 hover/click → `seek()`                        |
| FR-M-14 Transport controls      | §6.3 play/pause/reset                              |
| FR-M-15 Playback speed          | §6.3/§6.4 speed multipliers                        |
| FR-M-16 Scrub / timeline        | §6.3 slider + fix-aligned step                     |
| FR-M-17 Keyboard shortcuts      | §6.3 Space/Arrow/Home                              |
| FR-M-18 Live point readout      | §6.7 `TelemetryPanel`                              |
| FR-M-19 Flight summary panel    | §6.7 `FlightSummaryPanel`                          |
| FR-M-20 Units                   | §7 metric-only via `domain/units.ts`               |
| FR-M-21 Empty/initial state     | §6.8 `EmptyState`                                  |
| FR-M-22 i18n-ready              | §6.9 `react-i18next` from day one                  |

Additionally:

- All items in §10 test pyramid pass locally.
- No French strings remain hardcoded in the UI (English-only ships; PRD term
  alignment: "Landing Zone (LZ)" is not user-facing yet in Phase 1 since no LZ
  feature exists).
- App builds to a static bundle (`npm run build`) with no runtime errors on the
  sample fixtures.

---

## 14. Open questions

1. **Hosting/CI target.** Deployment is intentionally out of scope for this
   document (per product decision) — where and how the static build will
   eventually be hosted, and whether a CI pipeline is introduced later, is
   still to be decided.
2. **Sample IGC fixtures.** Source/curate the concrete sample flight files
   used for development and tests (§10), including at least one edge-case file
   (missing GNSS altitude, midnight rollover).
3. **E2E testing confirmation.** Playwright is proposed for e2e tests (§3);
   confirm or consider alternatives if a stronger opinion exists.

### Resolved decisions

- ~~Base-map provider & licensing~~ → **OpenFreeMap** (§6.5), keyless, no
  attribution/licensing blocker for a default.
- ~~Default altitude source~~ → **Pressure altitude** (§5.1), confirmed.
- ~~State library confirmation~~ → **Zustand**, confirmed (§3).
- ~~i18n / package manager / lint-format / unit testing~~ → **react-i18next /
  npm / ESLint+Prettier / Vitest+React Testing Library**, all confirmed (§3).

---

_This is a living document, scoped strictly to Phase 1. Later phases (local
verification, escape paths/reachable zone, airspace/wind/reporting) will each
get their own technical specification once planned in detail._
