# Local Check

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

A specialized safety and post-flight analysis tool for glider pilots and soaring clubs. **Local Check** verifies whether a pilot remained within safe gliding distance (local range) of an airfield or a designated outlanding field throughout their entire flight.


---

## 🎯 Core Objective

Safety is paramount in soaring. This tool processes `.IGC` flight logs to automatically audit track logs against predefined landing options (airfields and verified outlanding fields/fields suitable for landouts).

It helps flight instructors, safety officers, and pilots answer critical safety questions:
* Did the pilot stay within safe gliding range ($L/D$) of a suitable landing spot at all times?
* Were safety margins (minimum arrival altitudes) respected before leaving a thermal or gliding between zones?
* Did any part of the flight enter an "out-of-glide" red zone?

---

## ✨ Features

* **IGC Parsing:** Fast, client-side parsing of standard GPS/pressure flight records.
* **Dynamic Safety Cone / Local Calculator:** Calculates continuous real-time glide range based on altitude, terrain, wind drift, and glider polar ($L/D$).
* **Outlanding Field Database Integration:** Import club waypoints, airfields, and vetted outlanding fields (`.cup`, `.wpt`, `.geojson`).
* **Out-of-Local Alerting & Auditing:** Automatically flags flight segments where the glider breached safety boundaries or lacked sufficient altitude to reach a safe landing area.
* **Margin & Altitude Heatmaps:** Color-coded 2D/3D track analysis showing safe arrival altitude margins throughout the flight.
* **Debrief & Club Compliance Reports:** Generate quick safety reports for club flight debriefs and solo progression validation.