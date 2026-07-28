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

const DEFAULT_MAP_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty';

const TRACK_SOURCE_ID = 'flight-track';
const TRACK_LAYER_ID = 'flight-track-line';

/** Default map center shown before any flight is loaded: Issoire, France
 * (a well-known soaring hub near the Massif Central / Puy-de-Dôme). */
const DEFAULT_CENTER: [number, number] = [3.2489, 45.5401];
const DEFAULT_ZOOM = 11;

/**
 * Renders the flight track on a MapLibre GL map: a GeoJSON LineString layer
 * fit to bounds on load, a glider marker interpolated between the two
 * nearest fixes on every `currentTimeMs` change, and hover/click-to-seek
 * on the track (FR-M-7, FR-M-8, FR-M-9, FR-M-10).
 */
export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const seek = useFlightStore((s) => s.seek);

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

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load/replace the track whenever the flight changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight) return;

    const coordinates = flight.fixes.map((f) => [f.longitude, f.latitude]);
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates },
    };

    const applyTrack = () => {
      const source = map.getSource(TRACK_SOURCE_ID) as
        GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
      } else {
        map.addSource(TRACK_SOURCE_ID, { type: 'geojson', data: geojson });
        map.addLayer({
          id: TRACK_LAYER_ID,
          type: 'line',
          source: TRACK_SOURCE_ID,
          paint: {
            'line-color': '#2563eb',
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

      const bounds = coordinates.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new LngLatBounds(
          coordinates[0] as [number, number],
          coordinates[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: 40, duration: 0 });

      if (!markerRef.current) {
        const el = document.createElement('div');
        el.className =
          'h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow';
        markerRef.current = new Marker({ element: el }).setLngLat(
          coordinates[0] as [number, number],
        );
        markerRef.current.addTo(map);
      }
    };

    if (map.isStyleLoaded()) {
      applyTrack();
    } else {
      map.once('load', applyTrack);
    }
  }, [flight, seek]);

  // Move the marker on every currentTimeMs change, interpolating between
  // the two nearest fixes for smooth motion during playback.
  useEffect(() => {
    if (!flight || !markerRef.current) return;
    const position = interpolatePosition(flight, currentTimeMs);
    if (position) markerRef.current.setLngLat(position);
  }, [flight, currentTimeMs]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function interpolatePosition(
  flight: NonNullable<ReturnType<typeof useFlightStore.getState>['flight']>,
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

function seekToNearestFix(
  flight: NonNullable<ReturnType<typeof useFlightStore.getState>['flight']>,
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
