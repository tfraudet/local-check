# Local Check

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](<>)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

A specialized safety and post-flight analysis tool for glider pilots and soaring clubs. **Local Check** verifies whether a pilot remained within safe gliding distance (local range) of an airfield or a designated Landing Zone throughout their entire flight.

## 🎯 Core Objective

Safety is paramount in soaring. This tool processes `.IGC` flight logs to automatically audit track logs against predefined landing options (airfields and verified Landing Zones suitable for outlandings).

It helps flight instructors and pilots answer critical safety questions:

- Did the pilot stay within safe gliding range ($L/D$) of a suitable landing spot at all times?
- Were safety margins (minimum arrival altitudes) respected before leaving a thermal or gliding between zones?
- Did any part of the flight enter an "out-of-glide" red zone?

## 🚧 Project Status

### ✨ Implemented features

- **IGC Parsing:** Client-side parsing of standard IGC flight records, off the main thread via a Web Worker.
- **Interactive Replay:** Play/pause, step forward/backward, reset, adjustable playback speed (1×–16×), and timeline scrubbing, with keyboard shortcuts (Space, ←/→, Home).
- **Map View:** Flight track rendered on an OpenFreeMap basemap (MapLibre GL), with a live position marker synced to replay time.
- **Barogram:** Interactive altitude-over-time chart with a replay-synced cursor and click/hover-to-seek.
- **Telemetry & Flight Summary Panels:** Live time, position, altitude (pressure/GNSS), ground speed, and vario, plus overall flight stats (date, pilot, glider, duration, min/max altitude, max speed, total distance).
- **Derived Metrics:** Ground speed, vario, and cumulative distance computed from raw IGC fixes.
- **Landing Zone import (`.cup`):** SeeYou-format waypoint files parsed client-side; airfield vs outlanding, difficulty tags (`{A}` / `{F}` / `{M}` / `{D}` / `{TD}`), 250 m de-duplication.
- **Terrain elevation:** OpenTopography DEM prefetched around the flight bbox; bilinear sampling for AGL and glide computations.
- **In-local / marginal / out-of-local classification:** One shared rule across all surfaces — for each fix, pick the LZ with the highest projected arrival above ground, then colour by `arrival > safety height` (green) / `arrival > 0` (yellow) / `arrival ≤ 0` (red).
- **Coloured track & barogram:** Track segments and altitude line coloured per phase (initial-climb, motor, final-glide) and status. Legend surfaces every colour.
- **Out-of-local statistics:** Time / % out-of-local, mean & max missing height, first out-of-local time (click-to-seek).
- **Configurable parameters:** Working L/D, safety arrival height, time step, ENL threshold — all persisted via `localStorage`. (Ground clearance is exposed but informational only; it does not gate status.)
- **Escape path:** From the current replay position to the LZ with the highest arrival height above ground. Dashed polyline on the map (green/yellow/red per shared status rule).
- **Escape-path profile chart:** Compact uPlot chart to the right of the barogram (30 / 70 width split). Draws the terrain profile and glide plane along the escape line, with a filled square marker at the LZ and a dashed arrival-target guide. Extends 20 % past the LZ for post-target context.
- **Reachable zone:** From the current position, at user-selectable grid size (90 / 180 / 360 / 720 m) and extent (5–30 km). Rendered as a translucent green fill overlay under the track. Runs in a dedicated Web Worker with a 250 ms debounce on cursor moves.
- **Arrival-height labels:** For every visible LZ, an SDF "pill" label shows the projected arrival height at the current fix, colour-coded by the shared status rule.

### 🗺️ Planned features

- **Airspace penetration detection & reporting** (imported OpenAir/GeoJSON).
- **Wind effect on glide,** manual entry or drift-derived.
- **Downloadable debrief reports** — flight summary, out-of-local events, screenshots for club compliance.
- **Terrain-avoiding poly-line escape routes** (Phase 3 ships straight-line only).

---

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Open the printed local URL, then upload an IGC file (e.g. `fixtures/sample-flights/simple-flight.igc`) to try the replay.

### Available scripts

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start the Vite dev server                |
| `npm run build`        | Type-check and build for production      |
| `npm run preview`      | Preview the production build locally     |
| `npm run lint`         | Run ESLint                               |
| `npm run format`       | Format the codebase with Prettier        |
| `npm run format:check` | Check formatting without writing changes |
| `npm run test`         | Run the Vitest unit test suite           |

### Tech stack

React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, react-i18next, MapLibre GL (OpenFreeMap tiles), uPlot, and igc-parser.
