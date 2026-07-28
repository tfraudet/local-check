# Local Check

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](<>)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

A specialized safety and post-flight analysis tool for glider pilots and soaring clubs. **Local Check** verifies whether a pilot remained within safe gliding distance (local range) of an airfield or a designated Landing Zone throughout their entire flight.

---

## 🎯 Core Objective

Safety is paramount in soaring. This tool processes `.IGC` flight logs to automatically audit track logs against predefined landing options (airfields and verified Landing Zones suitable for outlandings).

It helps flight instructors, safety officers, and pilots answer critical safety questions:

- Did the pilot stay within safe gliding range ($L/D$) of a suitable landing spot at all times?
- Were safety margins (minimum arrival altitudes) respected before leaving a thermal or gliding between zones?
- Did any part of the flight enter an "out-of-glide" red zone?

---

## 🚧 Project Status: Phase 1 MVP

The current release is the **Phase 1 MVP**, focused on the foundation: uploading a single IGC flight log and replaying it. See [`docs/PRD.md`](docs/PRD.md) for the full product vision and [`docs/phase-1-technical-spec.md`](docs/phase-1-technical-spec.md) for the technical design.

### ✨ Implemented in Phase 1

- **IGC Parsing:** Client-side parsing of standard IGC flight records, off the main thread via a Web Worker.
- **Interactive Replay:** Play/pause, step forward/backward, reset, adjustable playback speed (1×–16×), and timeline scrubbing, with keyboard shortcuts (Space, ←/→, Home).
- **Map View:** Flight track rendered on an OpenFreeMap basemap (MapLibre GL), with a live position marker synced to replay time.
- **Barogram:** Interactive altitude-over-time chart with a replay-synced cursor and click/hover-to-seek.
- **Telemetry & Flight Summary Panels:** Live time, position, altitude (pressure/GNSS), ground speed, and vario, plus overall flight stats (date, pilot, glider, duration, min/max altitude, max speed, total distance).
- **Derived Metrics:** Ground speed, vario, and cumulative distance computed from raw IGC fixes.

### 🗺️ Planned (future phases)

- Dynamic safety cone / local-range calculator based on glider polar ($L/D$), altitude, terrain, and wind drift.
- Landing Zone and airfield database import (`.cup`, `.wpt`, `.geojson`).
- Out-of-local alerting and auditing of flight segments that breach safety boundaries.
- Margin/altitude heatmaps and debrief/club compliance reports.

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
