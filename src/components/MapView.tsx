import { useEffect, useRef } from 'react';
import {
  Map as MaplibreMap,
  Marker,
  NavigationControl,
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
const LZ_LAYER_CIRCLE = 'lz-circles';
const LZ_LAYER_LABEL = 'lz-labels';

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

function buildLzGeoJSON(
  zones: LandingZone[],
  visibleIds: Set<string>,
  showOutlandingFields: boolean,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter((z) => visibleIds.has(z.id))
      .filter((z) => showOutlandingFields || z.source !== 'outlanding-alps')
      .map((z) => ({
        type: 'Feature' as const,
        properties: {
          id: z.id,
          name: z.name,
          code: z.code ?? '',
          isAirfield: z.isAirfield,
          difficulty_level: z.difficulty_level,
          elevationM: z.elevationM ?? '',
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
  const mapReadyRef = useRef(false);

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const showOutlandingFields = useFlightStore((s) => s.showOutlandingFields);

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

    map.once('load', () => {
      mapReadyRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

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
    if (!map) return;

    const lzGeoJSON = buildLzGeoJSON(
      landingZones,
      visibleLandingZoneIds,
      showOutlandingFields,
    );

    const applyLzLayer = () => {
      const source = map.getSource(LZ_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(lzGeoJSON);
      } else {
        map.addSource(LZ_SOURCE_ID, { type: 'geojson', data: lzGeoJSON });
        map.addLayer({
          id: LZ_LAYER_CIRCLE,
          type: 'circle',
          source: LZ_SOURCE_ID,
          paint: {
            'circle-radius': ['case', ['get', 'isAirfield'], 8, 6],
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.85,
          },
        });
        map.addLayer({
          id: LZ_LAYER_LABEL,
          type: 'symbol',
          source: LZ_SOURCE_ID,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 10,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          },
        });
        map.on('mouseenter', LZ_LAYER_CIRCLE, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', LZ_LAYER_CIRCLE, () => {
          map.getCanvas().style.cursor = '';
        });
      }
    };

    if (map.isStyleLoaded()) {
      applyLzLayer();
    } else {
      map.once('load', applyLzLayer);
    }
  }, [landingZones, visibleLandingZoneIds, showOutlandingFields]);

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
