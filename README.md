# Local Check

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](<>)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

A specialized safety and post-flight analysis tool for glider pilots and soaring clubs. **Local Check** verifies whether a pilot remained within safe gliding distance (local range) of an airfield or a designated Landing Zone throughout their entire flight.

![Local Check screenshot](./screenshot.png)

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
- **Map View:** Flight track rendered on MapLibre GL, with a live position marker synced to replay time. Five basemap styles are switchable at runtime: **OpenStreetMap**, **Liberty**, **Positron** and **Dark** (all three via [OpenFreeMap](https://openfreemap.org)), plus **Satellite (Esri World Imagery)**.
- **Barogram:** Interactive altitude-over-time chart with a replay-synced cursor and click/hover-to-seek.
- **Telemetry & Flight Summary Panels:** Live time, position, altitude (pressure/GNSS), ground speed, and vario, plus overall flight stats (date, pilot, glider, duration, min/max altitude, max speed, total distance).
- **Derived Metrics:** Ground speed, vario, and cumulative distance computed from raw IGC fixes.
- **Landing Zone catalog:** Airports pulled from **OpenAIP** per-country JSON exports (24 h `localStorage` cache) plus two curated outlanding databases toggleable from the Settings panel:
  - **Alpes Outlanding Fields** — SeeYou `.cup` file covering the French / Italian / Swiss Alps, with alpine difficulty tags (`{A}` / `{F}` / `{M}` / `{D}` / `{TD}` …) mapped to a four-colour scale.
  - **ACPH Auvergne Outlanding Fields** — JSON catalog for the Auvergne region, difficulty read directly from the source.

  OpenAIP takes precedence: outlanding entries within 400 m of an OpenAIP zone are dropped, and within each source entries closer than 250 m are merged (airfield / tagged entries preferred).
- **Terrain elevation:** DEM grid prefetched around the flight bounding box, with bilinear sampling for AGL and glide computations. The backend is picked at runtime from the Settings panel and persisted per user:
  - **[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)** (Terrarium) *(default)* — no API key required; PNG-encoded XYZ tiles served from a CloudFront-fronted S3 bucket. Mosaic of EU-DEM (~25 m over Europe, DTM), 3DEP (~10 m over USA), SRTM (~30 m elsewhere within ±60°). Typically the fastest option thanks to CDN caching and browser-native HTTP cache reuse on repeat loads — trade-off in Europe: EU-DEM is a DTM (bare-earth), so tree canopy and buildings are not represented.
  - **Microsoft Planetary Computer** — no API key required; serves **[Copernicus DEM GLO-30](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30)** (WorldDEM DSM, ~30 m, EGM2008 geoid) via STAC + Cloud-Optimised GeoTIFF byte-range reads. **DSM** — includes canopy/buildings, safer for AGL and glide-plane clearance.
  A **DSM** (Digital Surface Model — top-of-canopy) rather than a DTM (bare-earth) is used on purpose: for landability analysis the safety-relevant height is the top of what stands on the ground (canopy, buildings), not the theoretical ground level a few meters below.
- **In-local / marginal / out-of-local classification:** One shared rule across all surfaces — for each fix, pick the LZ with the highest projected arrival above ground, then colour by `arrival > safety height` (green) / `arrival > 0` (yellow) / `arrival ≤ 0` (red).
- **Coloured track & barogram:** Track segments and altitude line coloured per phase (initial-climb, motor, final-glide) and status. Legend surfaces every colour.
- **Out-of-local statistics:** Time / % out-of-local, mean & max missing height, first out-of-local time (click-to-seek).
- **Configurable parameters (persisted via `localStorage`):** working L/D, safety arrival height, time step, ENL threshold, final-glide detection toggle, terrain-aware routing toggle, QNH recalibration toggle, terrain elevation source (AWS Terrain / Microsoft Planetary Computer), per-source outlanding-database toggles (Alpes, Auvergne), and per-overlay show/hide toggles (escape path, arrival heights, reachable zone with its grid size and diameter). Ground clearance is exposed but informational only; it does not gate status.
- **Escape path:** From the current replay position to the LZ with the highest arrival height above ground. Dashed polyline on the map (green/yellow/red per shared status rule). Straight-line by default; when **terrain-aware routing** is enabled (see below), the path curves around ridges instead of clipping them.
- **Escape-path profile chart:** Compact uPlot chart to the right of the barogram. Draws the terrain profile and glide plane along the escape line, with a filled square marker at the LZ and a dashed arrival-target guide. Extends 20 % past the LZ for post-target context.
- **Reachable zone:** From the current position, at user-selectable grid size (90 / 180 / 360 / 720 m) and extent (5–30 km). Rendered as a translucent green fill overlay under the track. Runs in a dedicated Web Worker with a 250 ms debounce on cursor moves. With terrain-aware routing off, cells whose direct glide clips terrain are excluded; with it on, a single-source Dijkstra sweep discovers cells reachable via any-angle detours.
- **Terrain-aware routing (optional):** Off by default. When enabled from the Settings panel, the app looks for a curved path around ridges instead of rejecting an LZ behind terrain:
  - **Escape path, arrival heights, best-LZ picker in local check** → **Theta\*** (any-angle A\* on the elevation grid) per query. Line-of-sight backed by the same `glideClearsTerrain` primitive, so the glide plane must stay above terrain plus the ground-clearance buffer along the routed segment. Path length feeds directly into arrival height (`altitude − distance / L/D`).
  - **Reachable zone** → one **single-source Dijkstra** outward from the pilot on the reachable-zone grid, marking every cell with its shortest routed distance in a single pass — dramatically faster than running Theta\* per cell.
  - Trade-off: routing costs CPU and always yields a lower arrival height than the straight-line best case, so the toggle is off by default and only useful in mountainous flying.
- **Arrival-height labels:** For every visible LZ, an SDF "pill" label shows the projected arrival height at the current fix, colour-coded by the shared status rule.
- **QNH altitude recalibration:** Optional setting that estimates the day's QNH offset from the first ~8 stationary pre-takeoff fixes (comparing recorded baro altitude to terrain elevation at the takeoff position). When enabled, every pressure altitude in the flight is corrected in-app (raw IGC fixes are preserved); the computed offset is displayed under the toggle, and a warning is shown when pre-takeoff samples are insufficient.

### 🗺️ Planned features

- **Airspace penetration detection & reporting** (imported OpenAir/GeoJSON).
- **User-uploaded Landing Zone import** — SeeYou `.cup` files provided by the pilot, in addition to the built-in Alpes and Auvergne catalogs.
- **Wind effect on glide,** manual entry or drift-derived.
- **Downloadable debrief reports** — flight summary, out-of-local events, screenshots for club compliance.

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

### Environment configuration (`.env.local`)

Create a `.env.local` at the repo root to configure the elevation backend and any third-party API keys. All variables **must** be prefixed with `VITE_` so Vite exposes them to the client bundle.

Example `.env.local`:

```bash
# --- Terrain elevation backend ---
# Picked at runtime in the Settings panel (Microsoft Planetary Computer or
# AWS Terrain Tiles). Both are public and key-less — no env var needed.

# --- OpenAIP (optional, reserved for future REST-API use) ---
# VITE_OPENAIP_API_KEY=your-openaip-key-here
```

Supported variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_OPENAIP_API_KEY` | Reserved for future OpenAIP REST-API use (current build uses the CORS-friendly data exports and does not consume this) | *(empty)* |
| `VITE_UMAMI_SRC` | Umami script URL (e.g. `https://cloud.umami.is/script.js`). Leave empty to disable analytics. | *(empty)* |
| `VITE_UMAMI_WEBSITE_ID` | Umami website UUID. Required together with `VITE_UMAMI_SRC` for analytics to load. | *(empty)* |

Both elevation backends are fully public and require no key, so a bare install with no `.env.local` works out of the box.

### Analytics

When both `VITE_UMAMI_SRC` and `VITE_UMAMI_WEBSITE_ID` are set at build time, the app loads [Umami](https://umami.is) and reports a small, fixed set of **anonymous, cookieless** usage events. If either variable is empty (as in the default `.env.example`), no analytics script is loaded and no request is made — dev builds stay silent.

Events emitted (all first-party, no PII, no filename, no coordinates, no pilot name):

| Event | Extra properties | Fired when |
|-------|------------------|------------|
| `igc_upload` | `source` (`picker` \| `dragdrop`), `sizeKb` | An IGC file is accepted for parsing |
| `igc_parse_error` | `reason` | Parsing fails (invalid format, worker error, etc.) |
| `language_toggle` | `to` (`fr` \| `en`) | User clicks the FR/EN button |
| `theme_toggle` | `to` (`light` \| `dark`) | User clicks the sun/moon button |
| `help_open` | — | User opens the help panel |
| `replay_play` | — | User starts (not pauses) the replay |
| `replay_speed_change` | `speed` | User picks a new playback speed |
| `setting_change` | `key`, `value` | User changes L/D, safety height, QNH recalibration, or an outlanding-database toggle |

All tracking is defined in `src/lib/analytics.ts` — one small wrapper module — so events are typed and easy to audit.

### Dev-server proxies

Several upstream data sources do not send CORS headers, so the Vite dev server (`npm run dev`) and preview server (`npm run preview`) proxy them to the same origin. See [`vite.config.ts`](./vite.config.ts) for the exact configuration; in production these proxies are inactive — the deploy target must expose equivalent paths or the origin must add CORS support.

| Path prefix | Upstream | Used by |
|-------------|----------|---------|
| `/wp-content/uploads/acph` | `https://aeroclub-issoire.fr` | ACPH Auvergne outlanding-fields JSON (mirrors the same-origin path used in production, where the app is hosted on `aeroclub-issoire.fr/local-check/`) |
| `/local-check/openaip-storage-proxy` | `https://storage.openaip.net` | OpenAIP per-country airport exports (mirrors the Apache reverse-proxy set up in `.htaccess` on the production host) |

Neither elevation backend needs a proxy — their endpoints send permissive CORS headers.

### Tech stack

React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Zustand, react-i18next, MapLibre GL (OpenFreeMap tiles), uPlot, and igc-parser.

## 🙏 Credits

Local Check was inspired by **[VerifLocal](https://condorutill.fr/index_fr.php)**, the well-known desktop application widely used in the French soaring community for post-flight local-verification analysis — notably adopted by the **FFVP** (Fédération Française de Vol en Planeur).

The goal of this project is to offer a **pure web** alternative:

- Runs directly in the browser — **no local installation** required.
- Works on **macOS and Linux** as well as Windows, whereas VerifLocal is a Windows-only desktop application.
- Instantly accessible from any device with a browser, without administrator rights or setup.

Many thanks to the author of VerifLocal for pioneering the concept — this web version simply aims to make the same kind of analysis available to a wider audience across all platforms.
