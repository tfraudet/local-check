import { useEffect, useRef, useState } from 'react';
import {
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  Popup,
  LngLatBounds,
  type GeoJSONSource,
  type LngLat,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useFlightStore, findCurrentFixIndex } from '../state/useFlightStore';
import type { NormalizedFlight } from '../domain/flight';
import type { SampledPoint } from '../domain/localCheck';
import type { LandingZone } from '../domain/landingZone';
import { DIFFICULTY_LEVEL_COLOR } from '../domain/landingZone';

const DEFAULT_MAP_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty';

const TRACK_SOURCE_ID = 'flight-track';
const TRACK_LAYER_ID = 'flight-track-line';
const LZ_SOURCE_ID = 'landing-zones';
const LZ_LAYER_ICON = 'lz-icons';
const LZ_LAYER_LABEL = 'lz-labels';

// Icon image IDs registered via map.addImage; referenced by icon-image on the
// LZ symbol layer.
const LZ_ICON_SOLID = 'lz-icon-solid'; // SeeYou style 5 — solid airfield
const LZ_ICON_GRASS = 'lz-icon-grass'; // SeeYou style 2 — grass airfield
const LZ_ICON_RECT: Record<string, string> = {
  green: 'lz-icon-rect-green',
  orange: 'lz-icon-rect-orange',
  red: 'lz-icon-rect-red',
  black: 'lz-icon-rect-black',
};

// The bar-heading placeholder (`H` in the request) is baked to 0° — we
// don't currently track runway heading on the LandingZone shape.

const SOLID_AIRFIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="8.5" fill="#3E6FC4"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#fff" stroke-width="8" transform="rotate(0 16 16)"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#3E6FC4" stroke-width="5" transform="rotate(0 16 16)"/>
</svg>`;

const GRASS_AIRFIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="7.2" fill="#fff" stroke="#5B6470" stroke-width="3.6"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#fff" stroke-width="6" transform="rotate(0 16 16)"/>
  <line x1="16" y1="1" x2="16" y2="31" stroke="#5B6470" stroke-width="4" transform="rotate(0 16 16)"/>
</svg>`;

function squareSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="20">
    <rect x="2" y="2" width="28" height="28" rx="2.5" ry="2.5" fill="${fill}" stroke="#ffffff" stroke-width="2.5"/>
  </svg>`;
}

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Register all LZ icons on the map. Idempotent — safe to call multiple times. */
async function preloadLzIcons(map: MaplibreMap): Promise<void> {
  const entries: Array<[string, string]> = [
    [LZ_ICON_SOLID, SOLID_AIRFIELD_SVG],
    [LZ_ICON_GRASS, GRASS_AIRFIELD_SVG],
    [LZ_ICON_RECT.green, squareSvg(DIFFICULTY_LEVEL_COLOR.green)],
    [LZ_ICON_RECT.orange, squareSvg(DIFFICULTY_LEVEL_COLOR.orange)],
    [LZ_ICON_RECT.red, squareSvg(DIFFICULTY_LEVEL_COLOR.red)],
    [LZ_ICON_RECT.black, squareSvg(DIFFICULTY_LEVEL_COLOR.black)],
  ];
  await Promise.all(
    entries.map(async ([id, svg]) => {
      if (map.hasImage(id)) return;
      const img = await svgToImage(svg);
      // pixelRatio 2 → the 32-unit SVG lands at ~16 CSS pixels on screen and
      // stays crisp on hi-DPI displays.
      if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 2 });
    }),
  );
}

const DEFAULT_CENTER: [number, number] = [3.2489, 45.5401];
const DEFAULT_ZOOM = 11;

// Phase/status → hex color (matches ColorLegend)
const STATUS_COLORS: Record<string, string> = {
  'initial-climb': '#22d3ee', // cyan-400
  motor: '#0891b2', // cyan-600
  'in-local': '#22c55e', // green-500
  'in-local-marginal': '#eab308', // yellow-400
  'out-of-local': '#ef4444', // red-500
  'landing-circuit': '#3b82f6', // blue-500
  default: '#2563eb', // blue-600 (no local check result)
};

function getSegmentColor(phase: string, status: string): string {
  if (phase === 'initial-climb') return STATUS_COLORS['initial-climb'];
  if (phase === 'motor') return STATUS_COLORS['motor'];
  if (phase === 'landing-circuit') return STATUS_COLORS['landing-circuit'];
  if (status === 'out-of-local') return STATUS_COLORS['out-of-local'];
  if (status === 'in-local-marginal') return STATUS_COLORS['in-local-marginal'];
  if (status === 'in-local') return STATUS_COLORS['in-local'];
  return STATUS_COLORS['default'];
}

/**
 * Build a GeoJSON FeatureCollection of colored line segments from the fixes
 * and local-check samples. Consecutive fixes with the same color are merged
 * into a single LineString feature.
 */
function buildColoredTrackGeoJSON(
  flight: NormalizedFlight,
  samples: SampledPoint[] | null,
): GeoJSON.FeatureCollection {
  const fixes = flight.fixes;
  if (!samples || samples.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: STATUS_COLORS['default'] },
          geometry: {
            type: 'LineString',
            coordinates: fixes.map((f) => [f.longitude, f.latitude]),
          },
        },
      ],
    };
  }

  // Build a per-fix color array by assigning each fix the color of the
  // nearest sample (by time, using a sliding pointer for efficiency).
  const colors: string[] = new Array(fixes.length).fill(STATUS_COLORS['default']);
  let sampleIdx = 0;
  for (let i = 0; i < fixes.length; i++) {
    while (
      sampleIdx < samples.length - 1 &&
      Math.abs(samples[sampleIdx + 1].timeMs - fixes[i].timeMs) <
        Math.abs(samples[sampleIdx].timeMs - fixes[i].timeMs)
    ) {
      sampleIdx++;
    }
    const s = samples[sampleIdx];
    colors[i] = getSegmentColor(s.phase, s.status);
  }

  // Group consecutive fixes with the same color into segments.
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  let segStart = 0;
  let segColor = colors[0];

  for (let i = 1; i <= fixes.length; i++) {
    const color = i < fixes.length ? colors[i] : null;
    if (color !== segColor || i === fixes.length) {
      if (i - segStart >= 2) {
        features.push({
          type: 'Feature',
          properties: { color: segColor },
          geometry: {
            type: 'LineString',
            coordinates: fixes.slice(segStart, i).map((f) => [f.longitude, f.latitude]),
          },
        });
      }
      segStart = i - 1; // overlap by 1 to avoid gaps
      segColor = color ?? segColor;
    }
  }

  return { type: 'FeatureCollection', features };
}

const LZ_STYLE_LABEL: Record<number, string> = {
  0: 'Unknown',
  1: 'Waypoint',
  2: 'Grass airfield',
  3: 'Outlanding Field',
  4: 'Gliding Airfield',
  5: 'Solid Airfield',
  6: 'Moutain Pass',
  7: 'Mountain Top',
  8: 'Transmitter Mast',
  9: 'VOR',
  10: 'NDB',
  11: 'Cooling Tower',
  12: 'Dam',
  13: 'Tunnel',
  14: 'Bridge',
  15: 'Power Plant',
  16: 'Castle',
  17: 'Intersection',
};

const LZ_SOURCE_LABEL: Record<string, string> = {
  user: 'User import',
  'outlanding-alps': 'Alpes outlanding DB',
  'outlanding-auvergne': 'Auvergne outlanding DB',
  openaip: 'OpenAIP',
};

/** Escape a value for safe inclusion in an HTML string. */
function escHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildLzPopupHtml(
  props: GeoJSON.GeoJsonProperties | null | undefined,
): string {
  if (!props) return '';
  const p = props as Record<string, unknown>;
  const name = escHtml(p.name);
  const code = p.code ? escHtml(p.code) : '';
  const level = String(p.difficulty_level ?? 'green');
  const color =
    DIFFICULTY_LEVEL_COLOR[level as keyof typeof DIFFICULTY_LEVEL_COLOR] ??
    DIFFICULTY_LEVEL_COLOR.green;
  const isAirfield = p.isAirfield === true || p.isAirfield === 'true';
  const styleN = typeof p.style === 'number' ? p.style : null;
  const styleLabel = styleN !== null ? (LZ_STYLE_LABEL[styleN] ?? `Style ${styleN}`) : '';
  const sourceLabel = LZ_SOURCE_LABEL[String(p.source)] ?? String(p.source);
  const elev =
    typeof p.elevationM === 'number' ? `${Math.round(p.elevationM)} m` : '';
  const lat = typeof p.latitude === 'number' ? p.latitude.toFixed(4) : '';
  const lon = typeof p.longitude === 'number' ? p.longitude.toFixed(4) : '';
  const desc = p.description ? escHtml(p.description) : '';

  const chip = (bg: string, text: string, fg = '#ffffff') =>
    `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:${bg};color:${fg};font-size:10px;font-weight:600;">${text}</span>`;

  const chips: string[] = [];
  chips.push(chip(color, level.toUpperCase()));
  if (isAirfield) chips.push(chip('#3b82f6', 'AIRFIELD'));
  else chips.push(chip('#64748b', 'OUTLANDING FIELD'));

  const row = (label: string, value: string) =>
    `<b style="color:#64748b;font-weight:500;">${label}</b><span>${value}</span>`;
  const rows: string[] = [];
  if (code) rows.push(row('Code', code));
  if (styleLabel) rows.push(row('Type', escHtml(styleLabel)));
  if (elev) rows.push(row('Elevation', elev));
  if (lat && lon) rows.push(row('Position', `${lat}°, ${lon}°`));
  rows.push(row('Source', escHtml(sourceLabel)));

  return `
    <div style="font-family:inherit;color:#1e293b;font-size:12px;line-height:1.35;">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${name}</div>
      <div style="display:flex;gap:4px;margin-bottom:6px;">${chips.join('')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;column-gap:8px;row-gap:2px;">
        ${rows.join('')}
      </div>
      ${desc ? `<div style="margin-top:6px;color:#475569;">${desc}</div>` : ''}
    </div>
  `;
}

