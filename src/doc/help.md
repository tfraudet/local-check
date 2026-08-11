# Local Check — User Guide

**Local Check** is a post-flight analysis tool for glider pilots and soaring clubs. It replays an IGC flight log against a database of landing options and verifies whether the pilot stayed within safe gliding distance of an airfield or outlanding field throughout the flight.

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
- **Sun / Moon** — Toggle between light and dark theme

Clicking an icon expands a contextual panel next to the sidebar.

### Main Layout

- **Map view** (upper area) — Flight track, landing zones, escape path, and reachable-zone overlay
- **Barogram row** (lower area)
  - Left: **Escape Path Profile** — terrain and glide-plane profile toward the best reachable landing zone
  - Right: **Barogram** — altitude over time, synchronised with the map cursor
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

The **Escape Path Profile** chart (left of the barogram) shows:

- Terrain elevation along the escape trajectory
- The glide plane from the current position
- Arrival marker at the destination landing zone
- Safety-arrival target line

### Reachable Zone

A translucent green overlay showing the area reachable from the current position, given your working L/D and the underlying terrain. Configurable via:

- **Grid size** — 90 / 180 / 360 / 720 m (smaller = more detailed, slower)
- **Diameter** — 5 to 30 km around the current position

Computation runs in a Web Worker with a short debounce; a quality hint is shown if the requested resolution exceeds the cell budget.

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

### Landing Zone Databases

Enable or disable the outlanding databases used for the analysis:

- **Alpes Outlanding Fields**
- **Auvergne Outlanding Fields (ACHh)**

Landing zones are marked on the map with difficulty tags (A / F / M / D / TD).

### Display Options

- **Show Escape Path** — Show or hide the dashed escape-path polyline
- **Show Reachable Zone** — Show or hide the translucent glide-reachable area
- **Show Arrival Heights on LZs** — Show or hide the arrival-height pill labels

### Reset

**Reset to Defaults** restores all settings to their original values.

---

## Theme

Use the **sun / moon** button at the bottom of the sidebar to switch between light and dark themes. Your choice is remembered between sessions.

---

## Notes & Tips

- Landing zones are matched using the configured databases only — make sure the relevant regions are enabled.
- Reducing the reachable-zone grid size dramatically increases computation cost; start with 360 m and refine if needed.
- The Ground Clearance parameter is informational and does not affect the local-check classification.
- Elevation data is loaded on demand; the loading dialog reports progress across elevation, landing-zone database, and local-check computation.
