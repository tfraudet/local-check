# Local Check — Product Requirements Document (PRD)

|                  |                                                                     |
| ---------------- | ------------------------------------------------------------------- |
| **Product**      | Local Check                                                         |
| **Document**     | Product Requirements Document (PRD)                                 |
| **Version**      | 0.1 (Draft)                                                         |
| **Status**       | Draft — for review                                                  |
| **Owner**        | tfraudet                                                            |
| **Last updated** | 2025                                                                |
| **Related docs** | `README.md`, VerifLocal V4.1 User Guide (`spike/VerifLocal_FR.pdf`) |

---

## 1. Executive summary

**Local Check** is a web application for glider pilots and soaring clubs that
analyzes a recorded flight (an IGC track log) and verifies whether the glider
remained within safe gliding range — "**in local**" — of an airfield or a
suitable outlanding field throughout the entire flight.

The product is inspired by the desktop application **VerifLocal** (Marc Till),
which performs the same safety verification on IGC / Condor tracks, and by the
web flight viewer **[seeyou.cloud](https://seeyou.cloud/)** for its general user
experience (synchronized map + barogram + replay).

This PRD describes the **full product vision** but deliberately scopes a small,
shippable **MVP (Phase 1)**: _upload a single IGC file and replay the flight_ on
a map with a synchronized barogram and playback controls. The safety
verification logic ("local" computation, escape paths, reachable zone, airspace)
is documented here as the product vision and is planned for later phases.

> ⚠️ **Safety disclaimer (product-level).** Like VerifLocal, Local Check is an
> _analysis and debrief aid only_. Its results are **indicative** and must never
> be used as proof, as a substitute for pilot judgment, or for real-time
> in-flight decision-making. This disclaimer must be surfaced in the product UI.

---

## 2. Background & problem statement

In soaring (gliding), an engineless aircraft must **always** be able to reach a
place to land safely — an airfield or a vetted outlanding field (a **Landing
Zone**, LZ). A glider is said to be **"in local"** of a
LZ when, from its current position and altitude, it can reach that LZ in a glide
(given a chosen glide ratio) while:

- staying above the terrain by a minimum ground clearance, and
- arriving over the LZ with at least a minimum safety height.

If at any moment no LZ is reachable under those constraints, the glider is
**"out of local"** — a safety-critical situation.

Today, pilots and instructors debrief flights informally or with the desktop
tool VerifLocal (Windows). There is no convenient, cross-platform, web-based way
to:

1. quickly **visualize/replay** an IGC flight (map + barogram), and
2. **audit** the flight against landing options to see when, where and by how
   much the glider left safe gliding range.

Local Check addresses this, starting with a lightweight replay MVP and growing
toward the full safety audit.

---

## 3. Goals & non-goals

### 3.1 Goals

- **G1** — Let a pilot/instructor load an IGC flight in the browser and replay
  it with a clear, familiar UI (map + barogram + playback). _(MVP)_
- **G2** — Provide accurate, readable per-point telemetry (time, position,
  altitude, ground speed, vertical speed, height above ground when available).
  _(MVP for the parts computable from IGC alone.)_
- **G3** — Eventually verify "local" status continuously along the flight and
  clearly flag out-of-local segments. _(Future)_
- **G4** — Support the soaring community's data formats (IGC in, SeeYou `.cup`
  for Landing Zones later). _(IGC = MVP; .cup = future.)_
- **G5** — Be a **client-side, privacy-friendly** tool: flights are analyzed in
  the browser and not uploaded to a server unless explicitly required by a
  feature.
- **G6** — Produce debrief-ready output (summaries/reports) for clubs and
  instructors. _(Future.)_

### 3.2 Non-goals

- **NG1** — Not a real-time / in-flight navigation or anti-collision tool.
- **NG2** — Not a flight-planning or task-scoring/competition tool.
- **NG3** — Not an official/certified safety authority; results are advisory.
- **NG4** — No 3D terrain rendering in early phases (2D map + barogram first).
- **NG5** — MVP does **not** compute "local", does **not** use terrain
  elevation, and does **not** manage a Landing Zone database.

---

## 4. Target users & personas

| Persona                 | Description                                                       | Primary need                                                         |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Solo pilot**          | Club or private glider pilot reviewing their own flight           | Replay the flight, understand where they were low / far from a field |
| **Flight instructor**   | Trains and validates pilots (esp. cross-country/solo progression) | Debrief a student's flight, show risky segments objectively          |
| **Club safety officer** | Reviews flights for compliance & safety culture                   | Audit flights, produce quick safety reports                          |
| **XC / mountain pilot** | Flies cross-country, often over unlandable terrain                | Verify glide-range safety margins over a route                       |