function buildLzGeoJSON(
  zones: LandingZone[],
  visibleIds: Set<string>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter((z) => visibleIds.has(z.id))
      .map((z) => ({
        type: 'Feature' as const,
        properties: {
          id: z.id,
          name: z.name,
          code: z.code ?? '',
          isAirfield: z.isAirfield,
          difficulty_level: z.difficulty_level,
          elevationM: z.elevationM ?? '',
          style: z.style ?? '',
          description: z.description ?? '',
          source: z.source,
          latitude: z.latitude,
          longitude: z.longitude,
          runwayHeading: z.runwayHeading,
          color: DIFFICULTY_LEVEL_COLOR[z.difficulty_level],
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [z.longitude, z.latitude],
        },
      })),
  };
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const lzPopupRef = useRef<Popup | null>(null);
  const mapReadyRef = useRef(false);

  const [iconsReady, setIconsReady] = useState(false);

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const setVisibleBounds = useFlightStore((s) => s.setVisibleBounds);

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: DEFAULT_MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl(), 'top-right');
    mapRef.current = map;

    const publishBounds = () => {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      setVisibleBounds([sw.lng, sw.lat, ne.lng, ne.lat]);
    };

    map.once('load', () => {
      mapReadyRef.current = true;
      publishBounds();
      void preloadLzIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] LZ icon preload failed:', err));
    });
    map.on('moveend', publishBounds);

    return () => {
      map.off('moveend', publishBounds);
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      setIconsReady(false);
    };
  }, [setVisibleBounds]);

  // Load/replace the track whenever the flight or local-check result changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight) return;

    const samples = localCheckResult?.samples ?? null;
    const geojson = buildColoredTrackGeoJSON(flight, samples);

    const applyTrack = () => {
      const source = map.getSource(TRACK_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
        // Update line-color expression after data change
        map.setPaintProperty(TRACK_LAYER_ID, 'line-color', [
          'get',
          'color',
        ]);
      } else {
        map.addSource(TRACK_SOURCE_ID, { type: 'geojson', data: geojson });
        map.addLayer({
          id: TRACK_LAYER_ID,
          type: 'line',
          source: TRACK_SOURCE_ID,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
          },
        });
        map.on('mousemove', TRACK_LAYER_ID, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', TRACK_LAYER_ID, () => {
          map.getCanvas().style.cursor = '';
        });
        map.on('click', TRACK_LAYER_ID, (e: MapLayerMouseEvent) => {
          if (e.lngLat) seekToNearestFix(flight, e.lngLat, seek);
        });
        map.on('mousemove', TRACK_LAYER_ID, (e: MapLayerMouseEvent) => {
          if (e.lngLat) seekToNearestFix(flight, e.lngLat, seek);
        });
      }

      // Only fit bounds when the track is first added (no localCheckResult yet),
      // not on every recolor — that would reset the user's map position.
      if (!localCheckResult) {
        const coordinates = flight.fixes.map((f) => [f.longitude, f.latitude]);
        const bounds = coordinates.reduce(
          (b, coord) => b.extend(coord as [number, number]),
          new LngLatBounds(
            coordinates[0] as [number, number],
            coordinates[0] as [number, number],
          ),
        );
        map.fitBounds(expandBoundsKm(bounds, 10), { padding: 40, duration: 0 });
      }

      if (!markerRef.current) {
        const el = document.createElement('div');
        el.className =
          'h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow';
        markerRef.current = new Marker({ element: el }).setLngLat([
          flight.fixes[0].longitude,
          flight.fixes[0].latitude,
        ]);
        markerRef.current.addTo(map);
      }
    };

    if (map.isStyleLoaded()) {
      applyTrack();
    } else {
      map.once('load', applyTrack);
    }
  }, [flight, seek, localCheckResult]);

  // LZ symbol layer — rebuild whenever the zones or visibility changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !iconsReady) return;

    const lzGeoJSON = buildLzGeoJSON(landingZones, visibleLandingZoneIds);

    const applyLzLayer = () => {
      const source = map.getSource(LZ_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(lzGeoJSON);
      } else {
        map.addSource(LZ_SOURCE_ID, { type: 'geojson', data: lzGeoJSON });
        map.addLayer({
          id: LZ_LAYER_ICON,
          type: 'symbol',
          source: LZ_SOURCE_ID,
          layout: {
            // style 5 → solid disc-and-bar; style 2 → grass ring-and-bar;
            // everything else → a colored rectangle per difficulty.
            'icon-image': [
              'case',
              ['==', ['get', 'style'], 5],
              LZ_ICON_SOLID,
              ['==', ['get', 'style'], 2],
              LZ_ICON_GRASS,
              [
                'match',
                ['get', 'difficulty_level'],
                'green',
                LZ_ICON_RECT.green,
                'orange',
                LZ_ICON_RECT.orange,
                'red',
                LZ_ICON_RECT.red,
                'black',
                LZ_ICON_RECT.black,
                LZ_ICON_RECT.green,
              ],
            ],
            'icon-anchor': 'center',
            // Type 5 and 2 airfields render bigger than the other icons
            // so they read as the primary landing options at a glance.
            'icon-size': [
              'case',
              [
                'any',
                ['==', ['get', 'style'], 5],
                ['==', ['get', 'style'], 2],
              ],
              2,
              1.6,
            ],
            // Rotate only the airfield icons (solid/grass) so the bar
            // aligns with the runway. Rectangles stay upright.
            'icon-rotate': [
              'case',
              [
                'any',
                ['==', ['get', 'style'], 5],
                ['==', ['get', 'style'], 2],
              ],
              ['get', 'runwayHeading'],
              0,
            ],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
        map.addLayer({
          id: LZ_LAYER_LABEL,
          type: 'symbol',
          source: LZ_SOURCE_ID,
          // Only show labels once zoomed in enough — with 100+ LZs, drawing
          // every name at low zoom is unreadable and 404s glyph ranges.
          minzoom: 10,
          layout: {
            'text-field': ['get', 'name'],
            // Pin the font stack to one the OpenFreeMap tile server actually
            // ships (otherwise MapLibre falls back to
            // "Open Sans Regular,Arial Unicode MS Regular" and 404s).
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-offset': [0, 1.8],
            'text-anchor': 'top',
            'text-optional': true,
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          },
        });
        if (!lzPopupRef.current) {
          lzPopupRef.current = new Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
            className: 'lz-popup',
            maxWidth: '280px',
          });
        }
        const popup = lzPopupRef.current;
        map.on('mouseenter', LZ_LAYER_ICON, (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const feature = e.features?.[0];
          if (!feature) return;
          const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
            number,
            number,
          ];
          popup.setLngLat(coords).setHTML(buildLzPopupHtml(feature.properties)).addTo(map);
        });
        map.on('mousemove', LZ_LAYER_ICON, (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
            number,
            number,
          ];
          popup.setLngLat(coords).setHTML(buildLzPopupHtml(feature.properties));
        });
        map.on('mouseleave', LZ_LAYER_ICON, () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });
      }
    };

    if (map.isStyleLoaded()) {
      applyLzLayer();
    } else {
      map.once('load', applyLzLayer);
    }
  }, [landingZones, visibleLandingZoneIds, iconsReady]);

  // Move the glider marker on every currentTimeMs change.
  useEffect(() => {
    if (!flight || !markerRef.current) return;
    const position = interpolatePosition(flight, currentTimeMs);
    if (position) markerRef.current.setLngLat(position);
  }, [flight, currentTimeMs]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function interpolatePosition(
  flight: NormalizedFlight,
  timeMs: number,
): [number, number] | null {
  const index = findCurrentFixIndex(flight, timeMs);
  if (index < 0) return null;
  const current = flight.fixes[index];
  const next = flight.fixes[index + 1];
  if (!next) return [current.longitude, current.latitude];

  const span = next.timeMs - current.timeMs;
  const ratio = span > 0 ? (timeMs - current.timeMs) / span : 0;
  const lon = current.longitude + (next.longitude - current.longitude) * ratio;
  const lat = current.latitude + (next.latitude - current.latitude) * ratio;
  return [lon, lat];
}

function expandBoundsKm(bounds: LngLatBounds, km: number): LngLatBounds {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const centerLat = (sw.lat + ne.lat) / 2;
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((centerLat * Math.PI) / 180));
  return new LngLatBounds(
    [sw.lng - dLon, sw.lat - dLat],
    [ne.lng + dLon, ne.lat + dLat],
  );
}

function seekToNearestFix(
  flight: NormalizedFlight,
  lngLat: LngLat,
  seek: (timeMs: number) => void,
): void {
  let nearestIndex = 0;
  let nearestDistSq = Infinity;
  for (let i = 0; i < flight.fixes.length; i++) {
    const fix = flight.fixes[i];
    const dLon = fix.longitude - lngLat.lng;
    const dLat = fix.latitude - lngLat.lat;
    const distSq = dLon * dLon + dLat * dLat;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestIndex = i;
    }
  }
  seek(flight.fixes[nearestIndex].timeMs);
}
