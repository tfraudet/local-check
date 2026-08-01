import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  Popup,
  LngLatBounds,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
import { STATUS_COLORS } from '../domain/phaseColors';
import {
  useArrivalHeightFeatures,
  useCurrentEscapePath,
} from '../hooks/useEscapeTargets';
import {
  ARRIVAL_LABEL_LAYER,
  ARRIVAL_SOURCE_ID,
  ESCAPE_HALO_LAYER,
  ESCAPE_LINE_LAYER,
  ESCAPE_SOURCE_ID,
  LZ_LAYER_ICON,
  LZ_LAYER_LABEL,
  LZ_SOURCE_ID,
  RZ_FILL_LAYER,
  RZ_OUTLINE_LAYER,
  RZ_SOURCE_ID,
  TRACK_LAYER_ID,
  TRACK_SOURCE_ID,
} from './map/layerIds';
import {
  ARRIVAL_PILL_ICON,
  LZ_ICON_GRASS,
  LZ_ICON_RECT,
  LZ_ICON_SOLID,
  preloadMapIcons,
} from './map/icons';
import {
  buildArrivalHeightsGeoJSON,
  buildColoredTrackGeoJSON,
  buildEscapePathGeoJSON,
  buildLzGeoJSON,
  buildReachableZoneGeoJSON,
} from './map/geojson';
import { buildLzPopupHtml } from './map/lzPopup';
import { useGeoJsonLayer } from './map/useGeoJsonLayer';
import { useLatestRef } from '@/hooks/useLatestRef';
import { interpolatePosition, nearestFixTimeMs } from './map/trackGeometry';

const DEFAULT_MAP_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty';

const DEFAULT_CENTER: [number, number] = [3.2489, 45.5401];
const DEFAULT_ZOOM = 11;

/**
 * Auto-pan trigger: fraction of the viewport width/height that acts as a
 * "safe band" margin. When the glider's projected screen position enters
 * this outer band on any side, the map centre is nudged by the same
 * fraction of the corresponding dimension to re-centre the glider.
 */
const AUTO_PAN_MARGIN_FRACTION = 0.2;