For the **MVP**, all personas share the same core need: **quickly replay and
inspect an IGC flight**.

---

## 5. Glossary & domain concepts

These terms come from the soaring domain and the VerifLocal user guide. They are
defined here so requirements can reference them precisely. Terms marked _(future)_
relate to phases beyond the MVP.

| Term                        | Definition                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IGC file**                | Standard glider flight-recorder log format (FAI/IGC). Contains fix records (`B` records) with UTC time, latitude, longitude, pressure altitude and GNSS altitude, plus headers (`H`), and optional extensions (e.g. ENL engine-noise level). |
| **LZ — Landing Zone**       | A place the glider can safely land: an airfield or a vetted outlanding field. _(future)_                                                                                                                                                     |
| **In local / Marginal / Out of local** | Three-way classification of the glider vs the *best* Landing Zone at each moment, based purely on the projected arrival height above LZ ground: `arrival > safety height` = **in local** (green); `0 < arrival ≤ safety height` = **marginal** (yellow); `arrival ≤ 0` = **out of local** (red). Applied to labels, escape path, and barogram track — one shared rule. _(future)_ |
| **Working L/D**             | The glide ratio used for the safety computation (not the glider's max L/D). VerifLocal default: **20** for IGC. _(future)_                                                                                                                   |
| **Safety arrival height**   | Minimum height above the LZ ground required on arrival to qualify as "in local". Boundary between marginal (yellow) and in-local (green). VerifLocal default: **300 m**. _(future)_                                                          |
| **Ground clearance**        | Minimum height above terrain to maintain along an escape path. Informational / display concept from VerifLocal (default **150 m**); does **not** gate the three-way status in Local Check — a mountain-clipping glide is visible in the escape-path profile chart, not through the barogram colour. _(future)_ |
| **Escape path**             | A computed straight or poly-line trajectory from a point on the track to a reachable LZ. _(future)_                                                                                                                                          |
| **Reachable zone**          | The full area reachable from the current point given L/D, wind and terrain. _(future)_                                                                                                                                                       |
| **Missing height**          | How much additional altitude would be needed to arrive at LZ ground level at a given point (0 = arrival at or above ground, i.e. reachable at least marginally). _(future)_                                                                    |
| **Barogram**                | Altitude-vs-time chart of the flight, color-coded to match the map track.                                                                                                                                                                    |
| **Time step**               | Interval at which the local check is computed along the track. VerifLocal default: **20 s** (min 10 s). _(future)_                                                                                                                           |
| **ENL / MOP**               | Engine Noise Level / Means Of Propulsion fields used to detect motor use in the IGC file.                                                                                                                                                    |
| **Difficulty tags**         | LZ classification embedded in `.cup` descriptions: `{A}` airfield, `{F}`/`{E}` easy, `{ZA}`/`{LA}` group of fields, `{M}` medium, `{D}` difficult, `{TD}`/`{VD}` very difficult. _(future)_                                                  |
| **AGL**                     | Height Above Ground Level (requires terrain elevation). _(future for terrain-derived AGL)_                                                                                                                                                   |
| **Total energy**            | Altitude corrected for kinetic energy, optionally used in glide computations. _(future)_                                                                                                                                                     |

---

## 6. Scope & phased roadmap

The product is delivered incrementally. **Only Phase 1 is committed as the MVP**;
later phases are the intended direction and are subject to re-prioritization.

### Phase 1 — MVP: Upload & Replay _(this release)_

Load a single IGC file and replay it: 2D map track + synchronized barogram +
playback controls + per-point telemetry + flight summary. No terrain, no
Landing Zone database, no "local" computation.

### Phase 2 — Local verification

Import Landing Zones (SeeYou `.cup`), integrate terrain elevation, compute
"in/out of local" continuously, color-code the track and barogram, show missing
height, and produce out-of-local statistics.

### Phase 3 — Escape paths & reachable zone

Display escape-path trajectories at sampled points, compute and
render the reachable zone, and show arrival heights over LZs.

### Phase 4 — Airspace, wind, reporting 

Airspace penetration detection, wind effect on glide and downloadable debrief
reports (per-flight summary).

---

## 7. Functional requirements — MVP (Phase 1)

Requirements are testable. IDs use `FR-M-x` for MVP.

### 7.1 IGC ingestion

- **FR-M-1 — File upload.** The user can load a `.igc` file via a file picker
  and via drag-and-drop onto the app.
- **FR-M-2 — Client-side parsing.** The file is parsed entirely in the browser;
  its contents are not transmitted to any server.
- **FR-M-3 — Parse B-records.** For each `B` record, extract UTC time, latitude,
  longitude, pressure altitude and GNSS altitude.
- **FR-M-4 — Parse headers.** Extract available `H` headers: date, pilot,
  glider type, glider registration/competition ID, and recorder info; display
  what is present and degrade gracefully when fields are missing.
- **FR-M-5 — Validation & errors.** Reject non-IGC/corrupt files with a clear,
  user-friendly message. Handle files with missing/partial fields without
  crashing (e.g., missing GNSS altitude, out-of-order timestamps, midnight
  rollover).
- **FR-M-6 — Reasonable size handling.** Parse a typical multi-hour flight
  (tens of thousands of fixes) within a couple of seconds on a modern laptop
  without freezing the UI.

### 7.2 Map & track

- **FR-M-7 — Map display.** Show the flight track as a polyline over a
  pannable/zoomable base map, auto-fitting the map to the track bounds on load.
- **FR-M-8 — Base map layers.** Provide at least one base map suitable for
  aviation debrief (e.g., topographic/terrain style) with attribution.
- **FR-M-9 — Glider marker.** Show the current replay position as a distinct
  marker on the track.
- **FR-M-10 — Hover to seek.** Hovering/clicking a point on the track moves the
  replay cursor to the corresponding time (bi-directional sync with barogram).

### 7.3 Barogram (altitude chart)

- **FR-M-11 — Altitude curve.** Plot altitude vs time for the whole flight
  (selectable source: pressure vs GNSS altitude, defaulting to a sensible
  choice).
- **FR-M-12 — Synchronized cursor.** A vertical time cursor is shown on the
  barogram and stays synchronized with the map marker during replay and manual
  seeking.
- **FR-M-13 — Baro interaction.** Hovering/clicking the barogram seeks the
  flight to that time and recenters/updates the map marker.

### 7.4 Replay controls

- **FR-M-14 — Transport controls.** Play, pause, and reset (return to start).
- **FR-M-15 — Playback speed.** Selectable speed multipliers (e.g., 1×, 2×, 4×,
  8×, 16×).
- **FR-M-16 — Scrub / timeline.** A draggable timeline/scrubber to jump to any
  moment; step forward/back by one fix.
- **FR-M-17 — Keyboard shortcuts.** Space = play/pause; Left/Right = step;
  Home = reset (shortcuts documented in the UI).

### 7.5 Telemetry & summary

- **FR-M-18 — Live point readout.** For the current replay time, display: UTC
  time, latitude/longitude, altitude (pressure & GNSS), ground speed, and
  vertical speed (vario) computed from consecutive fixes.
- **FR-M-19 — Flight summary panel.** Display overall flight info: date, pilot,
  glider, takeoff/landing time, total flight duration, max/min altitude, max
  ground speed, track distance, and number of fixes.
- **FR-M-20 — Units.** Default to **metric** (m, km, km/h, m/s). Unit system is
  designed to be switchable in a later phase (imperial/aussie), matching
  VerifLocal's supported unit sets.
- **FR-M-21 — Empty/initial state.** Before a file is loaded, show a clear call
  to action (upload/drag an IGC file) with brief help.

### 7.6 Internationalization scaffolding

- **FR-M-22 — i18n-ready.** UI strings are externalized so the app can be
  localized later (English first; French is a strong candidate given the target
  community).

---

## 8. Functional requirements — Future phases (summary)

These are intentionally high-level; each will be detailed in its own phase.

### 8.1 Phase 2 — Local verification

- **FR-2-1** Import one or more SeeYou `.cup` landing-zone files (airfields +
  outlanding fields), including difficulty tags `{A}{F}{M}{D}{TD}`; de-duplicate
  nearby points.
- **FR-2-2** Integrate terrain elevation (e.g., SRTM/OpenTopography-derived) to
  compute AGL and terrain-aware glides.
- **FR-2-3** Configurable computation parameters: working L/D (default 20),
  safety arrival height (default 300 m), ground clearance (default 150 m), time
  step (default 20 s).
- **FR-2-4** Continuously classify each sampled point as **in local** or **out
  of local** and compute **missing height**.
- **FR-2-5** Color-code the map track and barogram by status (see §9.3), and
  show out-of-local statistics (time and %, mean/max missing height).
- **FR-2-6** Detect tow/winch initial climb, final glide (sustained descent
  into the LZ), and motor use (ENL/MOP, threshold default 500) for correct
  coloring.

### 8.2 Phase 3 — Escape paths & reachable zone

- **FR-3-1** At sampled points, display the selected escape path to
  the best reachable LZ (straight or poly-line), with an altitude profile.
- **FR-3-2** Compute and render the reachable zone from a chosen point (grid
  method), with adjustable grid size.
- **FR-3-3** Show arrival heights over LZs.

### 8.3 Phase 4 — Airspace, wind & reporting

- **FR-4-1** Load and display airspace; detect penetration and report time spent
  inside zones.
- **FR-4-2** Optional wind effect on glide (manual entry or derived from drift),
  clearly marked as indicative.
- **FR-4-3** Generate a downloadable debrief report (summary of local status,
  out-of-local events with times/positions, statistics).

---

## 9. UX / UI requirements

### 9.1 Overall layout (seeyou.cloud-inspired)

- A primary **map** area and a **barogram** panel that are always visually
  linked by a shared time cursor.
- A **replay control bar** (play/pause, speed, timeline scrubber).
- An **information panel/sidebar** with the flight summary and the live
  per-point telemetry.
- Responsive layout: usable on desktop (primary) and tablet; graceful reflow on
  narrow screens.

### 9.2 Replay experience

- Smooth marker movement along the track during playback.
- Clicking/hovering either the map track or the barogram seeks the whole UI to
  that time (single source of truth for "current time").

### 9.3 Track/barogram color model (target, applied from Phase 2)

Aligned with VerifLocal's conventions so the community finds it familiar,
with one deliberate departure: the marginal (yellow) band is defined by
arrival vs safety height rather than a fixed "< 100 m above glide plane"
band, so all four surfaces (barogram, escape-path line, escape-path
profile, arrival-height labels) share one rule.

| Color  | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| Cyan   | Initial climb (tow / winch / motor)                                                                |
| Green  | In local — projected arrival at the best LZ is **> safety arrival height** above LZ ground        |
| Yellow | Marginal — arrival is above LZ ground **but** ≤ safety arrival height                              |
| Red    | Out of local — arrival is at or below LZ ground                                                    |
| Blue   | Final glide                                                                                        |
| Purple | Low-height flight (if detection enabled)                                                           |

Terrain-collision along the glide path does **not** gate the colour: it is
surfaced instead by the escape-path profile chart, which draws the glide
plane against the terrain slice below it.

For the **MVP**, the track uses a single neutral color (or an
altitude/vario gradient) since "local" is not yet computed; the color model
above is introduced in Phase 2.

### 9.4 Accessibility & clarity

- Sufficient color contrast; do not rely on color alone to convey status
  (pair with labels/legend).
- Keyboard operability for the core replay controls (see FR-M-17).
- Persistent legend and an always-reachable safety disclaimer.

---

## 10. Non-functional requirements

- **NFR-1 — Privacy / client-side.** IGC parsing and MVP analysis run in the
  browser; no flight data leaves the device unless a future feature explicitly
  requires it (with clear consent).
- **NFR-2 — Performance.** Load & render a typical multi-hour flight (tens of
  thousands of fixes) in ≲ 2 s; keep replay at a smooth frame rate (target
  ~30–60 fps for marker updates) without blocking the UI thread.
- **NFR-3 — Browser support.** Latest 2 versions of major evergreen browsers
  (Chrome, Firefox, Safari, Edge).
- **NFR-4 — Reliability.** Malformed input never crashes the app; errors are
  caught and reported.
- **NFR-5 — Maintainability.** Clear separation between IGC parsing, domain/
  analysis logic, and UI so later phases can add computation without rewriting
  the UI.
- **NFR-6 — Internationalization.** All user-facing strings externalized.
- **NFR-7 — Offline-friendly (goal).** After initial load, replay of an
  already-loaded flight should work without network (base-map tiles permitting).
- **NFR-8 — Licensing.** Respect the MIT license of this repo and third-party
  data/library licenses (map tiles, elevation data, `.cup` sources).

---

## 11. Data & external dependencies

| Dependency            | Purpose                                                                | Phase     | Notes                                                                 |
| --------------------- | ---------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| **IGC format**        | Flight track input                                                     | MVP       | FAI/IGC B-record + headers; only IGC is supported (no Condor `.ftr`). |
| **Map tiles**         | Base map for the track                                                 | MVP       | Choose a provider with terms suitable for the use case + attribution. |
| **Charting**          | Barogram rendering                                                     | MVP       | Altitude/time chart with synchronized cursor.                         |
| **SeeYou `.cup`**     | Landing Zone database (airfields + outlanding fields, difficulty tags) | Phase 2   | e.g., FFVP `guide_aires_securite.cup`, planeur-net/outlanding.        |
| **Terrain elevation** | AGL & terrain-aware glide / reachable zone                             | Phase 2–3 | e.g., SRTM / OpenTopography-derived data.                             |
| **Airspace data**     | Airspace penetration detection                                         | Phase 4   | Standard airspace file format.                                        |

---

## 12. Technical considerations (non-binding guidance)

- **Architecture.** A client-side single-page web application. The MVP needs
  **no backend, no database, and no elevation service** — everything runs in the
  browser.
- **Module boundaries.** (1) IGC parser → normalized flight model; (2) analysis/
  domain layer (empty-ish for MVP, home of "local" computation later); (3) UI
  (map, barogram, controls, panels). This keeps Phase 2+ computation additive.
- **Suggested building blocks.** A mapping library for the track, a charting
  approach for the barogram, and a lightweight state model for "current replay
  time" shared by map and barogram. (Specific libraries to be chosen at
  implementation time.)
