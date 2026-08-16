# Local Check — User Guide

**Local Check** is a post-flight analysis tool for glider pilots and soaring clubs. It replays an IGC flight log against a database of landing options and verifies whether the pilot stayed within safe gliding distance of an airfield or outlanding field throughout the flight.

---

## About

- **Author:** [ACPH - Aéroclub Pierre Herbaud](https://aeroclub-issoire.fr/)
- **Source code:** [github.com/tfraudet/local-check](https://github.com/tfraudet/local-check)
- **License:** MIT

---

## Getting Started

1. Open the **Flight** panel from the left sidebar (plane icon).
2. Drag & drop an `.IGC` file, or click to browse and select one.
3. Once parsed, the flight track, barogram, and landing zones appear automatically.
4. Use the **Replay Controls** at the bottom to play the flight and inspect the safety analysis.

---

## Interface Overview

The application is organised around a persistent left sidebar and three main visualisation zones.

### Sidebar

The icon-only left navigation is always visible:

- **Plane** — Upload and manage the current flight
- **Settings** — Configure analysis parameters and data sources
- **Info** — Open this help documentation
- **FR/EN** Switch language
- **Sun / Moon** — Toggle between light and dark theme

Clicking an icon expands a contextual panel next to the sidebar.

### Main Layout

- **Map view** (upper area) — Flight track, landing zones, escape path, and reachable-zone overlay
- **Barogram row** (lower area)
  - Right: **Escape Path Profile** — terrain and glide-plane profile toward the best reachable landing zone
  - Left: **Barogram** — altitude over time, synchronised with the map cursor
- **Replay Controls** — Timeline scrubber, play/pause, speed selector, and time display

---

## Flight Panel

Once a flight is loaded, the Flight panel displays:

- Pilot name, glider type, flight date
- Duration, total distance, minimum and maximum altitude
- Maximum ground speed
- Source file name and validation status

---

## Replay Controls

- **Play / Pause** — Start or pause the replay
- **Step forward / backward** — Advance one sample at a time
- **Reset** — Return to the start of the flight
- **Speed** — Playback speed from **1x** up to **16x**
- **Timeline scrubber** — Click or drag to jump to any moment

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Left arrow` | Step backward |
| `Right arrow` | Step forward |
| `Home` | Reset to start |

---

## Local Check Analysis

The **Local Stats** panel classifies the flight against your safety parameters:

- **Always in Local** (green) — The flight always remained within safe glide range
- **Marginal** (yellow) — Margins fell below the safety threshold at some point
- **Out of Local** (red) — The pilot left the safe glide range at least once

Key metrics displayed:

- **Time out of local** — Duration and percentage of the flight spent outside safe range
- **Minimum missing height** — Smallest deficit toward reaching a landing zone
- **Maximum missing height** — Largest deficit recorded
- **Number of exits** — How many separate out-of-local events occurred
- **Jump to first breach** — Click to seek the replay to the first out-of-local moment

### Track Colouring

The flight track on the map is colour-coded by phase and safety status:

- Initial climb
- Engine on (ENL above threshold)
- In local
- Marginal
- Out of local
- Final glide (if detection is enabled)

---

## Escape Path & Reachable Zone

### Escape Path

A dashed polyline from the current replay position to the landing zone offering the **highest projected arrival height** above ground. It updates continuously during replay and is colour-coded by status (in-local / marginal / out-of-local).

The **Escape Path Profile** chart (right of the barogram) shows:

- Terrain elevation along the escape trajectory
- The glide plane from the current position
- Arrival marker at the destination landing zone
- Safety-arrival target line

### Reachable Zone

A translucent green overlay showing the area reachable from the current position, given your working L/D and the underlying terrain. Configurable via:

- **Grid size** — 90 / 180 / 360 / 720 m (smaller = more detailed, slower)
- **Diameter** — 5 to 30 km around the current position

A quality hint is shown if the requested resolution exceeds the maximum number of cells supported.

### Arrival Height Labels

When enabled, each visible landing zone shows a pill label with the projected arrival height from the current position, automatically colour-coded by safety status.

---

## Settings

All settings are persisted in your browser (localStorage).

### Core Parameters

| Setting | Default | Description |
|---------|---------|-------------|
| **Working L/D** | 20 | Glide ratio used for local-check computations |
| **Safety Arrival Height** | 300 m | Minimum height above the landing zone on arrival |
| **Ground Clearance** | 150 m | Minimum height above terrain along the glide path (informational) |
| **Detect Final Glide** | On | Automatically detect and mark final glide |
| **Time Step** | 20 s | Sampling interval for the local check (minimum 10 s) |
| **ENL Threshold** | 500 | Engine noise level above which the engine is considered on |
| **Recalibrate altitude on local QNH** | Off | Correct raw IGC pressure altitude to the day's QNH using pre-takeoff terrain elevation |

#### Recalibrate altitude on local QNH

IGC pressure altitude is recorded against the International Standard Atmosphere reference (1013.25 hPa), not the QNH of the day, so displayed altitudes and AGL can be off by tens of meters. When this toggle is enabled, Local Check:

1. Averages the barometric altitude of the first ~8 consecutive stationary fixes (ground speed below 10 km/h) before takeoff.
2. Samples the terrain elevation at that same position.
3. Computes an offset (`terrain − average baro`) and applies it to every pressure altitude in the flight — barogram, telemetry, AGL, local-check classification, escape path and reachable zone all reflect the corrected value.

The computed offset is displayed under the toggle (e.g. `+42.3 m`). If fewer than 5 valid pre-takeoff fixes are available, or if the takeoff position falls outside the elevation grid, the correction is disabled and a warning is shown; the raw IGC fixes are always preserved as the source of truth.

### Landing Zone Databases

Enable or disable the outlanding databases used for the analysis:

- **Alpes Outlanding Fields**
- **Auvergne Outlanding Fields (ACPH)**

Landing zones are marked on the map with difficulty level using a four-colour scale.

### Display Options

- **Show Escape Path** — Show or hide the dashed escape-path polyline
- **Show Reachable Zone** — Show or hide the translucent glide-reachable area
- **Show Arrival Heights on LZs** — Show or hide the arrival-height pill labels

### Reset

**Reset to Defaults** restores all settings to their original values.

---

## Theme

Use the **sun / moon** button at the bottom of the sidebar to switch between light and dark themes. Your choice is remembered between sessions.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `d` | Switch between dark and light themes |

---

## Data Sources & Loading Logic

When you upload an IGC file, Local Check parses it and then fetches three external data sets in parallel, all keyed off the flight's bounding box. Progress for each is reflected in the loading dialog. Everything is cached locally where feasible so re-uploading a flight in the same area is instant.

### 1. Terrain Elevation (DEM)

A regular grid of terrain heights is downloaded for the flight bounding box (buffered by ~20 km). The grid feeds AGL computation, escape-path terrain profiles, glide-plane clearance, reachable-zone analysis, and QNH recalibration.

> **⏱ Heads-up:** loading the elevation data is usually the slowest step of the process — expect **several tens of seconds** on a typical flight, depending on the size of the area covered and network conditions. The loading dialog shows the progress and the rest of the app remains responsive in the meantime.

#### Source: Microsoft Planetary Computer

Local Check fetches the DEM from the **[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/)** — Microsoft's open geospatial data catalog exposing petabyte-scale Earth-observation datasets as Cloud-Optimised GeoTIFFs (COGs) with a public STAC API. It requires no API key.

Loading strategy:

1. **STAC search** — enumerate the 1° × 1° tiles overlapping the flight bbox.
2. **Sign each asset href** via `/api/sas/v1/sign` to get a short-lived read URL.
3. **Byte-range reads** — open each COG with `geotiff.js`'s `fromUrl` so only the pixels inside the bbox are downloaded, not the whole tile.
4. **Blit into a single output grid** at ~30 m resolution.

The output is capped at ~2 million samples; when the request exceeds that budget, the resolution is coarsened by successive ×2 steps until it fits.

#### DSM vs DTM: why we use a DSM

Digital elevation models come in two main flavours:

- **DTM (Digital Terrain Model)** — bare-earth elevation. Vegetation, buildings, and other surface features are removed so the model represents the ground itself.
- **DSM (Digital Surface Model)** — top-of-surface elevation. The model captures whatever the sensor sees from above, including tree canopy, buildings, and other structures.

Local Check uses a **DSM**. Rationale: for landability/glide analysis, the height that actually threatens the glider is the top of what stands on the ground — a forest canopy, a ridge with trees, or a built-up area — not the theoretical bare-earth level a few meters below. A DSM is therefore a slightly conservative (safer) choice for AGL and glide-plane clearance computations. The trade-off is that in dense vegetation the "terrain" will read a few meters higher than the true ground, which is acceptable for a safety tool.

#### Model retrieved: Copernicus DEM GLO-30

The specific dataset consumed is **Copernicus DEM GLO-30** (STAC collection `cop-dem-glo-30`):

- Global coverage at ~30 m ground sampling distance (1 arc-second)
- WorldDEM DSM produced from TanDEM-X interferometric SAR data (ESA / Airbus)
- Reference: [Copernicus DEM GLO-30 on Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30)

Values are heights above the EGM2008 geoid.

### 2. Airports (OpenAIP)

Airports are pulled from **OpenAIP** to complement the outlanding databases with recognised runways worldwide.

- Instead of hitting the OpenAIP REST API on every viewport change, Local Check fetches the per-country JSON exports at `https://storage.openaip.net/openaip-system-exports/<cc>_apt.json`.
- The countries traversed are detected offline from the flight track using a 10 km world-polygons dataset (`@geo-maps/countries-land-10km`), sampled at ~30 points across the track. This produces a small list of ISO alpha-2 country codes (e.g. `fr`, `it`, `ch`).
- Per-country payloads are **cached in `localStorage` for 24 h**, so re-uploading any flight in the same country skips the network entirely.
- Only relevant airport types are kept: civil airports, glider sites, airfields (civil / IFR), ultra-light sites, landing strips, and altiports. Heliports, military-only, closed, water fields, and agricultural strips are dropped up-front.
- Loaded airports are then filtered to the flight bounding box (buffered by ~60 km) before being merged into the landing-zone catalog.

### 3. Outlanding-field databases

Two curated soaring databases can be enabled from the Settings panel. Each database is downloaded the first time its toggle is switched on (not necessarily at app start) and cached in memory for the rest of the session — subsequent toggle off/on cycles do not re-fetch. If both toggles stay off, no outlanding data is downloaded at all.

| Source | Region | URL | Format |
|--------|--------|-----|--------|
| **Alpes Outlanding Fields** | French / Italian / Swiss Alps | `planeur-net.github.io/outlanding/guide_aires_securite.cup` | SeeYou `.cup` waypoint file |
| **ACPH Auvergne Outlanding Fields** | Auvergne (France) | `aeroclub-issoire.fr/…/outlanding-fields-db.json` | JSON |

Both are parsed client-side and mapped into the shared `LandingZone` shape with position, elevation, orientation of the primary axis when available, and a colour-coded difficulty level.

**OpenAIP takes precedence over the outlanding databases.** Because OpenAIP is the canonical source for airfields, any Alpes or Auvergne outlanding entry lying within **400 m** of an OpenAIP zone is dropped when the active list is assembled — this prevents a `.cup` airfield entry from shadowing the corresponding OpenAIP record with slightly different position, name or elevation.

At parse time, each source is also cleaned of its own internal duplicates: two entries closer than 250 m within the same database are merged (a source file can list, for instance, both runway ends or two nearby waypoints for the same physical field). Airfields and entries with an explicit difficulty tag are preferred over untagged waypoints when merging.

#### Difficulty levels

Every outlanding field carries a difficulty rating on a simplified **four-colour scale**, from safest to hardest:

| Level | Meaning |
|-------|---------|
| 🟢 **Green** | Airfield or easy landable field |
| 🟠 **Orange** | Medium — requires care |
| 🔴 **Red** | Difficult — experienced pilots only |
| ⚫ **Black** | Very difficult — last-resort field |

##### Alpes: tag-to-level conversion

The Alpes `.cup` database uses the alpine outlanding tags embedded in each waypoint's description (`{A}`, `{F}`, `{E}`, `{ZA}`, `{LA}`, `{M}`, `{D}`, `{TD}`, `{VD}`). Local Check maps them to the 4-level colour scale as follows:

| Alpine tag | Meaning | Level |
|------------|---------|-------|
| `A` | Airfield | 🟢 Green |
| `F` / `E` | Easy (*facile*) | 🟢 Green |
| `ZA` / `LA` | Group of fields | 🟢 Green |
| *(no tag)* | Untagged waypoint | 🟢 Green |
| `M` | Medium (*moyen*) | 🟠 Orange |
| `D` | Difficult (*difficile*) | 🔴 Red |
| `TD` / `VD` | Very difficult (*très difficile*) | ⚫ Black |

##### Auvergne

The ACPH Auvergne JSON already ships an explicit difficulty field, so no tag translation is needed — the level is read directly from the source.

##### OpenAIP airports

Every OpenAIP airport is treated as an airfield and mapped to 🟢 **Green**.

Toggling a source in the Settings panel adds or removes the corresponding zones from the map and from the local-check computation without re-fetching.

### 4. Loading orchestration

When you upload an IGC file, the following happens in the background:

1. The flight track is parsed and the summary (pilot, glider, duration, distance…) becomes available.
2. The terrain elevation and the OpenAIP airport list for the countries traversed are fetched in parallel around the flight area.
3. The safety analysis (local check) runs automatically as soon as the flight, the terrain and at least one landing zone are ready.

Outlanding databases are independent of the upload: they are downloaded the first time you enable their toggle and then kept for the rest of the session.

The loading dialog reports the progress of each step and closes on its own when everything is ready. Changing a setting in session (QNH recalibration, enabling or disabling a source) refreshes the analysis but never re-downloads data — only uploading a new flight does.

---

## Notes & Tips

- Landing zones are matched using the configured databases only — make sure the relevant regions are enabled.
- Reducing the reachable-zone grid size dramatically increases computation cost; start with 360 m and refine if needed.
- The Ground Clearance parameter is informational and does not affect the local-check classification.
- Elevation data is loaded on demand; the loading dialog reports progress across elevation, landing-zone database, and local-check computation.
- OpenAIP country payloads and elevation results are cached client-side — clearing your browser storage forces a fresh fetch on the next upload.

---

## Credits

Local Check was inspired by **[VerifLocal](https://condorutill.fr/index_fr.php)**, the well-known desktop application widely used in the French soaring community for post-flight local-verification analysis — notably adopted by the **FFVP** (Fédération Française de Vol en Planeur).

The goal of this project is to offer a **pure web** alternative:

- Runs directly in the browser — **no local installation** required.
- Works on **macOS and Linux** as well as Windows, whereas VerifLocal is a Windows-only desktop application.
- Instantly accessible from any device with a browser, without administrator rights or setup.

Many thanks to the author of VerifLocal for pioneering the concept — this web version simply aims to make the same kind of analysis available to a wider audience across all platforms.