/** `style` codes rendered with the dedicated airfield icons. */
const AIRFIELD_STYLE_MATCH: ExpressionSpecification = [
  'any',
  ['==', ['get', 'style'], 5],
  ['==', ['get', 'style'], 2],
];

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function MapView() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const mapReadyRef = useRef(false);

  const [iconsReady, setIconsReady] = useState(false);

  const flight = useFlightStore((s) => s.flight);
  const currentTimeMs = useFlightStore((s) => s.currentTimeMs);
  const seek = useFlightStore((s) => s.seek);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleLandingZoneIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const setVisibleBounds = useFlightStore((s) => s.setVisibleBounds);
  const showReachableZone = useFlightStore((s) => s.showReachableZone);
  const reachableZoneResult = useFlightStore((s) => s.reachableZoneResult);

  const escapePath = useCurrentEscapePath();
  const arrivalHeightFeatures = useArrivalHeightFeatures();

  // ---- Map lifecycle ----

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
      void preloadMapIcons(map)
        .then(() => setIconsReady(true))
        .catch((err) => console.warn('[map] icon preload failed:', err));
    });
    map.on('moveend', publishBounds);

    return () => {
      map.off('moveend', publishBounds);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      mapReadyRef.current = false;
      setIconsReady(false);
    };
  }, [setVisibleBounds]);

  // ---- Overlays ----

  const trackGeoJSON = useMemo(
    () =>
      flight
        ? buildColoredTrackGeoJSON(flight, localCheckResult?.samples ?? null)
        : EMPTY_FEATURE_COLLECTION,
    [flight, localCheckResult],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: TRACK_SOURCE_ID,
    data: trackGeoJSON,
    enabled: flight !== null,
    addLayers: (map) => {
      map.addLayer({
        id: TRACK_LAYER_ID,
        type: 'line',
        source: TRACK_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
        },
      });
      map.on('mouseleave', TRACK_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
      const seekToPointer = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const current = useFlightStore.getState().flight;
        if (!current || !e.lngLat) return;
        seek(nearestFixTimeMs(current, e.lngLat.lng, e.lngLat.lat));
      };
      map.on('click', TRACK_LAYER_ID, seekToPointer);
      map.on('mousemove', TRACK_LAYER_ID, seekToPointer);
    },
  });

  const lzGeoJSON = useMemo(
    () => buildLzGeoJSON(landingZones, visibleLandingZoneIds),
    [landingZones, visibleLandingZoneIds],
  );

  // `t` is read through a ref inside the popup handlers so changing the
  // language doesn't force the layer to be rebuilt.
  const translateRef = useLatestRef(t);

  useGeoJsonLayer(mapRef, {
    sourceId: LZ_SOURCE_ID,
    data: lzGeoJSON,
    enabled: iconsReady,
    addLayers: (map) => {
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
          // Airfields render bigger than the other icons so they read as
          // the primary landing options at a glance.
          'icon-size': ['case', AIRFIELD_STYLE_MATCH, 2, 1.6],
          // Rotate only the airfield icons so the bar aligns with the
          // runway. Rectangles stay upright.
          'icon-rotate': [
            'case',
            AIRFIELD_STYLE_MATCH,
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

      const popup = new Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'lz-popup',
        maxWidth: '280px',
      });

      const showPopup = (e: MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = e.features?.[0];
        if (!feature) return;
        const coords = (
          feature.geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(buildLzPopupHtml(feature.properties, translateRef.current))
          .addTo(map);
      };

      map.on('mouseenter', LZ_LAYER_ICON, showPopup);
      map.on('mousemove', LZ_LAYER_ICON, showPopup);
      map.on('mouseleave', LZ_LAYER_ICON, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    },
  });

  const escapeGeoJSON = useMemo(
    () => buildEscapePathGeoJSON(escapePath),
    [escapePath],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: ESCAPE_SOURCE_ID,
    data: escapeGeoJSON,
    addLayers: (map) => {
      map.addLayer({
        id: ESCAPE_HALO_LAYER,
        type: 'line',
        source: ESCAPE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.25,
        },
      });
      map.addLayer({
        id: ESCAPE_LINE_LAYER,
        type: 'line',
        source: ESCAPE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
    },
  });

  const reachableZoneGeoJSON = useMemo(
    () =>
      buildReachableZoneGeoJSON(showReachableZone ? reachableZoneResult : null),
    [showReachableZone, reachableZoneResult],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: RZ_SOURCE_ID,
    data: reachableZoneGeoJSON,
    addLayers: (map) => {
      // Insert the reachable-zone layers UNDER the track so the
      // interactive layers stay on top.
      const beforeId = map.getLayer(TRACK_LAYER_ID)
        ? TRACK_LAYER_ID
        : undefined;
      map.addLayer(
        {
          id: RZ_FILL_LAYER,
          type: 'fill',
          source: RZ_SOURCE_ID,
          paint: {
            'fill-color': STATUS_COLORS['in-local'],
            'fill-opacity': 0.18,
            'fill-antialias': false,
          },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: RZ_OUTLINE_LAYER,
          type: 'line',
          source: RZ_SOURCE_ID,
          paint: {
            'line-color': STATUS_COLORS['in-local'],
            'line-opacity': 0.35,
            'line-width': 0.5,
          },
        },
        beforeId,
      );
    },
  });

  const arrivalGeoJSON = useMemo(
    () => buildArrivalHeightsGeoJSON(arrivalHeightFeatures),
    [arrivalHeightFeatures],
  );

  useGeoJsonLayer(mapRef, {
    sourceId: ARRIVAL_SOURCE_ID,
    data: arrivalGeoJSON,
    enabled: iconsReady,
    addLayers: (map) => {
      map.addLayer({
        id: ARRIVAL_LABEL_LAYER,
        type: 'symbol',
        source: ARRIVAL_SOURCE_ID,
        layout: {
          'icon-image': ARRIVAL_PILL_ICON,
          // Stretch the SDF pill around the label. `icon-text-fit: 'both'`
          // makes the icon grow with the text; the padding [top, right,
          // bottom, left] leaves room around the glyphs.
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 6, 2, 6],
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 11,
          'text-offset': [0, -1.6],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: {
          'icon-color': [
            'match',
            ['get', 'status'],
            'in-local',
            STATUS_COLORS['in-local'],
            'in-local-marginal',
            STATUS_COLORS['in-local-marginal'],
            'out-of-local',
            STATUS_COLORS['out-of-local'],
            STATUS_COLORS['out-of-local'],
          ],
          'text-color': '#ffffff',
        },
      });
    },
  });

  // ---- Glider marker & camera ----

  // Fit the viewport to the whole track whenever a new flight is loaded,
  // and (re)create the glider marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight || flight.fixes.length === 0) return;

    const first = flight.fixes[0];
    const bounds = new LngLatBounds(
      [first.longitude, first.latitude],
      [first.longitude, first.latitude],
    );
    for (const fix of flight.fixes) {
      bounds.extend([fix.longitude, fix.latitude]);
    }

    const apply = () => {
      map.fitBounds(bounds, { padding: 40, duration: 0 });
      if (!markerRef.current) {
        const el = document.createElement('div');
        el.className =
          'h-4 w-4 rounded-full border-2 border-white bg-blue-600 shadow';
        markerRef.current = new Marker({ element: el });
      }
      markerRef.current.setLngLat([first.longitude, first.latitude]).addTo(map);
    };

    if (mapReadyRef.current) {
      apply();
      return;
    }
    map.once('load', apply);
    return () => {
      map.off('load', apply);
    };
  }, [flight]);

  // Move the glider marker on every currentTimeMs change.
  useEffect(() => {
    if (!flight || !markerRef.current) return;
    const position = interpolatePosition(flight, currentTimeMs);
    if (position) markerRef.current.setLngLat(position);
  }, [flight, currentTimeMs]);

  // Auto-pan: when the glider enters the outer AUTO_PAN_MARGIN_FRACTION
  // margin of the viewport, nudge the map centre by the same fraction of
  // that dimension in the same direction (the glider's world position is
  // untouched — only the view centre moves, so the glider ends up back
  // inside the safe band). Skipped while the map is already animating to
  // avoid stacking pans.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flight || !mapReadyRef.current) return;
    if (map.isMoving()) return;

    const position = interpolatePosition(flight, currentTimeMs);
    if (!position) return;

    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    const p = map.project(position);
    const marginX = w * AUTO_PAN_MARGIN_FRACTION;
    const marginY = h * AUTO_PAN_MARGIN_FRACTION;
    let dx = 0;
    let dy = 0;
    if (p.x < marginX) dx = -marginX;
    else if (p.x > w - marginX) dx = marginX;
    if (p.y < marginY) dy = -marginY;
    else if (p.y > h - marginY) dy = marginY;

    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy], { duration: 300 });
    }
  }, [flight, currentTimeMs]);

  return <div ref={containerRef} className="h-full w-full" />;
}