- **Vertical speed / ground speed.** Derived from consecutive fixes; smoothing
  may be applied for display.
- **Time handling.** IGC times are UTC; handle midnight rollover and
  non-monotonic timestamps defensively.

---

## 13. Success metrics

- **M1** — A user can go from "open app" to "replaying a loaded IGC flight" in
  under ~30 seconds, with no configuration.
- **M2** — Common real-world IGC files (varied recorders/gliders) parse
  successfully without errors (target ≥ 95% of a representative test set).
- **M3** — Telemetry (altitude, ground speed, vario) matches reference tools
  within an acceptable tolerance on sample flights.
- **M4** — Replay is smooth (no perceptible stutter) on a typical multi-hour
  flight on a mid-range laptop.

---

## 14. Risks, assumptions & mitigations

| #   | Risk / assumption                                        | Impact                   | Mitigation                                                                     |
| --- | -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| R1  | Users may treat results as authoritative safety guidance | Safety/liability         | Prominent, persistent disclaimer; "indicative only" wording; no real-time use. |
| R2  | IGC glider-type field is often unreliable                | Wrong L/D later          | Default working L/D 20; let the user override (Phase 2).                       |
| R3  | Terrain elevation accuracy/coverage varies               | Local computation errors | Document data source/resolution; keep safety margins; clearly future-phase.    |
| R4  | Wind/aerology not modeled                                | Over-optimistic glide    | Wind optional and flagged "indicative"; default to no wind (per VerifLocal).   |
| R5  | Large IGC files could freeze the UI                      | Poor UX                  | Efficient parsing, off-main-thread work if needed, progress feedback.          |
| R6  | Map tile / data licensing constraints                    | Legal                    | Use providers with compatible terms; show attribution.                         |
| A1  | MVP intentionally excludes "local" computation           | Scope clarity            | Explicitly documented; keeps first release small and shippable.                |

---

## 15. Open questions

1. Which base-map provider(s) best fit the target community and licensing?
2. Preferred default altitude source for the barogram — pressure or GNSS?
3. Should the MVP already offer a French UI, or English-only with i18n
   scaffolding (French later)?
4. For Phase 2, which Landing Zone datasets ship by default (e.g., FFVP guide,
   planeur-net/outlanding)?
5. Terrain data source & delivery for Phase 2–3 (bundled tiles vs. on-demand
   service)?

---

## 16. Appendix

### 16.1 Default computation parameters (from VerifLocal, for future phases)

| Parameter             | Default  | Notes                                                |
| --------------------- | -------- | ---------------------------------------------------- |
| Working L/D           | 20       | For IGC; ~half of max L/D if glider type is trusted. |
| Safety arrival height | 300 m    | Boundary between the marginal (yellow) and in-local (green) bands. |
| Ground clearance      | 150 m    | Informational / display only. Does not gate the three-way status.  |
| Time step             | 20 s     | Local check interval (min 10 s).                     |
| ENL threshold         | 500      | Motor-run detection.                                 |
| Reachable-zone grid   | 90–720 m | Grid cell size for reachable-zone computation.       |

### 16.2 References

- VerifLocal V4.1 — User Guide (Marc Till), `spike/VerifLocal_FR.pdf`.
- seeyou.cloud flight viewer — UX reference: <https://seeyou.cloud/>.
- SeeYou `.cup` waypoint format and outlanding difficulty tags —
  <https://github.com/planeur-net/outlanding>.
- FAI/IGC flight-recorder file format specification.
- OpenTopography — elevation data (non-commercial use): <https://opentopography.org>.

---

_This is a living document. Sections marked "future" describe intended direction
and are subject to change as phases are planned in detail._
